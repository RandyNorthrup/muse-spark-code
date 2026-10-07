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
import { runTreeProgram } from '../../src/core/resources/trees/run'
import type { ResourceProcessIdentity, ResourceTicket } from '../../src/shared/resources'
import { removeFolder } from './helpers/temporaryFolders'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'

describe.runIf(process.platform === 'darwin' || process.platform === 'linux')(
  'native registered lifecycle',
  () => {
    let helperPath = ''
    let fixture: Awaited<ReturnType<typeof darwinProcessHelper>> | undefined
    beforeAll(async () => {
      if (process.platform !== 'darwin') return
      fixture = await darwinProcessHelper()
      helperPath = fixture.helperPath
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
    it('attempts PID reuse across fast births and never signals a later process through an old ticket', async () => {
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
            expect(root).not.toBeNull()
            const ticket: ResourceTicket = {
              id: `reuse-${String(attempt)}`,
              root: root!,
              scope: { type: 'group', pgid: root!.pid },
              kind: 'check',
              class: 'foreground',
              sessionId: null,
            }
            const registry = new ResourceTreeRegistry(reader)
            await registry.register(ticket)
            if (prior !== undefined) {
              const result = await prior.registry.signal(prior.ticket, prior.ticket.root, 'SIGKILL')
              expect(['gone', 'identity-changed']).toContain(result)
              expect(await reader.identity(root!.pid)).toEqual(root)
              prior.registry.unregister(prior.ticket)
            }
            births.add(`${String(root!.pid)}/${root!.startTime}`)
            prior = { registry, ticket }
          } finally {
            child.stdin.end()
            await death
          }
        }
        expect(births.size).toBe(32)
        expect(await prior!.registry.signal(prior!.ticket, prior!.ticket.root, 'SIGKILL')).toBe(
          'gone',
        )
      } finally {
        prior?.registry.unregister(prior.ticket)
        await removeFolder(folder)
      }
    })
    it('kills recorded setsid/double-fork descendants after both parents exit without group signalling', async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-descendants-'))
      const reader =
        process.platform === 'darwin'
          ? new MacResourceTreeReader({ helperPath })
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
          expect(await registry.members(ticket)).toEqual([grandchild])
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
