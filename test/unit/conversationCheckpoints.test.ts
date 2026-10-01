import { describe, expect, it, vi } from 'vitest'
import type { CheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import type {
  CaptureResult,
  RestoreOutcome,
  Snapshot,
} from '../../src/host/checkpoints/checkpointStore'
import {
  ConversationCheckpoints,
  type NoticeLevel,
} from '../../src/host/conversation/conversationCheckpoints'
import {
  BYTES_PER_MIB,
  CHECKPOINT_CAPTURE_MAX_BYTES,
  CHECKPOINT_MAX_FILES,
  CHECKPOINT_NAMED_FILES_MAX,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, plural } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel } from './helpers/fakes'

function snapshot(tree: string, skipped: readonly string[] = []): Snapshot {
  return {
    tree,
    coverage: { skipped, repositories: [] },
    inventory: { files: new Map(), skippedFolders: [], isPartial: false },
    createdAt: 0,
    pin: `refs/muse-spark/pin/${tree}`,
    folders: [],
  }
}

interface HarnessOptions {
  readonly backend?: () => 'museCode' | 'modelApi' | undefined
  readonly availability?: () => CheckpointAvailability
  readonly capture?: (count: number) => Promise<CaptureResult>
  readonly record?: () => Promise<void>
  readonly turns?: () => Promise<readonly string[]>
  readonly restore?: () => Promise<RestoreOutcome>
  readonly redo?: () => Promise<RestoreOutcome>
  /** A running mark that cannot be written (the presence file). */
  readonly isMarkFailing?: boolean
}

/** A port that hands out numbered captures and records what it was asked (M72). */
function harness(options: HarnessOptions = {}) {
  const calls: string[] = []
  const released: string[] = []
  const marks: string[] = []
  // Marks and captures in the order they happened.
  const order: string[] = []
  let captures = 0
  const port: CheckpointPort = {
    isNativeUnsafe: () => false,
    markNativeBackend: () => Promise.resolve(),
    markUnprovenProcess: () => Promise.resolve(),
    legacyTurns: () => Promise.resolve([]),
    availability: options.availability ?? (() => 'on'),
    capture: () => {
      captures += 1
      order.push('capture')
      return (
        options.capture?.(captures) ??
        Promise.resolve({ ok: true, snapshot: snapshot(`c${String(captures)}`) })
      )
    },
    release: (taken) => {
      released.push(taken.tree)
      return Promise.resolve()
    },
    record: (sessionId, turnId, taken) => {
      calls.push(`record ${sessionId} ${turnId} ${taken.tree}`)
      return options.record?.() ?? Promise.resolve()
    },
    markTurn: (key, isRunning) => {
      const name = key.startsWith('pending:') ? 'message' : key.replace('\0', ' ')
      marks.push(`${name} ${String(isRunning)}`)
      order.push(`mark ${name} ${String(isRunning)}`)
      return isRunning && options.isMarkFailing === true
        ? Promise.reject(new Error('disk full'))
        : Promise.resolve()
    },
    endTurn: (sessionId, turnId) => {
      calls.push(`end ${sessionId} ${turnId}`)
      return Promise.resolve()
    },
    turns: options.turns ?? (() => Promise.resolve([])),
    restore: options.restore ?? (() => Promise.resolve({ ok: false, reason: 'noCheckpoint' })),
    redo: options.redo ?? (() => Promise.resolve({ ok: false, reason: 'redoGone' })),
    forgetSession: () => Promise.resolve(),
    maintain: () => Promise.resolve(),
    beforeToolWrite: () => Promise.resolve(),
  }
  const posted: HostToWebviewMessage[] = []
  const notices: [NoticeLevel, string, string | undefined][] = []
  const checkpoints = new ConversationCheckpoints({
    backend: options.backend ?? (() => 'museCode'),
    port,
    post: (message) => {
      posted.push(message)
    },
    notice: (level, text, redoRestoreId) => {
      notices.push([level, text, redoRestoreId])
    },
    confirm: () => Promise.resolve(true),
    unsavedPaths: () => [],
    log: new FakeLogOutputChannel(),
  })
  return { checkpoints, calls, released, marks, order, posted, notices }
}

const restored = (overrides: Partial<Extract<RestoreOutcome, { ok: true }>> = {}) =>
  ({
    ok: true,
    restoreId: 'r1',
    changed: [],
    refused: [],
    unsure: [],
    isIgnoredIncomplete: false,
    isRedoSpent: false,
    ...overrides,
  }) as const

describe('ConversationCheckpoints (M72)', () => {
  it('does not end or unpublish a core-owned Model API turn when its surface detaches', async () => {
    const { checkpoints, calls, marks } = harness({ backend: () => 'modelApi' })
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await vi.waitFor(() => {
      expect(calls).toContain('record s1 t1 c1')
    })
    await checkpoints.sessionChanged(undefined)
    checkpoints.dispose()
    expect(calls.filter((call) => call.startsWith('end'))).toEqual([])
    expect(marks).not.toContain('s1 t1 false')
  })
  it('gives each turn the capture taken before its own message, whichever event comes first', async () => {
    const { checkpoints, calls, released } = harness()
    await checkpoints.sessionChanged('s1')
    const first = await checkpoints.beforeTurn('s1')
    const second = await checkpoints.beforeTurn('s1')
    // The first turn starts before its acknowledgement; the second message steers.
    checkpoints.turnStarted('s1', 't1')
    checkpoints.accepted(first, 't1', true)
    checkpoints.accepted(second, 't1', false)
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 t1 c1'])
    })
    expect(released).toEqual(['c2'])
    // An acknowledgement before the start binds the capture it names.
    const third = await checkpoints.beforeTurn('s1')
    checkpoints.accepted(third, 't2', true)
    checkpoints.turnStarted('s1', 't2')
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 t1 c1', 'record s1 t2 c3'])
    })
  })

  it('publishes a message as running before its capture, and its turn until it ends, checkpoint or not', async () => {
    const { checkpoints, calls, order, notices } = harness({
      capture: () => Promise.resolve({ ok: false, reason: 'failed', detail: 'x' }),
    })
    await checkpoints.sessionChanged('s1')
    const capture = await checkpoints.beforeTurn('s1')
    checkpoints.accepted(capture, 't1', true)
    checkpoints.turnCompleted('t1')
    expect(order).toEqual([
      'mark message true',
      'capture',
      'mark s1 t1 true',
      'mark message false',
      'mark s1 t1 false',
    ])
    expect(calls).toEqual([])
    expect(notices.map(([, text]) => text)).toEqual([
      fill(UI_TEXT.checkpointUnavailable, { reason: UI_TEXT.checkpointFailed }),
    ])
  })

  it('does not send a message whose running mark cannot be written', async () => {
    const { checkpoints, order } = harness({ isMarkFailing: true })
    await checkpoints.sessionChanged('s1')
    await expect(checkpoints.beforeTurn('s1')).rejects.toThrow(UI_TEXT.sendMarkFailed)
    expect(order).toEqual(['mark message true', 'mark message false'])
  })

  it('lets go of the capture of a message that was not sent', async () => {
    const { checkpoints, calls, released } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.dropPending(await checkpoints.beforeTurn('s1'))
    expect(released).toEqual(['c1'])
    checkpoints.turnStarted('s1', 'scheduled')
    await vi.waitFor(() => {
      expect(calls).toEqual(['record s1 scheduled c2'])
    })
  })

  it('ends a running turn when its conversation leaves the panel, or the panel closes', async () => {
    const { checkpoints, calls, marks } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await checkpoints.sessionChanged('s2')
    await vi.waitFor(() => {
      expect(marks).toContain('s1 t1 false')
    })
    checkpoints.accepted(await checkpoints.beforeTurn('s2'), 't9', true)
    checkpoints.dispose()
    await vi.waitFor(() => {
      expect(calls.toSorted((a, b) => a.localeCompare(b))).toEqual([
        'end s1 t1',
        'end s2 t9',
        'record s1 t1 c1',
        'record s2 t9 c2',
      ])
    })
    expect(marks).toEqual([
      'message true',
      's1 t1 true',
      'message false',
      's1 t1 false',
      'message true',
      's2 t9 true',
      'message false',
      's2 t9 false',
    ])
    // Each end came after its own record.
    expect(calls.indexOf('end s1 t1')).toBeGreaterThan(calls.indexOf('record s1 t1 c1'))
    expect(calls.indexOf('end s2 t9')).toBeGreaterThan(calls.indexOf('record s2 t9 c2'))
    // A later end for either is not recorded twice.
    checkpoints.turnCompleted('t1')
    checkpoints.turnCompleted('t9')
    expect(calls.filter((call) => call.startsWith('end'))).toHaveLength(2)
  })

  it('tells the panel only what changed', async () => {
    const { checkpoints, posted } = harness({ backend: () => 'modelApi' })
    await checkpoints.sessionChanged('s1')
    checkpoints.postState()
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await vi.waitFor(() => {
      expect(posted.at(-1)).toMatchObject({ turnIds: ['t1'] })
    })
    const told = posted.length
    checkpoints.postState()
    expect(posted).toHaveLength(told)
    checkpoints.panelReady()
    expect(posted).toHaveLength(told + 1)
  })

  it('offers no turn while checkpoints are not on', async () => {
    let availability: CheckpointAvailability = 'on'
    const { checkpoints, posted } = harness({
      backend: () => 'modelApi',
      availability: () => availability,
      turns: () => Promise.resolve(['t1']),
    })
    await checkpoints.sessionChanged('s1')
    expect(posted.at(-1)).toMatchObject({ availability: 'on', turnIds: ['t1'] })
    availability = 'restricted'
    checkpoints.postState()
    expect(posted.at(-1)).toMatchObject({ availability: 'restricted', turnIds: [] })
  })
})

describe('ConversationCheckpoints when things go wrong (M72)', () => {
  it('says once per reason why a turn has no checkpoint', async () => {
    const reasons = ['tooManyFiles', 'tooLarge', 'noGit', 'noGit', 'pathTooLong'] as const
    const { checkpoints, notices } = harness({
      capture: (count) =>
        Promise.resolve({ ok: false, reason: reasons[count - 1] ?? 'failed', detail: 'x' }),
    })
    await checkpoints.sessionChanged('s1')
    for (const _reason of reasons) {
      const pending = await checkpoints.beforeTurn('s1')
      expect(pending?.snapshot).toBeUndefined()
    }
    const unavailable = (reason: string) => fill(UI_TEXT.checkpointUnavailable, { reason })
    expect(notices.map(([, text]) => text)).toEqual([
      unavailable(fill(UI_TEXT.checkpointTooManyFiles, { count: CHECKPOINT_MAX_FILES })),
      unavailable(
        fill(UI_TEXT.checkpointTooLarge, { size: CHECKPOINT_CAPTURE_MAX_BYTES / BYTES_PER_MIB }),
      ),
      unavailable(UI_TEXT.checkpointNoGit),
      unavailable(UI_TEXT.checkpointPathTooLong),
    ])
  })

  it('names what a checkpoint left out, and says when one was not recorded', async () => {
    const leftOut = Array.from(
      { length: CHECKPOINT_NAMED_FILES_MAX + 2 },
      (_, index) => `big${String(index)}.bin`,
    )
    let isRecordFailing = false
    const { checkpoints, notices, posted } = harness({
      backend: () => 'modelApi',
      capture: (count) =>
        Promise.resolve({ ok: true, snapshot: snapshot(`c${String(count)}`, leftOut) }),
      record: () => (isRecordFailing ? Promise.reject(new Error('disk full')) : Promise.resolve()),
    })
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await vi.waitFor(() => {
      expect(notices).toHaveLength(1)
    })
    expect(notices[0]?.[1]).toBe(
      fill(UI_TEXT.checkpointLeftOut, {
        files: fill(UI_TEXT.namedFilesMore, {
          files: leftOut.slice(0, CHECKPOINT_NAMED_FILES_MAX).join(', '),
          count: 2,
        }),
      }),
    )
    isRecordFailing = true
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't2', true)
    await vi.waitFor(() => {
      expect(notices.at(-1)?.[1]).toBe(
        fill(UI_TEXT.checkpointUnavailable, { reason: UI_TEXT.checkpointFailed }),
      )
    })
    expect(posted.at(-1)).toMatchObject({ turnIds: ['t1'] })
  })

  it('reports a restore that threw, and one that changed only part of the files', async () => {
    let outcome: Promise<RestoreOutcome> = Promise.reject(new Error('git crashed'))
    const { checkpoints, notices } = harness({ backend: () => 'modelApi', restore: () => outcome })
    await checkpoints.sessionChanged('s1')
    const thrown = await checkpoints.restore('s1', 't1')
    expect([thrown.isRestored, thrown.isComplete]).toEqual([false, false])
    thrown.post()
    expect(notices).toEqual([['error', UI_TEXT.restoreFailed, undefined]])
    outcome = Promise.resolve(
      restored({
        changed: ['a.ts'],
        refused: [{ path: 'b.ts', reason: 'failed' }],
        unsure: ['a.ts'],
      }),
    )
    const partial = await checkpoints.restore('s1', 't1')
    expect([partial.isRestored, partial.isComplete]).toEqual([true, false])
    partial.post()
    expect(notices.slice(1)).toEqual([
      ['info', plural(UI_TEXT.restoreDone, 1), 'r1'],
      ['warning', fill(UI_TEXT.restoreUnsure, { files: 'a.ts' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedFailed, { files: 'b.ts' }), undefined],
    ])
  })

  it.each([
    ['a clean restore', {}, true],
    [
      'a file with no earlier copy',
      { refused: [{ path: 'a.ts', reason: 'noEarlierCopy' }] },
      false,
    ],
    [
      'a file never in the checkpoint',
      { refused: [{ path: 'a.ts', reason: 'notInCheckpoint' }] },
      false,
    ],
    ['an unsaved file', { refused: [{ path: 'a.ts', reason: 'unsaved' }] }, false],
    ['ignored files that could not all be put back', { isIgnoredIncomplete: true }, false],
  ] as const)(
    'lets the conversation rewind only when no file is left behind: %s',
    async (_name, overrides, isComplete) => {
      const { checkpoints } = harness({
        backend: () => 'modelApi',
        restore: () => Promise.resolve(restored(overrides)),
      })
      await checkpoints.sessionChanged('s1')
      const report = await checkpoints.restore('s1', 't1')
      expect(report.isComplete).toBe(isComplete)
    },
  )

  it('says when another window on the folder runs a turn, or a checkpoint fails', async () => {
    const outcomes: RestoreOutcome[] = [
      { ok: false, reason: 'captureFailed' },
      { ok: false, reason: 'turnElsewhere' },
    ]
    const { checkpoints, notices } = harness({
      backend: () => 'modelApi',
      record: () => Promise.reject(new Error('record failed')),
      restore: () => Promise.resolve(outcomes.shift() ?? { ok: false, reason: 'noCheckpoint' }),
    })
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await vi.waitFor(() => {
      expect(notices).toHaveLength(1)
    })
    const busy = await checkpoints.restore('s1', 't1')
    busy.post()
    const elsewhere = await checkpoints.restore('s1', 't1')
    elsewhere.post()
    expect(notices.map(([, text]) => text)).toEqual([
      fill(UI_TEXT.checkpointUnavailable, { reason: UI_TEXT.checkpointFailed }),
      UI_TEXT.restoreFailed,
      UI_TEXT.restoreTurnElsewhere,
    ])
  })

  it('names why a checkpoint of the files as they are now could not be taken', async () => {
    const { checkpoints, notices } = harness({
      backend: () => 'modelApi',
      restore: () =>
        Promise.resolve({ ok: false, reason: 'captureFailed', captureRefusal: 'noGit' }),
    })
    await checkpoints.sessionChanged('s1')
    const report = await checkpoints.restore('s1', 't1')
    report.post()
    expect(notices).toEqual([
      ['error', `${UI_TEXT.restoreFailed}: ${UI_TEXT.checkpointNoGit}`, undefined],
    ])
  })

  it('names a path git cannot use as the reason a restore could not start', async () => {
    const { checkpoints, notices } = harness({
      backend: () => 'modelApi',
      restore: () =>
        Promise.resolve({ ok: false, reason: 'captureFailed', captureRefusal: 'pathTooLong' }),
    })
    await checkpoints.sessionChanged('s1')
    const report = await checkpoints.restore('s1', 't1')
    report.post()
    expect(notices).toEqual([
      ['error', `${UI_TEXT.restoreFailed}: ${UI_TEXT.checkpointPathTooLong}`, undefined],
    ])
  })

  it('tells the panel whether a Redo button is spent', async () => {
    const outcomes: (() => Promise<RestoreOutcome>)[] = [
      () => Promise.resolve(restored({ changed: ['a.ts'], isRedoSpent: false })),
      () => Promise.resolve(restored({ changed: ['b.ts'], isRedoSpent: true })),
      () => Promise.resolve({ ok: false, reason: 'redoGone' }),
      () => Promise.reject(new Error('git crashed')),
    ]
    const { checkpoints, posted, notices } = harness({
      backend: () => 'modelApi',
      redo: () => outcomes.shift()?.() ?? Promise.reject(new Error('no more')),
    })
    for (let index = 0; index < 4; index += 1) {
      await checkpoints.redo('r1')
    }
    expect(
      posted
        .filter((message) => message.type === 'restoreRedone')
        .map((message) => message.isSpent),
    ).toEqual([false, true, true, false])
    expect(notices.at(-1)).toEqual(['error', UI_TEXT.restoreFailed, undefined])
  })
})
