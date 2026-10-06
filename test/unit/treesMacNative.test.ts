import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MacResourceTreeReader } from '../../src/core/resources/trees/mac'
import { ResourceTreeRegistry } from '../../src/core/resources/trees/registry'
import { parseMacProcessTable } from '../../src/core/resources/trees/posixTable'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import type { ResourceTicket } from '../../src/shared/resources'
import { removeFolder } from './helpers/temporaryFolders'
import { darwinProcessHelper } from './helpers/darwinProcessHelper'

describe('Darwin native binding boundary', () => {
  const helperPath = path.resolve('native/darwin/muse-dictate')
  it('refuses a mismatched native PID at the signal boundary instead of interpreting it as a changed birth', async () => {
    let hasShifted = false
    const info = { pid: 710, pgid: 710, parent: 1, startTime: '1000', exited: false }
    const run = (_file: string, args: readonly string[]) =>
      Promise.resolve(
        args[0] === '-axo'
          ? '710 1 710 S 0:02.00 4\n'
          : JSON.stringify([{ ...info, pid: hasShifted ? 711 : 710 }]),
      )
    const reader = new MacResourceTreeReader({ helperPath, run, sendSignal: vi.fn() })
    const registry = new ResourceTreeRegistry(reader)
    const ticket: ResourceTicket = {
      id: 'shifted',
      root: { pid: 710, startTime: '1000' },
      scope: { type: 'group', pgid: 710 },
      kind: 'check',
      class: 'foreground',
      sessionId: null,
    }
    await registry.register(ticket)
    hasShifted = true
    expect(await registry.signal(ticket, ticket.root, 'SIGKILL')).toBe('refused')
  })
  it.each(['new', 'recorded'] as const)(
    'refuses a tree snapshot with an inaccessible %s descendant',
    async (kind) => {
      let isUnavailable = kind === 'new'
      const info = new Map([
        [710, { pid: 710, pgid: 710, parent: 1, startTime: '1000', exited: false }],
        [711, { pid: 711, pgid: 711, parent: 710, startTime: '1001', exited: false }],
      ])
      const run = (_file: string, args: readonly string[]) =>
        Promise.resolve(
          args[0] === '-axo'
            ? `710 1 710 S 0:02.00 4\n711 ${kind === 'recorded' && isUnavailable ? '1' : '710'} 711 S 0:02.00 4\n`
            : JSON.stringify(
                args
                  .slice(1)
                  .map((pid) =>
                    isUnavailable && pid === '711'
                      ? { pid: 711, unavailable: true }
                      : (info.get(Number(pid)) ?? null),
                  ),
              ),
        )
      const sendSignal = vi.fn()
      const reader = new MacResourceTreeReader({ helperPath, run, sendSignal })
      const ticket: ResourceTicket = {
        id: 'unavailable',
        root: { pid: 710, startTime: '1000' },
        scope: { type: 'group', pgid: 710 },
        kind: 'check',
        class: 'foreground',
        sessionId: null,
      }
      const registry = new ResourceTreeRegistry(reader)
      await registry.register(ticket)
      isUnavailable = true
      expect(await registry.kill(ticket)).toEqual({ status: 'refused', members: [] })
      expect(sendSignal).not.toHaveBeenCalled()
    },
  )
  it('validates exact identities, unavailable results and positional correspondence', async () => {
    const info = { pid: 710, pgid: 710, parent: 1, startTime: '1000001', exited: false }
    const run = vi.fn(() => Promise.resolve(JSON.stringify([info])))
    const reader = new MacResourceTreeReader({ helperPath, run })
    expect(await reader.identity(710)).toEqual({ pid: 710, startTime: '1000001' })
    expect(run).toHaveBeenCalledWith(helperPath, ['proc-identity', '710'])
    for (const answer of [
      [{ ...info, pid: 711 }],
      [info, info],
      [{ ...info, startTime: '' }],
      [{ ...info, startTime: 'whole-second ps lstart' }],
      [{ ...info, parent: -1 }],
      [{ ...info, exited: true }],
      [{ pid: 710, unavailable: true }],
      [{ ...info, command: 'not permitted' }],
      [null],
    ]) {
      run.mockResolvedValueOnce(JSON.stringify(answer))
      expect(await reader.identity(710)).toBeNull()
    }
  })
})

describe.runIf(process.platform === 'darwin')('native Darwin process identity', () => {
  let helperPath = ''
  let fixture: Awaited<ReturnType<typeof darwinProcessHelper>> | undefined
  beforeAll(async () => {
    fixture = await darwinProcessHelper()
    helperPath = fixture.helperPath
  }, 120_000)
  afterAll(async () => {
    await fixture?.remove()
  })
  it('reads exact numerical kernel identity without audio setup and refuses invalid input', async () => {
    const reader = new MacResourceTreeReader({ helperPath })
    const identity = await reader.identity(process.pid)
    expect(identity?.pid).toBe(process.pid)
    expect(identity?.startTime).toMatch(/^\d{16}$/)
    const raw: unknown = JSON.parse(
      await runTreeProgram(helperPath, ['proc-identity', String(process.pid)]),
    )
    expect(raw).toEqual([
      { ...identity, pgid: expect.any(Number), parent: process.ppid, exited: false },
    ])
    expect(await runTreeProgram(helperPath, ['proc-identity', '2147483647'])).toBe('[null]')
    await expect(runTreeProgram(helperPath, ['proc-identity', '-1'])).rejects.toThrow()
    expect(() => new MacResourceTreeReader({ helperPath: 'muse-dictate' })).toThrow('absolute')
  })

  it('distinguishes births within one second and observes fast exit without an identity fallback', async () => {
    const reader = new MacResourceTreeReader({ helperPath })
    const children = Array.from({ length: 8 }, () =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        env: {},
        stdio: 'ignore',
      }),
    )
    const deaths = children.map((child) => once(child, 'exit'))
    try {
      const identities = await Promise.all(children.map((child) => reader.identity(child.pid!)))
      expect(identities.every((identity) => identity !== null)).toBe(true)
      const births = identities.map((identity) => identity!.startTime)
      expect(new Set(births).size).toBe(births.length)
      expect(new Set(births.map((birth) => birth.slice(0, -6))).size).toBeLessThan(births.length)
    } finally {
      for (const child of children) child.kill()
      await Promise.all(deaths)
    }
    for (const child of children) expect(await reader.identity(child.pid!)).toBeNull()
  })

  it('reports a real unreaped zombie as exited and excludes it from membership', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm107-t2-zombie-'))
    try {
      const file = path.join(folder, 'lifecycle')
      await runTreeProgram('/usr/bin/cc', [
        path.resolve('test/unit/helpers/resourceLifecycle.c'),
        '-o',
        file,
      ])
      const child = spawn(file, [], { detached: true, env: {}, stdio: ['pipe', 'pipe', 'pipe'] })
      const death = once(child, 'exit')
      try {
        const [output] = await once(child.stdout, 'data')
        const [pid, zombie] = String(output).trim().split(' ').map(Number)
        const reader = new MacResourceTreeReader({ helperPath })
        const root = await reader.identity(pid!)
        const ticket: ResourceTicket = {
          id: 'native-zombie',
          root: root!,
          scope: { type: 'group', pgid: pid! },
          kind: 'check',
          class: 'foreground',
          sessionId: null,
        }
        const registry = new ResourceTreeRegistry(reader)
        await registry.register(ticket)
        let zombieRows: ReturnType<typeof parseMacProcessTable> = null
        for (let attempt = 0; attempt < 100; attempt++) {
          zombieRows = parseMacProcessTable(
            await runTreeProgram('/bin/ps', [
              '-p',
              String(zombie),
              '-o',
              'pid=,ppid=,pgid=,state=,time=,rss=',
            ]),
          )
          if (zombieRows?.[0]?.exited) break
          await setTimeout(1)
        }
        expect(zombieRows?.[0]).toMatchObject({ pid: zombie, parent: pid, pgid: pid, exited: true })
        // This kernel returns ESRCH for proc_pidinfo of a zombie; absence is exited too.
        expect(await runTreeProgram(helperPath, ['proc-identity', String(zombie)])).toBe('[null]')
        expect(await reader.identity(zombie!)).toBeNull()
        expect(await registry.members(ticket)).toEqual([root])
      } finally {
        child.stdin.end()
        await death
      }
    } finally {
      await removeFolder(folder)
    }
  })
})
