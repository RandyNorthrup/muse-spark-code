import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LinuxResourceTreeReader } from '../../src/core/resources/trees/linux'
import { MacResourceTreeReader } from '../../src/core/resources/trees/mac'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { signalVerifiedPosix } from '../../src/core/resources/trees/actions'
import { runTreeProgram, type ResourceTreeRun } from '../../src/core/resources/trees/run'
import type { ResourceProcessIdentity, ResourceTicket } from '../../src/shared/resources'
import { removeFolder } from './helpers/temporaryFolders'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'

/** True while the pid exists for us, a zombie included (kill(2) signal 0). */
function isPresent(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')(
  'native registered lifecycle',
  () => {
    let helperPath = ''
    let fixture: Awaited<ReturnType<typeof darwinProcessHelper>> | undefined
    beforeAll(async () => {
      if (process.platform === 'darwin') {
        fixture = await darwinProcessHelper()
        helperPath = fixture.helperPath
      }
      reuse = await preparePidReuse()
    }, 120_000)
    afterAll(async () => {
      await fixture?.remove()
    })
    it('reports an enrolled, genuinely unreaped zombie root as gone for both signal and kill', async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-root-zombie-'))
      try {
        const file = path.join(folder, 'lifecycle')
        await runTreeProgram(
          '/usr/bin/cc',
          [path.resolve('test/unit/helpers/resourceLifecycle.c'), '-o', file],
          { PATH: '/usr/bin:/bin' },
        )
        const parent = spawn(file, ['hold-zombie'], {
          detached: true,
          env: {},
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const death = once(parent, 'exit')
        try {
          const [output] = await once(parent.stdout, 'data')
          const pid = Number(String(output).trim())
          const reader =
            process.platform === 'darwin'
              ? new MacResourceTreeReader({
                  helperPath,
                })
              : new LinuxResourceTreeReader()
          const root = await reader.identity(pid)
          expect(root).not.toBeNull()
          const ticket: ResourceTicket = {
            id: 'root-zombie',
            root: root!,
            scope: { type: 'group', pgid: pid },
            kind: 'check',
            class: 'foreground',
            sessionId: null,
          }
          const registry = new ResourceTreeRegistry(reader)
          await registry.register(ticket)
          parent.stdin.write('z')
          for (let attempt = 0; attempt < 100; attempt++) {
            if ((await reader.identity(pid)) === null) break
            await setTimeout(1)
          }
          expect(await runTreeProgram('/bin/ps', ['-p', String(pid), '-o', 'state='])).toMatch(
            /^Z/m,
          )
          expect(await registry.signal(ticket, root!, 'SIGTERM')).toBe('gone')
          let stopped = await registry.kill(ticket)
          // OS-wide numerical scans can be unknown during concurrent process churn.
          for (let attempt = 0; stopped.status === 'refused' && attempt < 100; attempt++) {
            await setTimeout(1)
            stopped = await registry.kill(ticket)
          }
          expect(stopped).toEqual({
            status: 'gone',
            members: [{ identity: root, result: 'gone' }],
          })
        } finally {
          parent.stdin.end()
          await death
        }
      } finally {
        await removeFolder(folder)
      }
    })
    async function preparePidReuse() {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-reuse-'))
      const fixturePids = new Set<number>()
      const reader =
        process.platform === 'darwin'
          ? new MacResourceTreeReader({ helperPath })
          : new LinuxResourceTreeReader({
              // Discover our real births; native stat/membership/signals still verify each one.
              list: () => Promise.resolve([...fixturePids].map(String)),
            })
      let prior: { registry: ResourceTreeRegistry; ticket: ResourceTicket } | undefined
      const births = new Set<string>()
      const observations = []
      try {
        const file = path.join(folder, 'lifecycle')
        await runTreeProgram(
          '/usr/bin/cc',
          [path.resolve('test/unit/helpers/resourceLifecycle.c'), '-o', file],
          { PATH: '/usr/bin:/bin' },
        )
        for (let attempt = 0; attempt < 32; attempt++) {
          const child = spawn(file, ['short'], {
            detached: true,
            env: {},
            stdio: ['pipe', 'pipe', 'pipe'],
          })
          const death = once(child, 'exit')
          fixturePids.add(child.pid!)
          try {
            await once(child.stdout, 'data')
            const root = await reader.identity(child.pid!)
            if (root === null) throw new Error('Missing native identity')
            const ticket: ResourceTicket = {
              id: `reuse-${String(attempt)}`,
              root: root,
              scope: { type: 'group', pgid: root.pid },
              kind: 'check',
              class: 'foreground',
              sessionId: null,
            }
            const registry = new ResourceTreeRegistry(reader)
            await registry.register(ticket)
            if (prior !== undefined) {
              const result = await prior.registry.signal(prior.ticket, prior.ticket.root, 'SIGKILL')
              observations.push({
                result,
                expected: root,
                current: await reader.identity(root.pid),
              })
              prior.registry.unregister(prior.ticket)
            }
            births.add(`${String(root.pid)}/${root.startTime}`)
            prior = { registry, ticket }
          } finally {
            child.stdin.end()
            await death
          }
        }
        return {
          count: births.size,
          observations,
          final: await prior!.registry.signal(prior!.ticket, prior!.ticket.root, 'SIGKILL'),
        }
      } finally {
        prior?.registry.unregister(prior.ticket)
        await removeFolder(folder)
      }
    }
    let reuse: Awaited<ReturnType<typeof preparePidReuse>>
    // Thirty-two real births and native probes are setup; every safety assertion stays at five seconds.
    it('attempts PID reuse across fast births and never signals a later process through an old ticket', () => {
      expect(reuse.count).toBe(32)
      expect(reuse.observations).toHaveLength(31)
      for (const observation of reuse.observations) {
        expect(['gone', 'identity-changed']).toContain(observation.result)
        expect(observation.current).toEqual(observation.expected)
      }
      expect(reuse.final).toBe('gone')
    })
    it('kills recorded setsid/double-fork descendants after both parents exit without group signalling', async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-descendants-'))
      // The raw OS reads behind a membership answer, kept for a failure message.
      const reads: { file: string; output?: string; error?: string }[] = []
      const record: ResourceTreeRun = async (file, args, env) => {
        try {
          const output = await runTreeProgram(file, args, env)
          reads.push({ file: path.basename(file), output })
          return output
        } catch (error: unknown) {
          reads.push({ file: path.basename(file), error: String(error) })
          throw error
        }
      }
      const evidence = (pids: readonly number[]) =>
        JSON.stringify(
          reads.map(({ file, output, error }) => ({
            file,
            error,
            rows: output
              ?.split(/[\n{]/)
              .filter((row) =>
                pids.some((pid) => new RegExp(String.raw`\b${String(pid)}\b`).test(row)),
              ),
            unavailable: output?.match(/"unavailable"/g)?.length ?? 0,
          })),
        )
      const reader =
        process.platform === 'darwin'
          ? new MacResourceTreeReader({ helperPath, run: record })
          : new LinuxResourceTreeReader()
      const births: ResourceProcessIdentity[] = []
      try {
        const file = path.join(folder, 'lifecycle')
        await runTreeProgram(
          '/usr/bin/cc',
          [path.resolve('test/unit/helpers/resourceLifecycle.c'), '-o', file],
          { PATH: '/usr/bin:/bin' },
        )
        const rootProcess = spawn(file, ['descendants'], {
          detached: true,
          env: {},
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const death = once(rootProcess, 'exit')
        const lines = createInterface({ input: rootProcess.stdout })
        const iterator = lines[Symbol.asyncIterator]()
        const nextBirth = async (label: string) => {
          const line = await iterator.next()
          if (line.done) throw new Error('Lifecycle fixture exited before its receipt')
          expect(line.value).toMatch(new RegExp(String.raw`^${label} \d+$`))
          const pid = Number(line.value.split(' ', 2)[1])
          const identity = await reader.identity(pid)
          expect(identity).not.toBeNull()
          births.push(identity!)
          return identity!
        }
        try {
          const root = await nextBirth('root')
          const detached = await nextBirth('detached')
          const ticket: ResourceTicket = {
            id: 'native-descendants',
            root,
            scope: { type: 'group', pgid: root.pid },
            kind: 'check',
            class: 'foreground',
            sessionId: null,
          }
          const registry = new ResourceTreeRegistry(reader)
          await registry.register(ticket)
          expect(await registry.members(ticket)).toContainEqual(detached)
          rootProcess.stdin.write('f')
          const grandchild = await nextBirth('grandchild')
          expect(await registry.members(ticket)).toContainEqual(grandchild)
          rootProcess.stdin.write('e')
          for (let attempt = 0; attempt < 100; attempt++) {
            if ((await reader.identity(detached.pid)) === null) break
            await setTimeout(1)
          }
          expect(await reader.identity(detached.pid)).toBeNull()
          rootProcess.stdin.write('q')
          await death
          // The root never reaps `detached`; launchd or init does once the root
          // exits. Hosted macOS 26 once read no members here (CIFIX017 round 5,
          // not reproduced on macOS 15 rigs): wait out that reap, and report the
          // raw reads if it recurs.
          for (let attempt = 0; attempt < 100; attempt++) {
            if (!isPresent(detached.pid)) break
            await setTimeout(1)
          }
          reads.length = 0
          expect(
            await registry.members(ticket),
            evidence([root.pid, detached.pid, grandchild.pid]),
          ).toEqual([grandchild])
          const result = await registry.kill(ticket)
          expect(result.status).toBe('done')
          expect(result.members).toContainEqual({ identity: grandchild, result: 'done' })
          for (let attempt = 0; attempt < 100; attempt++) {
            if ((await reader.identity(grandchild.pid)) === null) break
            await setTimeout(1)
          }
          expect(await reader.identity(grandchild.pid)).toBeNull()
          expect(await registry.signal(ticket, grandchild, 'SIGKILL')).toBe('gone')
        } finally {
          // Cleanup is itself birth-verified, including deliberate guard-break failures.
          for (const identity of births.toReversed()) {
            signalVerifiedPosix(
              identity,
              await reader.identity(identity.pid),
              'SIGKILL',
              () => true,
              (pid, signal) => {
                process.kill(pid, signal)
              },
            )
          }
          rootProcess.kill('SIGKILL')
          await death
          lines.close()
        }
      } finally {
        await removeFolder(folder)
      }
    })
  },
)
