import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  AttemptRetirement,
  type RetirementDependencies,
  type RetirementEvidence,
} from '../../src/core/team/scheduler/retire'
import { SchedulerSlots } from '../../src/core/team/scheduler/slots'
import { TEAM_RETIRE_WAIT_MS } from '../../src/shared/constants'
import { slot } from './helpers/teamScheduler'

function pending(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
}
function fixture(
  kind: RetirementEvidence['kind'] = 'engine',
  method: RetirementEvidence['containerMethod'] = 'linuxCgroup',
) {
  const ref = { taskId: 'task', attempt: 1 }
  const evidence: RetirementEvidence = {
    windowInstanceId: 'window',
    ref,
    kind,
    loopStopped: false,
    turnTerminal: false,
    itemsTerminal: false,
    promptAnswered: false,
    isReadOnlyMuse: false,
    hostExited: false,
    containerMethod: method,
    processes: [{ childExited: false, descendantsEnded: false, method }],
  }
  const pool = new SchedulerSlots('workspace', () => ({
    workers: 2,
    processWorkers: 2,
    role: () => 2,
    entry: () => 2,
    agent: () => 2,
  }))
  pool.reserve(slot('task', { kind }))
  pool.mark(ref, 'running')
  const deps: RetirementDependencies = {
    windowInstanceId: 'window',
    now: () => Date.now(),
    evidence: () => evidence,
    cancel: vi.fn(() => Promise.resolve()),
    changed: vi.fn((_ref: { taskId: string; attempt: number }, signal: AbortSignal) =>
      pending(signal),
    ),
    escalate: vi.fn(() => Promise.resolve()),
    delay: (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
      }),
    markUncertain: vi.fn(),
    quarantine: vi.fn(() => Promise.resolve()),
    canQuarantine: () => true,
    prepareReplacement: vi.fn(() => Promise.resolve(true)),
    exclusiveResourcesFree: () => true,
    teamHostWorkers: () => [ref],
    restartTeamHost: vi.fn(() => Promise.resolve()),
    recordDecision: vi.fn(() => Promise.resolve()),
  }
  return { ref, evidence, pool, deps, retirement: new AttemptRetirement(deps, pool) }
}

afterEach(() => vi.useRealTimers())
describe('window-observed retirement', () => {
  it('keeps the slot after its own child exits while a real detached descendant writes late', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'team-retirement-'))
    const output = path.join(root, 'late.txt')
    const release = path.join(root, 'release')
    // The descendant writes only after parent exit and retained-slot proof.
    // A wall-clock sleep consumed the full aggregate test deadline.
    const writer = `const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) { fs.writeFileSync(process.argv[1], 'late'); clearInterval(timer); } }, 10); process.send('ready')`
    const launcher = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(writer)}, process.argv[1]], { detached: true, stdio: ['ignore', process.stdout, process.stderr, 'ipc'] }); child.once('message', () => { child.disconnect(); child.unref() })`
    const child = spawn(process.execPath, ['-e', launcher, output], {
      cwd: root,
      env: {},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const drained = once(child.stdout, 'end')
    child.stdout.resume()
    child.stderr.resume()
    try {
      await once(child, 'exit')
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
      const f = fixture('engine', 'unproved')
      f.evidence.loopStopped = true
      f.evidence.processes = [{ childExited: true, descendantsEnded: false, method: 'unproved' }]
      f.deps.delay = () => Promise.resolve()
      expect(await f.retirement.retire(f.ref)).toMatchObject({ state: 'uncertain' })
      expect(f.pool.snapshot()).toHaveLength(1)
      await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(release, '')
      await drained
      expect(await readFile(output, 'utf8')).toBe('late')
      expect(f.pool.snapshot()).toHaveLength(1)
      expect(f.deps.quarantine).toHaveBeenCalledWith(f.ref)
    } finally {
      await writeFile(release, '')
      await drained
      await rm(root, { recursive: true, force: true })
    }
  })
  it('requires each kind terminal and the direct exit in addition to descendant proof', async () => {
    vi.useFakeTimers()
    for (const kind of ['engine', 'museCode', 'external'] as const) {
      const f = fixture(kind)
      f.evidence.itemsTerminal = true
      f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'linuxCgroup' }]
      const outcome = f.retirement.retire(f.ref)
      await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
      expect(await outcome).toMatchObject({ state: 'uncertain' })
    }
    const child = fixture()
    child.evidence.loopStopped = true
    child.evidence.processes = [
      { childExited: false, descendantsEnded: true, method: 'linuxCgroup' },
    ]
    const outcome = child.retirement.retire(child.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS - 1)
    expect(child.deps.escalate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS + 1)
    expect(await outcome).toMatchObject({ state: 'uncertain' })
  })
  it('requires the engine loop and every descendant, never a cancel acknowledgement', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.evidence.loopStopped = true
    f.evidence.processes = [{ childExited: true, descendantsEnded: false, method: 'linuxCgroup' }]
    const outcome = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await outcome).toMatchObject({ state: 'uncertain' })
    expect(f.pool.snapshot()).toHaveLength(1)
    expect(f.deps.escalate).toHaveBeenCalledOnce()
    expect(f.deps.quarantine).toHaveBeenCalledWith(f.ref)
    f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'linuxCgroup' }]
    const stopped = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await stopped).toMatchObject({ state: 'retired' })
  })

  it('requires Muse terminal items and the read-only host exit', async () => {
    vi.useFakeTimers()
    const f = fixture('museCode')
    f.evidence.turnTerminal = true
    f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'linuxCgroup' }]
    const first = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await first).toMatchObject({ state: 'uncertain' })
    f.evidence.itemsTerminal = true
    f.evidence.isReadOnlyMuse = true
    const second = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await second).toMatchObject({ state: 'uncertain' })
    f.evidence.hostExited = true
    expect(await f.retirement.retire(f.ref)).toMatchObject({
      state: 'retired',
      retirement: { kind: 'proved' },
    })
    expect(f.pool.snapshot()).toHaveLength(0)
  })

  it('waits for an external prompt and tree, including a writer five seconds after cancel', async () => {
    vi.useFakeTimers()
    const f = fixture('external')
    f.evidence.promptAnswered = true
    let isWrote = false
    const outcome = f.retirement.retire(f.ref)
    setTimeout(() => {
      isWrote = true
      f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'linuxCgroup' }]
    }, 5000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(f.pool.snapshot()).toHaveLength(1)
    expect(isWrote).toBe(false)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(isWrote).toBe(true)
    expect(await outcome).toMatchObject({ state: 'retired' })
    const other = fixture('external')
    other.evidence.processes = [
      { childExited: true, descendantsEnded: true, method: 'linuxCgroup' },
    ]
    const pendingPrompt = other.retirement.retire(other.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await pendingPrompt).toMatchObject({ state: 'uncertain' })
    const empty = fixture('external')
    empty.evidence.promptAnswered = true
    empty.evidence.processes = []
    const noTree = empty.retirement.retire(empty.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await noTree).toMatchObject({ state: 'uncertain' })
  })

  it('keeps unprovable group exits uncertain and records Continue anyway as a user decision', async () => {
    vi.useFakeTimers()
    const f = fixture('engine', 'unproved')
    f.evidence.loopStopped = true
    f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'unproved' }]
    const outcome = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await outcome).toMatchObject({ state: 'uncertain' })
    const empty = fixture('engine', 'unproved')
    empty.evidence.loopStopped = true
    empty.evidence.processes = []
    const noProof = empty.retirement.retire(empty.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await noProof).toMatchObject({ state: 'uncertain' })
    expect(await f.retirement.continueAnyway(f.ref)).toMatchObject({
      retirement: { kind: 'userDecision' },
    })
    expect(f.deps.recordDecision).toHaveBeenCalledWith(f.ref, 'continueAnyway')
    expect(f.pool.snapshot()).toHaveLength(0)
    await expect(fixture().retirement.continueAnyway(f.ref)).rejects.toThrow('continueNotAvailable')
  })

  it('bounds a hung cancel and escalation, and rejects another window as evidence', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.deps.cancel = () => new Promise(() => undefined)
    f.deps.escalate = () => new Promise(() => undefined)
    const outcome = f.retirement.retire(f.ref)
    await vi.advanceTimersByTimeAsync(TEAM_RETIRE_WAIT_MS * 2)
    expect(await outcome).toMatchObject({ state: 'uncertain' })
    const foreign = fixture()
    foreign.evidence.windowInstanceId = 'other'
    await expect(foreign.retirement.continueAnyway(foreign.ref)).rejects.toThrow(
      'foreignRetirement',
    )
  })

  it('hands off only with a free counted slot/resource, quarantines and prepares a fresh copy', async () => {
    const f = fixture()
    const replacement = slot('task', { attempt: 2 })
    f.pool.mark(f.ref, 'uncertain')
    expect(await f.retirement.handOffAnyway(f.ref, { ...replacement, taskId: 'other' })).toBe(false)
    expect(await f.retirement.handOffAnyway(f.ref, { ...replacement, attempt: 3 })).toBe(false)
    expect(await f.retirement.handOffAnyway(f.ref, replacement)).toBe(true)
    expect(f.pool.snapshot()).toHaveLength(2)
    expect(f.deps.quarantine).toHaveBeenCalledWith(f.ref)
    expect(f.deps.prepareReplacement).toHaveBeenCalledWith(f.ref, replacement)
    expect(f.deps.recordDecision).toHaveBeenCalledWith(f.ref, 'handOffAnyway')
    const occupied = fixture()
    occupied.pool.mark(occupied.ref, 'uncertain')
    occupied.pool.reserve(slot('other'))
    expect(occupied.retirement.handoffRefusal(replacement)).toContain('workers')
    expect(await occupied.retirement.handOffAnyway(occupied.ref, replacement)).toBe(false)
    expect(occupied.deps.prepareReplacement).not.toHaveBeenCalled()
    const singleton = fixture()
    singleton.pool.mark(singleton.ref, 'uncertain')
    singleton.deps.exclusiveResourcesFree = () => false
    expect(singleton.retirement.handoffRefusal(replacement)).toBeDefined()
    expect(await singleton.retirement.handOffAnyway(singleton.ref, replacement)).toBe(false)
    const raced = fixture()
    raced.pool.mark(raced.ref, 'uncertain')
    raced.deps.quarantine = () => {
      raced.deps.exclusiveResourcesFree = () => false
      return Promise.resolve()
    }
    expect(await raced.retirement.handOffAnyway(raced.ref, replacement)).toBe(false)
    expect(raced.pool.snapshot()).toHaveLength(1)
    const denied = fixture()
    denied.pool.mark(denied.ref, 'uncertain')
    denied.deps.prepareReplacement = () => Promise.resolve(false)
    expect(await denied.retirement.handOffAnyway(denied.ref, replacement)).toBe(false)
    expect(denied.pool.snapshot()).toHaveLength(1)
    const inPlace = fixture()
    inPlace.pool.mark(inPlace.ref, 'uncertain')
    inPlace.deps.canQuarantine = () => false
    expect(inPlace.retirement.handoffRefusal(replacement)).toBeDefined()
    expect(await inPlace.retirement.handOffAnyway(inPlace.ref, replacement)).toBe(false)
    const active = fixture()
    expect(await active.retirement.handOffAnyway(active.ref, replacement)).toBe(false)
    const notUncertain = fixture('engine', 'unproved')
    await expect(notUncertain.retirement.continueAnyway(notUncertain.ref)).rejects.toThrow(
      'notUncertain',
    )
  })

  it('restarts only the named team host workers and requires proof after its exit', async () => {
    const f = fixture('museCode')
    await expect(f.retirement.restartTeamHost([])).rejects.toThrow('hostConfirmationChanged')
    await expect(
      f.retirement.restartTeamHost([f.ref, { taskId: 'extra', attempt: 1 }]),
    ).rejects.toThrow('hostConfirmationChanged')
    f.deps.restartTeamHost = vi.fn(() => {
      f.evidence.hostExited = true
      f.evidence.processes = [{ childExited: true, descendantsEnded: true, method: 'windowsJob' }]
      f.evidence.containerMethod = 'windowsJob'
      return Promise.resolve()
    })
    expect(await f.retirement.restartTeamHost([f.ref])).toMatchObject([
      { outcome: { state: 'retired', retirement: { method: 'windowsJob' } } },
    ])
    expect(f.pool.snapshot()).toHaveLength(0)
    const uncertain = fixture('museCode', 'unproved')
    uncertain.evidence.hostExited = true
    expect(await uncertain.retirement.restartTeamHost([uncertain.ref])).toMatchObject([
      { outcome: { state: 'uncertain' } },
    ])
    expect(uncertain.pool.snapshot()).toMatchObject([{ state: 'uncertain' }])
    expect(uncertain.deps.markUncertain).toHaveBeenCalledWith(uncertain.ref)
    expect(uncertain.deps.quarantine).toHaveBeenCalledWith(uncertain.ref)
  })
})
