import * as childProcess from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import * as net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as shellJob from '../../src/host/backend/shellJob'
import {
  createNativeTeamProcessDriver,
  createTeamProcessLifetime,
  type TeamProcessLifetime,
} from '../../src/host/team/processLifetime'
import { createTeamJournal } from '../../src/host/team/teamJournal'
import { createWindowAuthority, createWindowIdentity } from '../../src/host/team/windowIdentity'

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof net>()
  return { ...actual, createServer: vi.fn(actual.createServer) }
})
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0)) await close()
})

async function fixture(hasControl = true, hasEnded = true) {
  const state: { lifetime?: TeamProcessLifetime } = {}
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm96-windows-control-')))
  const actualChildProcess = await vi.importActual<typeof childProcess>('node:child_process')
  const child = actualChildProcess.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => {
      resolve()
    }),
  )
  cleanup.push(async () => {
    child.kill()
    await closed
    await state.lifetime?.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  if (platform === undefined) throw new Error('platform descriptor missing')
  const servers: net.Server[] = []
  const actualNet = await vi.importActual<typeof net>('node:net')
  vi.spyOn(net, 'createServer').mockImplementation((handler) => {
    const server = actualNet.createServer(handler)
    vi.spyOn(server, 'listen').mockImplementation(() => server)
    servers.push(server)
    return server
  })
  vi.spyOn(childProcess, 'spawn').mockReturnValue(child)
  vi.spyOn(shellJob, 'shellJobAssembly').mockReturnValue(() => Promise.resolve('fixture.dll'))
  Object.defineProperty(process, 'platform', { value: 'win32' })
  let driver
  try {
    driver = await createNativeTeamProcessDriver({
      killGraceMs: 100,
      windows: {
        storageDir: directory,
        systemRoot: String.raw`C:\Windows`,
        readJobSource: () => Promise.reject(new Error('unexpected assembly read')),
        log: () => {
          /* This fixture supplies its prepared assembly. */
        },
      },
    })
  } finally {
    Object.defineProperty(process, 'platform', platform)
  }
  const owner = createWindowIdentity(Date.now())
  const journal = createTeamJournal({
    storageDirectory: directory,
    owner,
    authority: createWindowAuthority(owner, () => Promise.reject(new Error('unexpected takeover'))),
    maxRecordBytes: 4096,
    platform: process.platform,
  })
  const lifetime = createTeamProcessLifetime({ journal, driver, isHostBusy: () => false })
  state.lifetime = lifetime
  const request = {
    command: 'fixture.exe',
    args: ["quoted'$(fixture);", 'line\nbreak', '漢'],
    cwd: directory,
    taskId: 'windows-control',
    env: {},
    priority: 'normal' as const,
  }
  if (!hasControl) {
    const launched = driver.launch(request, 'fixture-unconfirmed')
    void launched.confirmation.catch(() => {
      /* Retirement closes an unconfirmed helper; the rejection is expected. */
    })
    return { lifetime, journal, launched, child, control: undefined, writes: [] }
  }
  const pending = lifetime.launch(request)
  while (servers.length !== 2) await delay(1)
  const writes: string[] = []
  const control = new Duplex({
    read() {
      /* Status frames are emitted explicitly by this fixture. */
    },
    write(bytes: Buffer, _encoding, callback) {
      writes.push(bytes.toString('utf8'))
      callback()
    },
  })
  servers[1]?.emit('connection', control)
  control.emit(
    'data',
    Buffer.from('CONFIRMED 42042 fixture-start QzpcZml4dHVyZS5leGU= S-1-5-21-123\n'),
  )
  const launched = await pending
  if (hasEnded) control.emit('data', Buffer.from('END proved\n'))
  return { lifetime, journal, launched, child, control, writes }
}

describe('M96 K Windows END control stream', () => {
  it('retirement after END sends no STOP and waits for helper close before saving proved end', async () => {
    const f = await fixture()
    expect(f.control?.writableEnded).toBe(true)
    const retirement = f.lifetime.dispose()
    expect(await Promise.race([retirement, delay(30, 'pending')])).toBe('pending')
    expect(f.writes.map((text) => text.split(' ', 1)[0])).toEqual(['GO'])
    f.child.kill()
    expect(await retirement).toEqual([{ childExited: true, descendants: 'proved' }])
    expect(await f.lifetime.recoveryRecords(f.journal)).toEqual([])
  })

  it('releases the helper DLL lock before retirement without a connected control pipe returns', async () => {
    const f = await fixture(false)
    let isLocked = true
    f.child.once('close', () => {
      isLocked = false
    })
    const removeHelper = vi.fn(() => {
      if (isLocked) throw Object.assign(new Error('helper DLL still loaded'), { code: 'EPERM' })
    })
    const outcome = await f.launched.retire()
    expect(removeHelper).not.toHaveBeenCalled()
    expect(removeHelper).not.toThrow()
    expect(outcome).toEqual({ childExited: true, descendants: 'uncertain' })
    expect(f.child.exitCode !== null || f.child.signalCode !== null).toBe(true)
  })

  it('keeps cleanup pending until the stopped job is empty and its helper has closed', async () => {
    const f = await fixture(true, false)
    let isLocked = true
    f.child.once('close', () => {
      isLocked = false
    })
    const retirement = f.launched.retire()
    expect(f.writes.at(-1)?.split(' ', 1)[0]).toBe('STOP')
    expect(await Promise.race([retirement, delay(30, 'locked')])).toBe('locked')
    f.control?.emit('data', Buffer.from('END proved\n'))
    expect(await Promise.race([retirement, delay(30, 'locked')])).toBe('locked')
    expect(isLocked).toBe(true)
    f.child.kill()
    expect(await retirement).toEqual({ childExited: true, descendants: 'proved' })
    expect(isLocked).toBe(false)
  })

  it('starts the team helper without discovering PowerShell modules', async () => {
    const f = await fixture()
    const script = vi.mocked(childProcess.spawn).mock.calls.at(-1)?.[1]?.at(-1) ?? ''
    expect(script).not.toContain('ConvertFrom-Json')
    expect(script).toContain('[MuseSparkJob]::RunTeam')
    expect(script).toContain("[string[]]@('quoted''$(fixture);','line\nbreak','漢')")
    f.child.kill()
    await f.launched.ended
  })

  it('retirement after END has a deadline when helper closure is missing', async () => {
    const f = await fixture()
    vi.useFakeTimers()
    const retirement = f.launched.retire()
    const result = (async () => {
      try {
        await retirement
        return 'retired'
      } catch (error: unknown) {
        return error instanceof Error ? error.message : 'unexpected error'
      }
    })()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await Promise.race([result, delay(30, 'pending')])).toBe(
      'TEAM_WINDOWS_RETIREMENT_TIMEOUT',
    )
    expect(f.writes.map((text) => text.split(' ', 1)[0])).toEqual(['GO'])
    vi.useRealTimers()
    f.child.kill()
    expect(await f.launched.ended).toEqual({ childExited: true, descendants: 'proved' })
  })
})
