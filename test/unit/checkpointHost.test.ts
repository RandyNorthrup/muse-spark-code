import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolIo, TurnWrites } from '../../src/core/backends/modelapi/tools'
import type { Owner } from '../../src/core/checkpoints/toolWrites'
import { ShellEntryError } from '../../src/core/shellResult'
import {
  type CheckpointPort,
  type CheckpointStoreApi,
  createCheckpointPort,
  finishCheckpointTurn,
  prepareCheckpointTurn,
  withCheckpointStorageGuard,
  withCheckpointEdit,
  withCheckpointEditAt,
} from '../../src/host/checkpoints/checkpointHost'
import { type CheckpointAvailability, MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import {
  createGitProcess,
  GitExitError,
  GitMissingError,
  processGitProcess,
} from '../../src/host/git'
import {
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  storedUnit,
  turnRecorder,
  write,
} from './helpers/checkpointHarness'
import { enteringShell, noopToolIo } from './helpers/fakeToolIo'
import { removeFolder } from './helpers/temporaryFolders'
import { FakeLogOutputChannel } from './helpers/fakes'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-checkpoint-host-')))

afterAll(async () => {
  await removeFolder(base)
})

/** A store whose every method records its call; only what a test calls matters. */
function fakeStore() {
  const calls: string[] = []
  const done = (call: string) => {
    calls.push(call)
    return Promise.resolve()
  }
  const store: CheckpointStoreApi = {
    instance: 'this-window',
    isNativeUnsafe: false,
    storagePathProblem: (absolutePath) =>
      absolutePath.startsWith('/storage/') ? MODEL_TEXT.checkpointStorageWrite : undefined,
    markNativeBackend: () => done('native'),
    markUnprovenProcess: () => done('unproved'),
    startUnit: (owner) => {
      calls.push(`start ${owner.sessionId} ${owner.unitId}`)
      return Promise.resolve({ sequence: 1 })
    },
    endUnit: (owner, end) => done(`end ${owner.unitId} ${String(end.ranProcesses)}`),
    markTurn: (key, isRunning) => done(`mark ${key} ${String(isRunning)}`),
    turns: () => {
      calls.push('turns')
      return Promise.resolve(['t1'])
    },
    legacyTurns: () => {
      calls.push('legacy')
      return Promise.resolve(['m72'])
    },
    restore: () => {
      calls.push('restore')
      return Promise.resolve({ ok: false as const, reason: 'noCheckpoint' as const })
    },
    redo: () => {
      calls.push('redo')
      return Promise.resolve({ ok: false as const, reason: 'redoGone' as const })
    },
    forgetSession: (sessionId) => done(`forget ${sessionId}`),
    unforgetSession: (sessionId) => done(`unforget ${sessionId}`),
    queueForget: (sessionId) => done(`queue ${sessionId}`),
    maintain: () => done('maintain'),
  }
  return { store, calls }
}

/** What the work throws, or undefined when it settles. */
async function thrownBy(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
  } catch (error: unknown) {
    return error
  }
  return undefined
}

/** A wrapped shell whose activity mark fails when it opens ('entry') or when it closes ('close'). */
async function runWithFailingMark(failAt: 'entry' | 'close') {
  const { port } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
  const failing: CheckpointPort = {
    ...port,
    markTurn: (_key, isRunning) =>
      isRunning === (failAt === 'entry')
        ? Promise.reject(new Error('the store is gone'))
        : Promise.resolve(),
  }
  const work = vi.fn(() => Promise.resolve(PROVEN_SHELL))
  const io = withCheckpointStorageGuard({ ...noopToolIo, runShell: enteringShell(work) }, failing)
  const error = await thrownBy(() => io.runShell('owned fixture', '/ws', 1000))
  return { error, work }
}

/** The checkpoint calls an edit of this path makes in a workspace reached through a link. */
async function leaseCallsFor(file: string) {
  const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
  await withCheckpointEditAt(
    port,
    new FakeLogOutputChannel(),
    vi.fn(),
    { root: '/real/ws', displayRoot: '/link/ws', platform: 'linux' },
    file,
    () => Promise.resolve(),
  )
  return calls
}

const PROVEN_SHELL = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  isTimedOut: false,
  isCancelled: false,
  isWorkspaceShutdownProven: true as const,
}

function portOver(posture: { isTrusted: boolean; isEnabled: boolean; hasGit: boolean }) {
  const { store, calls } = fakeStore()
  const port = createCheckpointPort({
    isNamespaceKnown: () => true,
    store,
    isWorkspaceTrusted: () => posture.isTrusted,
    isEnabled: () => posture.isEnabled,
    hasGit: () => posture.hasGit,
    legacyTurns: () => {
      calls.push('older legacy')
      return Promise.resolve(['m70', 'm72'])
    },
  })
  return { port, calls, store }
}

const OWNER: Owner = { instance: 'this-window', sessionId: 's1', unitKind: 'turn', unitId: 't1' }
const WRITES: TurnWrites = {
  io: noopToolIo,
  memory: { writeFile: () => Promise.resolve(), createFile: () => Promise.resolve() },
}

/** A turn recorder that says what it was asked; its end (the drain) waits for `drained` when given. */
function recorderOver(calls: string[], drained?: Promise<undefined>) {
  return {
    start: (owner: Owner) => {
      calls.push(`writes ${owner.sessionId} ${owner.unitId}`)
      return WRITES
    },
    end: async (owner: Owner) => {
      calls.push(`drain ${owner.unitId}`)
      await drained
      calls.push('drained')
    },
  }
}

/** A port that neither records a unit nor offers a turn or a restore. */
async function expectNothingOffered(
  port: CheckpointPort,
  availability: CheckpointAvailability,
): Promise<void> {
  expect(port.availability()).toBe(availability)
  expect(await port.startTurnUnit('s1', 't1', false)).toBeUndefined()
  expect(await port.turns('s1')).toEqual([])
  expect(await port.legacyTurns('s1')).toEqual([])
  expect(
    await port.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      transcriptTurnIds: ['t1'],
      unsavedPaths: () => [],
    }),
  ).toEqual({
    ok: false,
    reason: 'unavailable',
  })
}

describe('createCheckpointPort (M72, M86)', () => {
  it('refuses unknown canonical namespaces before any process or turn can start', async () => {
    const { store, calls } = fakeStore()
    const port = createCheckpointPort({
      store,
      isNamespaceKnown: () => false,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    await expectNothingOffered(port, 'noFolder')
    await expect(port.markNativeBackend()).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    await expect(port.markUnprovenProcess()).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    await expect(port.markTurn('turn', true)).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    expect(calls).toEqual([])
    const shell = vi.fn(noopToolIo.runShell)
    const wrapped = withCheckpointStorageGuard({ ...noopToolIo, runShell: shell }, port)
    await expect(wrapped.runShell('write something', '/ws', 1000)).rejects.toThrow(
      UI_TEXT.checkpointFailed,
    )
    expect(shell).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^mark workspace-activity:.* false$/)
  })

  it('runs no git in Restricted Mode, and queues an archived conversation for later', async () => {
    const { port, calls } = portOver({ isTrusted: false, isEnabled: true, hasGit: true })
    await expectNothingOffered(port, 'restricted')
    expect(
      await port.redo({
        backend: () => 'modelApi',
        sourceSessionId: 's1',
        restoreId: 'r1',
        unsavedPaths: () => [],
      }),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(await port.startTurnUnit('s1', 'child', true)).toBeUndefined()
    await port.endUnit(OWNER, { ranProcesses: false })
    await port.maintain()
    await port.forgetSession('s1')
    await port.markTurn('k1', true)
    expect(calls).toEqual(['queue s1', 'mark k1 true'])
  })

  it('with the setting off records nothing new, but ends what is under way and a child of a recording turn', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    await expectNothingOffered(port, 'off')
    expect(await port.startTurnUnit('s1', 'child', true)).toEqual({
      instance: 'this-window',
      sessionId: 's1',
      unitKind: 'turn',
      unitId: 'child',
    })
    await port.endUnit(OWNER, { ranProcesses: true })
    await port.redo({
      backend: () => 'modelApi',
      sourceSessionId: 's1',
      restoreId: 'r1',
      unsavedPaths: () => [],
    })
    await port.forgetSession('s1')
    await port.maintain()
    expect(calls).toEqual(['start s1 child', 'end t1 true', 'redo', 'forget s1', 'maintain'])
  })

  it('says when git is missing, and runs none', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: false })
    expect(port.availability()).toBe('noGit')
    expect(await port.startTurnUnit('s1', 't1', false)).toBeUndefined()
    await port.maintain()
    expect(calls).toEqual([])
  })

  it('records and offers units when on, and lists both versions’ legacy turns once', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    expect(port.availability()).toBe('on')
    expect(await port.startTurnUnit('s1', 't1', false)).toEqual(OWNER)
    expect(await port.turns('s1')).toEqual(['t1'])
    expect(await port.legacyTurns('s1')).toEqual(['m70', 'm72'])
    await port.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      transcriptTurnIds: ['t1'],
      unsavedPaths: () => [],
    })
    expect(calls).toEqual(['start s1 t1', 'turns', 'older legacy', 'legacy', 'restore'])
  })

  it('has no folder to checkpoint without a store', async () => {
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store: undefined,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    expect(port.availability()).toBe('noFolder')
    expect(await port.startTurnUnit('s1', 't1', false)).toBeUndefined()
  })

  it('refuses a tool write into the checkpoint storage whatever the setting', () => {
    for (const isEnabled of [true, false]) {
      const { port } = portOver({ isTrusted: true, isEnabled, hasGit: true })
      expect(() => {
        port.refuseStorageWrite('/storage/shadow.git/config')
      }).toThrow(MODEL_TEXT.checkpointStorageWrite)
      expect(() => {
        port.refuseStorageWrite('/ws/a.txt')
      }).not.toThrow()
    }
  })
})

describe('prepareCheckpointTurn and finishCheckpointTurn (M86)', () => {
  it('awaits the unit’s record before admitting queued or scheduled edits', async () => {
    const { port, calls, store } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const persisted = Promise.withResolvers<undefined>()
    store.startUnit = async () => {
      calls.push('start')
      await persisted.promise
      return { sequence: 1 }
    }
    let isAdmitted = false
    const preparation = (async () => {
      await prepareCheckpointTurn(port, recorderOver(calls), 's1', 't2', new FakeLogOutputChannel())
      isAdmitted = true
    })()
    await vi.waitFor(() => {
      expect(calls).toContain('start')
    })
    expect(isAdmitted).toBe(false)
    persisted.resolve(undefined)
    await preparation
    expect(isAdmitted).toBe(true)
    expect(calls).toEqual(['mark s1\0t2 true', 'start', 'writes s1 t2'])
  })

  it('gives a recorded turn its own writes, after its running mark and its unit (spec 5.1)', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    expect(
      await prepareCheckpointTurn(
        port,
        recorderOver(calls),
        's1',
        't1',
        new FakeLogOutputChannel(),
      ),
    ).toEqual({ kind: 'recording', owner: OWNER, writes: WRITES })
    expect(calls).toEqual(['mark s1\0t1 true', 'start s1 t1', 'writes s1 t1'])
  })

  it('marks a turn running and records nothing while checkpoints are off, or with no recorder', async () => {
    const off = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    expect(
      await prepareCheckpointTurn(
        off.port,
        recorderOver(off.calls),
        's1',
        't1',
        new FakeLogOutputChannel(),
      ),
    ).toEqual({ kind: 'off' })
    expect(off.calls).toEqual(['mark s1\0t1 true'])
    const on = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    expect(
      await prepareCheckpointTurn(on.port, undefined, 's1', 't1', new FakeLogOutputChannel()),
    ).toEqual({ kind: 'off' })
    expect(on.calls).toEqual(['mark s1\0t1 true'])
  })

  it('runs a turn whose record failed, unrecorded, logging the failure’s kind without storage paths', async () => {
    const { port, calls, store } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    store.startUnit = () => Promise.reject(new Error('EACCES /private/profile/store'))
    const log = new FakeLogOutputChannel()
    expect(await prepareCheckpointTurn(port, recorderOver(calls), 's1', 't2', log)).toEqual({
      kind: 'failed',
    })
    expect(calls).toEqual(['mark s1\0t2 true'])
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('/private/profile')
  })

  it('gives a child turn its top turn’s decision: recorded with the setting off, unrecorded under an unrecorded top (spec 3.2)', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    const recorder = recorderOver(calls)
    const log = new FakeLogOutputChannel()
    const recording = { kind: 'recording', owner: OWNER, writes: WRITES } as const
    expect(
      await prepareCheckpointTurn(port, recorder, 's1', 'c1', log, { checkpoint: recording }),
    ).toMatchObject({ kind: 'recording', owner: { unitId: 'c1' } })
    expect(
      await prepareCheckpointTurn(port, recorder, 's1', 'c2', log, {
        checkpoint: { kind: 'failed' },
      }),
    ).toMatchObject({ kind: 'recording', owner: { unitId: 'c2' } })
    expect(
      await prepareCheckpointTurn(port, recorder, 's1', 'c3', log, { checkpoint: { kind: 'off' } }),
    ).toEqual({ kind: 'off' })
    // Reloaded children keep their decision independently of today's setting.
    expect(
      await prepareCheckpointTurn(port, recorder, 's1', 'c4', log, {
        checkpoint: undefined,
        recordsFiles: false,
      }),
    ).toEqual({ kind: 'off' })
    expect(calls.filter((call) => !call.startsWith('mark'))).toEqual([
      'start s1 c1',
      'writes s1 c1',
      'start s1 c2',
      'writes s1 c2',
    ])
  })

  it('refuses to run a child turn whose record cannot be made (spec 3.2, row Q)', async () => {
    const { port, calls, store } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    store.startUnit = () => Promise.reject(new Error('EACCES /private/profile/store'))
    const recording = { kind: 'recording', owner: OWNER, writes: WRITES } as const
    for (const top of [{ checkpoint: recording }, { checkpoint: undefined, recordsFiles: true }]) {
      await expect(
        prepareCheckpointTurn(
          port,
          recorderOver(calls),
          's1',
          'c1',
          new FakeLogOutputChannel(),
          top,
        ),
      ).rejects.toThrow(UI_TEXT.checkpointFailed)
    }
    expect(calls.filter((call) => call.startsWith('writes'))).toEqual([])
  })

  it('refuses a reloaded recording child when this window has no recorder', async () => {
    const { port } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    await expect(
      prepareCheckpointTurn(port, undefined, 's1', 'child', new FakeLogOutputChannel(), {
        checkpoint: undefined,
        recordsFiles: true,
      }),
    ).rejects.toThrow(UI_TEXT.childCheckpointFailed)
  })

  it('drains a recorded turn’s writes, then ends its unit, then withdraws its mark', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const drained = Promise.withResolvers<undefined>()
    const ending = finishCheckpointTurn(port, recorderOver(calls, drained.promise), 's1', 't1', {
      checkpoint: { kind: 'recording', owner: OWNER, writes: WRITES },
      ranProcesses: true,
    })
    await vi.waitFor(() => {
      expect(calls).toContain('drain t1')
    })
    // No unit end while a write of the turn is still under way.
    expect(calls).toEqual(['drain t1'])
    drained.resolve(undefined)
    await ending
    expect(calls).toEqual(['drain t1', 'drained', 'end t1 true', 'mark s1\0t1 false'])
  })

  it('only withdraws the mark of a turn that recorded nothing, and keeps it when the end fails', async () => {
    const { port, calls, store } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const recorder = recorderOver(calls)
    for (const checkpoint of [{ kind: 'off' }, { kind: 'failed' }, undefined] as const) {
      await finishCheckpointTurn(port, recorder, 's1', 't2', { checkpoint, ranProcesses: true })
    }
    expect(calls).toEqual(['mark s1\0t2 false', 'mark s1\0t2 false', 'mark s1\0t2 false'])
    calls.length = 0
    store.endUnit = () => Promise.reject(new Error('the seal failed'))
    await expect(
      finishCheckpointTurn(port, recorder, 's1', 't1', {
        checkpoint: { kind: 'recording', owner: OWNER, writes: WRITES },
        ranProcesses: false,
      }),
    ).rejects.toThrow('the seal failed')
    expect(calls).toEqual(['drain t1', 'drained'])
  })
})

describe('withCheckpointStorageGuard (M72, M86)', () => {
  it('D89.5 preserves the shell’s explicit interactive marker through activity tracking', async () => {
    const { port } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const shell = vi.fn(noopToolIo.runShell)
    const io = withCheckpointStorageGuard({ ...noopToolIo, runShell: shell }, port)
    for (const isInteractive of [false, true]) {
      await io.runShell('env', '/ws', 1000, undefined, undefined, undefined, isInteractive)
      expect(shell.mock.calls.at(-1)?.[6]).toBe(isInteractive)
    }
  })

  it('awaits an activity mark before starting shell or hook work', async () => {
    const { store, calls } = fakeStore()
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    store.markTurn = async (_key, isRunning) => {
      if (!isRunning) {
        return
      }
      entered.resolve(undefined)
      await resume.promise
    }
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => false,
      hasGit: () => true,
    })
    const work = vi.fn(() => Promise.resolve(PROVEN_SHELL))
    const io = withCheckpointStorageGuard(
      { ...noopToolIo, runShell: enteringShell(work), runHook: work },
      port,
    )
    const running = io.runShell('owned no-process fixture', '/ws', 1000)
    try {
      await entered.promise
      expect(work).not.toHaveBeenCalled()
    } finally {
      resume.resolve(undefined)
    }
    await running
    expect(work).toHaveBeenCalledOnce()
    expect(calls).not.toContain('unproved')
  })
  // The wrapper asks once after its activity mark, and the wrapped adapter asks
  // again at its own entry (the Windows assembly wait sits between them).
  it.each([
    ['the wrapper’s own check', 1],
    ['the wrapped adapter’s entry', 2],
  ] as const)(
    'starts nothing when %s refuses, and records no uncertainty',
    async (_name, refusal) => {
      const { port, calls } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
      const work = vi.fn(() => Promise.resolve(PROVEN_SHELL))
      const io = withCheckpointStorageGuard({ ...noopToolIo, runShell: enteringShell(work) }, port)
      let asked = 0
      const result = await io.runShell('owned fixture', '/ws', 1000, undefined, undefined, () => {
        asked += 1
        if (asked === refusal) {
          throw new Error('the owner changed')
        }
      })
      expect(result).toMatchObject({ isEntryRefused: true, isWorkspaceShutdownProven: true })
      expect(asked).toBe(refusal)
      expect(work).not.toHaveBeenCalled()
      expect(calls).not.toContain('unproved')
      expect(calls.at(-1)).toMatch(/^mark workspace-activity:.* false$/)
    },
  )

  it('throws a ShellEntryError, and starts nothing, when the activity mark cannot be made', async () => {
    const { error, work } = await runWithFailingMark('entry')
    expect(error).toBeInstanceOf(ShellEntryError)
    expect(error).toMatchObject({ message: UI_TEXT.checkpointFailed })
    expect(work).not.toHaveBeenCalled()
  })

  it('throws a plain Error when the checkpoint cannot be closed after the command ran', async () => {
    const { error, work } = await runWithFailingMark('close')
    expect(error).toMatchObject({ message: UI_TEXT.checkpointFailed })
    expect(error).not.toBeInstanceOf(ShellEntryError)
    expect(work).toHaveBeenCalledOnce()
  })

  it('runs the wrapped shell once when both entries admit it', async () => {
    const { port } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    const work = vi.fn(() => Promise.resolve(PROVEN_SHELL))
    const io = withCheckpointStorageGuard({ ...noopToolIo, runShell: enteringShell(work) }, port)
    const guard = vi.fn()
    const result = await io.runShell('owned fixture', '/ws', 1000, undefined, undefined, guard)
    expect(guard).toHaveBeenCalledTimes(2)
    expect(work).toHaveBeenCalledOnce()
    expect(result.isEntryRefused).toBeUndefined()
    expect(result.exitCode).toBe(0)
  })

  it('refuses every tool write into the checkpoint storage, and records nothing (M86)', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const writes: string[] = []
    const io: ToolIo = {
      ...noopToolIo,
      writeFile: (absolutePath) => {
        writes.push(absolutePath)
        return Promise.resolve()
      },
      writeFileIfUnchanged: (absolutePath) => {
        writes.push(absolutePath)
        return Promise.resolve('written')
      },
      reserveFile: (absolutePath) => {
        writes.push(absolutePath)
        return noopToolIo.reserveFile(absolutePath)
      },
    }
    const wrapped = withCheckpointStorageGuard(io, port)
    const options = { expectedCanonicalPath: '/x', unsavedAt: [] }
    const refusal = MODEL_TEXT.checkpointStorageWrite
    await expect(wrapped.writeFile('/storage/config', 'x')).rejects.toThrow(refusal)
    await expect(wrapped.reserveFile('/storage/image.png')).rejects.toThrow(refusal)
    await expect(
      wrapped.writeFileIfUnchanged('/storage/config', 'expected', 'x', options),
    ).rejects.toThrow(refusal)
    await wrapped.writeFile('/ws/.env', 'KEY=1')
    await wrapped.reserveFile('/ws/image.png')
    expect(await wrapped.writeFileIfUnchanged('/ws/.env', 'expected', 'KEY=2', options)).toBe(
      'written',
    )
    expect(writes).toEqual(['/ws/.env', '/ws/image.png', '/ws/.env'])
    // No store call at all: the window's io records nothing, whatever the setting.
    expect(calls).toEqual([])
  })
})

describe('a unit under way when the setting goes off (M86)', () => {
  afterEach(removeCheckpointFolders)

  it(
    'ends a unit that started recording, so its restore puts the file back once the setting is on again',
    async () => {
      const h = await harness()
      await write(h.root, '.env', 'KEY=before\n')
      const setting = { isEnabled: true }
      const port = createCheckpointPort({
        isNamespaceKnown: () => true,
        store: h.store,
        isWorkspaceTrusted: () => true,
        isEnabled: () => setting.isEnabled,
        hasGit: () => true,
      })
      const recorder = turnRecorder(h)
      const checkpoint = await prepareCheckpointTurn(port, recorder, 's1', 't1', h.log)
      if (checkpoint.kind !== 'recording') {
        throw new Error('expected a recording turn')
      }
      setting.isEnabled = false
      // The turn's own io, the real recorder's, in the window the store restores in.
      const file = path.join(h.root, '.env')
      await checkpoint.writes.io.writeFile(file, 'KEY=after\n', file)
      await finishCheckpointTurn(port, recorder, 's1', 't1', { checkpoint, ranProcesses: false })
      expect(storedUnit(h.storage, 't1')).toMatchObject({
        status: 'complete',
        writes: [{ path: '.env', outcome: 'done' }],
      })
      setting.isEnabled = true
      expect(await restoreOutcome(port, 't1')).toMatchObject({
        ok: true,
        changed: ['.env'],
        refused: [],
      })
      expect(await read(h.root, '.env')).toBe('KEY=before\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('withCheckpointEditAt (M72)', () => {
  const linux = { root: '/ws', platform: 'linux' } as const
  const log = new FakeLogOutputChannel()

  it('holds the pure lease around work inside the workspace, and lets it go when the work fails', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const check = vi.fn()
    const done = await withCheckpointEditAt(
      port,
      log,
      check,
      linux,
      '/ws/.agents/memory/a.md',
      () => {
        calls.push('work')
        return Promise.resolve('written')
      },
    )
    expect(done).toBe('written')
    const [opened, work, closed] = calls
    expect(opened).toMatch(/^mark workspace-activity:\S+ true$/)
    expect(work).toBe('work')
    expect(closed).toMatch(/^mark workspace-activity:\S+ false$/)
    expect(check).toHaveBeenCalledTimes(2)
    calls.length = 0
    await expect(
      withCheckpointEditAt(port, log, check, linux, '/ws/a.md', () =>
        Promise.reject(new Error('EPERM')),
      ),
    ).rejects.toThrow('EPERM')
    expect(calls.map((call) => call.split(' ').at(-1))).toEqual(['true', 'false'])
  })

  it.each([
    ['another folder beside it', linux, '/ws-other/a.md'],
    ['a path that climbs out', linux, '/ws/../home/a.md'],
    ['the folder itself', linux, '/ws'],
    ['another letter case on a case-sensitive platform', linux, '/WS/a.md'],
    ['another drive', { root: String.raw`C:\Ws`, platform: 'win32' }, String.raw`D:\ws\a.md`],
    ['no workspace folder', { root: undefined, platform: 'linux' }, '/ws/a.md'],
    ['no path at all', linux, undefined],
  ] as const)('takes no lease for %s, and asks the guard first', async (_name, workspace, file) => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const check = vi.fn()
    await withCheckpointEditAt(port, log, check, workspace, file, () => {
      calls.push('work')
      return Promise.resolve()
    })
    expect(calls).toEqual(['work'])
    expect(check).toHaveBeenCalledOnce()
  })

  it.each([
    ['the display spelling of a linked workspace', '/link/ws/a.md'],
    ['the canonical spelling', '/real/ws/a.md'],
  ])('holds the lease for a path in %s', async (_name, file) => {
    expect(await leaseCallsFor(file)).toHaveLength(2)
  })

  it('takes no lease for a path beside both spellings of the workspace', async () => {
    expect(await leaseCallsFor('/link/ws-other/a.md')).toEqual([])
  })

  it('folds the letter case of a Windows path, as the file system does', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    await withCheckpointEditAt(
      port,
      new FakeLogOutputChannel(),
      vi.fn(),
      { root: String.raw`C:\Ws`, platform: 'win32' },
      String.raw`c:\ws\notes\a.md`,
      () => Promise.resolve(),
    )
    expect(calls).toHaveLength(2)
  })

  it('reports a completed edit as done when its lease cannot be let go, and logs it (M86 V)', async () => {
    const { port } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    const failing: CheckpointPort = {
      ...port,
      markTurn: (_key, isRunning) =>
        isRunning ? Promise.resolve() : Promise.reject(new Error('the presence file is gone')),
    }
    const warned = new FakeLogOutputChannel()
    const done = await withCheckpointEdit(failing, warned, vi.fn(), () =>
      Promise.resolve('written'),
    )
    expect(done).toBe('written')
    // Logged by kind only, as every checkpoint failure is: no storage path reaches the log.
    expect(warned.warn).toHaveBeenCalledWith(
      "An edit's checkpoint lease could not be let go: Error",
    )
    // A failed edit keeps its own failure, not the lease's.
    await expect(
      withCheckpointEdit(failing, warned, vi.fn(), () => Promise.reject(new Error('EPERM'))),
    ).rejects.toThrow('EPERM')
  })

  it.each(['/ws/a.md', '/elsewhere/a.md'])(
    'runs no work once the guard refuses (%s)',
    async (file) => {
      const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
      const work = vi.fn(() => Promise.resolve())
      await expect(
        withCheckpointEditAt(
          port,
          new FakeLogOutputChannel(),
          () => {
            throw new Error('the window closed')
          },
          linux,
          file,
          work,
        ),
      ).rejects.toThrow('the window closed')
      expect(work).not.toHaveBeenCalled()
      expect(calls).toEqual([])
    },
  )
})

describe('createGitProcess (M72)', () => {
  const git = processGitProcess()
  const env = process.env

  it('feeds stdin and returns stdout as bytes', async () => {
    const oid = await git(['hash-object', '--stdin'], {
      cwd: base,
      env,
      input: 'hello\n',
      timeoutMs: 30_000,
    })
    expect(oid.toString('utf8').trim()).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('rejects a non-zero exit with its code and what git said', async () => {
    const failing = git(['cat-file', '-t', 'not-an-object'], { cwd: base, env, timeoutMs: 30_000 })
    await expect(failing).rejects.toBeInstanceOf(GitExitError)
    await expect(failing).rejects.toMatchObject({ exitCode: 128 })
  })

  it('rejects when git is only reachable relatively, without running anything', async () => {
    const spawnFake = vi.fn()
    const relative = createGitProcess({
      platform: 'linux',
      env: { PATH: '.:bin' },
      fileExists: () => true,
      spawn: spawnFake,
    })
    await expect(
      relative(['status'], { cwd: base, env: {}, timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(GitMissingError)
    expect(spawnFake).not.toHaveBeenCalled()
  })

  it('ends a running command when the window closes, and starts none after', async () => {
    // A stand-in `git` on its own PATH: this Node, which sleeps when asked.
    const bin = path.join(base, 'fake-git-bin')
    await mkdir(bin, { recursive: true })
    const fake = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git')
    await copyFile(process.execPath, fake)
    const sleeper = createGitProcess({
      platform: process.platform,
      env: { PATH: bin },
      fileExists: existsSync,
      spawn,
    })
    const stopping = new AbortController()
    const running = sleeper(['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: base,
      env: process.env,
      timeoutMs: 60_000,
      signal: stopping.signal,
    })
    setTimeout(() => {
      stopping.abort()
    }, 200)
    await expect(running).rejects.toThrow(/window is closing/)
    await expect(
      sleeper(['-e', '0'], {
        cwd: base,
        env: process.env,
        timeoutMs: 60_000,
        signal: stopping.signal,
      }),
    ).rejects.toThrow(/not started/)
  })
})
