import { once } from 'node:events'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it, vi } from 'vitest'
import { launchLinuxResourceTree } from '../../src/core/resources/trees/linuxLaunch'
import * as treeRun from '../../src/core/resources/trees/run'
import { removeFolder } from './helpers/temporaryFolders'

const metadata = { kind: 'check', class: 'foreground', sessionId: null } as const

function noUserManager() {
  const actualRun = treeRun.runTreeProgram
  return vi
    .spyOn(treeRun, 'runTreeProgram')
    .mockImplementation((file, args, env) =>
      args.includes('--user')
        ? Promise.reject(new Error('no user manager'))
        : actualRun(file, args, env),
    )
}

describe.runIf(process.platform === 'linux')('native cgroup launch and completion', () => {
  it('retires and removes an empty cgroup after normal root exit without Stop', async () => {
    const launch = await launchLinuxResourceTree('/bin/sh', ['-c', 'read input'], metadata)
    const exited = once(launch.child, 'exit')
    try {
      expect(launch.ticket.scope.type).toBe('cgroup')
      launch.stdin.end()
      await vi.waitFor(() => {
        expect(launch.registry.tickets()).toEqual([])
      })
      await exited
      if (launch.ticket.scope.type !== 'cgroup') throw new Error('Missing scope')
      await expect(access(launch.ticket.scope.path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await launch.stop()
    }
  })

  it('keeps fallback group authority until the caller observes completion', async () => {
    const probe = noUserManager()
    let launch: Awaited<ReturnType<typeof launchLinuxResourceTree>> | undefined
    try {
      launch = await launchLinuxResourceTree('/bin/sleep', ['30'], metadata)
      expect(launch.ticket.scope.type).toBe('group')
      const exited = once(launch.child, 'exit')
      expect(await launch.stop()).toMatchObject({ status: 'done' })
      expect(launch.registry.tickets()).toEqual([launch.ticket])
      await exited
      launch.registry.unregister(launch.ticket)
      expect(launch.registry.tickets()).toEqual([])
      launch = undefined
    } finally {
      await launch?.stop()
      probe.mockRestore()
    }
  })

  it.each(['kill', 'freeze'] as const)(
    'launches a forked grandchild in its own cgroup and Stop (%s) observes populated zero before removal',
    async (method) => {
      const folder = await mkdtemp(path.join(tmpdir(), 'm107-t3-cgroup-'))
      let launch: Awaited<ReturnType<typeof launchLinuxResourceTree>> | undefined
      const receipts: string[] = []
      try {
        const binary = path.join(folder, 'tree')
        await treeRun.runTreeProgram(
          '/usr/bin/cc',
          [path.resolve('test/unit/helpers/resourceLifecycle.c'), '-o', binary],
          { PATH: '/usr/bin:/bin' },
        )
        launch = await launchLinuxResourceTree(binary, ['descendants'], metadata, {
          deps: {
            write: async (file, value) => {
              if (method === 'freeze' && file.endsWith('/cgroup.kill'))
                throw Object.assign(new Error('simulate older kernel'), { code: 'ENOENT' })
              await writeFile(file, value)
            },
            read: async (file) => {
              const text = await readFile(file, 'utf8')
              if (file.endsWith('/cgroup.events')) receipts.push(text)
              return text
            },
          },
        })
        expect(launch.ticket.scope.type).toBe('cgroup')
        const lines = createInterface({ input: launch.stdout })
        const pids = new Map<string, number>()
        lines.on('line', (line) => {
          const match = /(root|detached|grandchild) (\d+)/.exec(line)
          if (match?.[1] !== undefined) pids.set(match[1], Number(match[2]))
        })
        await vi.waitFor(() => {
          expect(pids.has('detached')).toBe(true)
        })
        expect(pids.get('root')).toBe(launch.ticket.root.pid)
        launch.stdin.write('f')
        await vi.waitFor(() => {
          expect(pids.has('grandchild')).toBe(true)
        })
        // No parent-edge sampling preceded the grandchild's birth: containment is the authority.
        const members = await launch.registry.members(launch.ticket)
        expect(members.map((member) => member.pid)).toEqual(
          expect.arrayContaining(Array.from(pids, ([, pid]) => pid)),
        )
        launch.stdin.end()
        const ownLaunch = launch
        await vi.waitFor(async () => {
          const remaining = await ownLaunch.registry.members(ownLaunch.ticket)
          expect(remaining.map((member) => member.pid)).toContain(pids.get('grandchild'))
          expect(remaining.map((member) => member.pid)).not.toContain(ownLaunch.ticket.root.pid)
        })
        const exited = once(launch.child, 'exit')
        expect(await launch.stop()).toMatchObject({ status: 'done' })
        await exited
        lines.close()
        expect(receipts.some((text) => /^populated 0$/m.test(text))).toBe(true)
        if (launch.ticket.scope.type !== 'cgroup') throw new Error('Missing cgroup receipt')
        await expect(access(launch.ticket.scope.path)).rejects.toMatchObject({ code: 'ENOENT' })
        for (const pid of pids.values()) {
          try {
            expect(await readFile(`/proc/${String(pid)}/stat`, 'utf8')).toMatch(/\) [ZXx] /)
          } catch (error: unknown) {
            expect(error).toMatchObject({ code: 'ENOENT' })
          }
        }
        expect(launch.registry.tickets()).toEqual([])
        launch = undefined
      } finally {
        await launch?.stop()
        await removeFolder(folder)
      }
    },
  )

  it('keeps workload instructions behind admission and refuses low-pid_max fallback before GO', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm107-t3-gate-'))
    const marker = path.join(folder, 'started')
    const proof = Promise.withResolvers<string>()
    void proof.promise.catch(() => undefined)
    let launch: Awaited<ReturnType<typeof launchLinuxResourceTree>> | undefined
    let pending: ReturnType<typeof launchLinuxResourceTree> | undefined
    let reads = 0
    const observed = vi.fn((file: string) =>
      file.endsWith('/stat') && ++reads === 2 ? proof.promise : readFile(file, 'utf8'),
    )
    try {
      pending = launchLinuxResourceTree(
        '/bin/sh',
        ['-c', 'printf started > "$1"; read input', 'fixture', marker],
        metadata,
        { deps: { read: observed } },
      )
      void pending.catch(() => undefined)
      await vi.waitFor(() => {
        expect(observed.mock.calls.filter((call) => call[0].endsWith('/stat'))).toHaveLength(2)
      })
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      // Resume the actual stat read after observing that no workload instruction has run.
      observed.mockImplementation((file) => readFile(file, 'utf8'))
      const blocked = observed.mock.calls.find((call) => call[0].endsWith('/stat'))?.[0]
      if (blocked === undefined) throw new Error('Missing admission proof')
      proof.resolve(await readFile(blocked, 'utf8'))
      launch = await pending
      pending = undefined
      await vi.waitFor(async () => {
        expect(await readFile(marker, 'utf8')).toBe('started')
      })
      const exited = once(launch.child, 'exit')
      expect(await launch.stop()).toMatchObject({ status: 'done' })
      await exited
      launch = undefined
      const probe = noUserManager()
      try {
        await expect(
          launchLinuxResourceTree('/bin/sh', ['-c', 'exit 0'], metadata, {
            deps: {
              read: (file) =>
                file === '/proc/sys/kernel/pid_max'
                  ? Promise.resolve('32768')
                  : readFile(file, 'utf8'),
            },
          }),
        ).rejects.toThrow('not proven')
      } finally {
        probe.mockRestore()
      }
    } finally {
      if (pending !== undefined) {
        observed.mockImplementation((file) => readFile(file, 'utf8'))
        const waiting = observed.mock.calls.find((call) => call[0].endsWith('/stat'))?.[0]
        if (waiting !== undefined) {
          try {
            proof.resolve(await readFile(waiting, 'utf8'))
          } catch (error: unknown) {
            proof.reject(error)
          }
        }
        try {
          launch = await pending
        } catch {
          launch = undefined
        }
      }
      await launch?.stop()
      await removeFolder(folder)
    }
  })
})
