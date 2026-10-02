import { describe, expect, it } from 'vitest'
import type { CheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import type {
  RedoRequest,
  RestoreOutcome,
  RestoreRequest,
} from '../../src/host/checkpoints/checkpointStore'
import {
  ConversationCheckpoints,
  type NoticeLevel,
} from '../../src/host/conversation/conversationCheckpoints'
import {
  CHECKPOINT_NAMED_FILES_MAX,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill, plural } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel } from './helpers/fakes'

interface HarnessOptions {
  readonly backend?: () => 'museCode' | 'modelApi' | undefined
  readonly availability?: () => CheckpointAvailability
  readonly turns?: () => Promise<readonly string[]>
  readonly legacyTurns?: () => Promise<readonly string[]>
  readonly restore?: (request: RestoreRequest) => Promise<RestoreOutcome>
  readonly redo?: (request: RedoRequest) => Promise<RestoreOutcome>
  /** A running mark that cannot be written (the presence file). */
  readonly isMarkFailing?: boolean
}

/** A port that records the marks it was asked for, and the restores (M72, M86). */
function harness(options: HarnessOptions = {}) {
  const marks: string[] = []
  const requests: (RestoreRequest | RedoRequest)[] = []
  const port: CheckpointPort = {
    isNativeUnsafe: () => false,
    markNativeBackend: () => Promise.resolve(),
    markUnprovenProcess: () => Promise.resolve(),
    legacyTurns: options.legacyTurns ?? (() => Promise.resolve([])),
    availability: options.availability ?? (() => 'on'),
    markTurn: (key, isRunning) => {
      const name = key.startsWith('pending:') ? 'message' : key.replace('\0', ' ')
      marks.push(`${name} ${String(isRunning)}`)
      return isRunning && options.isMarkFailing === true
        ? Promise.reject(new Error('disk full'))
        : Promise.resolve()
    },
    startTurnUnit: () => Promise.resolve(undefined),
    endUnit: () => Promise.resolve(),
    turns: options.turns ?? (() => Promise.resolve([])),
    restore: (request) => {
      requests.push(request)
      return options.restore?.(request) ?? Promise.resolve({ ok: false, reason: 'noCheckpoint' })
    },
    redo: (request) => {
      requests.push(request)
      return options.redo?.(request) ?? Promise.resolve({ ok: false, reason: 'redoGone' })
    },
    forgetSession: () => Promise.resolve(),
    unforgetSession: () => Promise.resolve(),
    maintain: () => Promise.resolve(),
    refuseStorageWrite: () => undefined,
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
  return { checkpoints, marks, posted, notices, requests }
}

const restored = (overrides: Partial<Extract<RestoreOutcome, { ok: true }>> = {}) =>
  ({
    ok: true,
    restoreId: 'r1',
    changed: [],
    unchanged: [],
    refused: [],
    ranProcesses: false,
    isRedoSpent: false,
    ...overrides,
  }) as const

/** The report of a Model API restore of `t1` the store answered with these overrides. */
async function reportOf(overrides: Partial<Extract<RestoreOutcome, { ok: true }>>) {
  const { checkpoints, notices } = harness({
    backend: () => 'modelApi',
    restore: () => Promise.resolve(restored(overrides)),
  })
  await checkpoints.sessionChanged('s1')
  return { report: await checkpoints.restore('s1', 't1', ['t1']), notices }
}

describe('ConversationCheckpoints (M72, M86)', () => {
  it('does not unpublish a core-owned Model API turn when its surface detaches', async () => {
    const { checkpoints, marks } = harness({ backend: () => 'modelApi' })
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await checkpoints.sessionChanged(undefined)
    checkpoints.dispose()
    // The backend's own turn lifecycle publishes and withdraws a Model API turn.
    expect(marks).toEqual(['message true', 'message false'])
  })

  it('publishes a message as running before it is sent, and its turn until it ends', async () => {
    const { checkpoints, marks } = harness()
    await checkpoints.sessionChanged('s1')
    const mark = await checkpoints.beforeTurn('s1')
    checkpoints.accepted(mark, 't1', true)
    checkpoints.turnCompleted('t1')
    expect(marks).toEqual(['message true', 's1 t1 true', 'message false', 's1 t1 false'])
  })

  it('lets a turn that started before its acknowledgement take over the oldest message’s mark', async () => {
    const { checkpoints, marks } = harness()
    await checkpoints.sessionChanged('s1')
    const first = await checkpoints.beforeTurn('s1')
    const second = await checkpoints.beforeTurn('s1')
    checkpoints.turnStarted('s1', 't1')
    checkpoints.accepted(first, 't1', true)
    // The second message steered the running turn: it starts none.
    checkpoints.accepted(second, 't1', false)
    expect(marks).toEqual([
      'message true',
      'message true',
      's1 t1 true',
      'message false',
      'message false',
    ])
  })

  it('does not send a message whose running mark cannot be written', async () => {
    const { checkpoints, marks } = harness({ isMarkFailing: true })
    await checkpoints.sessionChanged('s1')
    await expect(checkpoints.beforeTurn('s1')).rejects.toThrow(UI_TEXT.sendMarkFailed)
    expect(marks).toEqual(['message true', 'message false'])
  })

  it('lets go of the mark of a message that was not sent', async () => {
    const { checkpoints, marks } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.dropPending(await checkpoints.beforeTurn('s1'))
    expect(marks).toEqual(['message true', 'message false'])
  })

  it('ends a running turn when its conversation leaves the panel, or the panel closes', async () => {
    const { checkpoints, marks } = harness()
    await checkpoints.sessionChanged('s1')
    checkpoints.accepted(await checkpoints.beforeTurn('s1'), 't1', true)
    await checkpoints.sessionChanged('s2')
    checkpoints.accepted(await checkpoints.beforeTurn('s2'), 't9', true)
    checkpoints.dispose()
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
    // A later end for either is not withdrawn twice.
    checkpoints.turnCompleted('t1')
    checkpoints.turnCompleted('t9')
    expect(marks).toHaveLength(8)
  })

  it('tells the panel only what changed, and reads a Model API turn’s record when it ends', async () => {
    let recorded: readonly string[] = []
    const { checkpoints, posted } = harness({
      backend: () => 'modelApi',
      turns: () => Promise.resolve(recorded),
    })
    await checkpoints.sessionChanged('s1')
    checkpoints.postState()
    const told = posted.length
    checkpoints.postState()
    expect(posted).toHaveLength(told)
    recorded = ['t1']
    checkpoints.turnCompleted('t1')
    await expect.poll(() => posted.at(-1)).toMatchObject({ turnIds: ['t1'] })
    checkpoints.panelReady()
    expect(posted.at(-1)).toMatchObject({ turnIds: ['t1'] })
  })

  it('offers no turn while checkpoints are not on, and lists legacy turns as read-only', async () => {
    let availability: CheckpointAvailability = 'on'
    const { checkpoints, posted } = harness({
      backend: () => 'modelApi',
      availability: () => availability,
      turns: () => Promise.resolve(['t1']),
      legacyTurns: () => Promise.resolve(['m72', 't1']),
    })
    await checkpoints.sessionChanged('s1')
    expect(posted.at(-1)).toMatchObject({
      availability: 'on',
      turnIds: ['t1'],
      legacyTurnIds: ['m72'],
    })
    availability = 'restricted'
    checkpoints.postState()
    expect(posted.at(-1)).toMatchObject({ availability: 'restricted', turnIds: [] })
  })

  it('S: offers no file restore for a Muse Code conversation, and says why', async () => {
    const { checkpoints, posted, notices } = harness({
      backend: () => 'museCode',
      turns: () => Promise.resolve(['t1']),
    })
    await checkpoints.sessionChanged('s1')
    expect(posted.at(-1)).toMatchObject({ canRestore: false, restoreBlocker: 'modelApiOnly' })
    expect(await checkpoints.confirmRestore(false)).toBe(false)
    expect(notices).toEqual([['warning', UI_TEXT.checkpointsModelApiOnly, undefined]])
  })
})

describe('ConversationCheckpoints reports (M72, M86)', () => {
  it('keeps confirmations and outcome wording truthful about commands, children and Redo', () => {
    expect(UI_TEXT.restoreCommandsNote).toBe(
      'Commands, hooks, MCP tools or background work were active in these turns; files they changed are not undone. Check your version control.',
    )
    expect(UI_TEXT.rewindCodeConfirmDetail).toContain('Restore files does not undo it either')
    expect(UI_TEXT.childCheckpointFailed).toContain('The subagent turn did not run')
    expect(UI_TEXT.redoNothing).toBe('Nothing left to put back.')
  })
  it('reports an unchanged Redo with its own no-op text and file count', async () => {
    const { checkpoints, notices } = harness({
      backend: () => 'modelApi',
      redo: () => Promise.resolve(restored({ unchanged: ['a.ts'], isRedoSpent: true })),
    })
    await checkpoints.redo('r1', 's1')
    expect(notices).toEqual([
      ['info', UI_TEXT.redoNothing, undefined],
      ['info', plural(UI_TEXT.restoreUnchanged, 1), undefined],
    ])
  })
  it('passes the transcript’s turn ids with the restore', async () => {
    const { checkpoints, requests } = harness({ backend: () => 'modelApi' })
    await checkpoints.sessionChanged('s1')
    await checkpoints.restore('s1', 't1', ['t1', 'child:1', 't2'])
    expect(requests).toMatchObject([
      { sessionId: 's1', turnId: 't1', transcriptTurnIds: ['t1', 'child:1', 't2'] },
    ])
  })

  it('reports a restore that threw, and one that left files as they were', async () => {
    let outcome: Promise<RestoreOutcome> = Promise.reject(new Error('git crashed'))
    const { checkpoints, notices } = harness({ backend: () => 'modelApi', restore: () => outcome })
    await checkpoints.sessionChanged('s1')
    const thrown = await checkpoints.restore('s1', 't1', ['t1'])
    expect([thrown.isRestored, thrown.isComplete]).toEqual([false, false])
    thrown.post()
    expect(notices).toEqual([['error', UI_TEXT.restoreFailed, undefined]])
    const named = Array.from(
      { length: CHECKPOINT_NAMED_FILES_MAX + 2 },
      (_, index) => `n${String(index)}.ts`,
    )
    outcome = Promise.resolve(
      restored({
        changed: ['a.ts'],
        unchanged: ['same.ts'],
        refused: [
          { path: 'f.ts', reason: 'failed' },
          { path: 'big.bin', reason: 'tooLarge' },
          { path: 'l.ts', reason: 'linked' },
          { path: 'k.ts', reason: 'notKept' },
          { path: 'o.ts', reason: 'orderUnknown' },
          { path: 'b.ts', reason: 'changedBetween' },
          ...named.map((path) => ({ path, reason: 'changedAfter' as const })),
          { path: 'u.ts', reason: 'unsaved' },
        ],
      }),
    )
    const partial = await checkpoints.restore('s1', 't1', ['t1'])
    expect([partial.isRestored, partial.isComplete]).toEqual([true, false])
    partial.post()
    expect(notices.slice(1)).toEqual([
      ['info', plural(UI_TEXT.restoreDone, 1), 'r1'],
      ['info', plural(UI_TEXT.restoreUnchanged, 1), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedUnsaved, { files: 'u.ts' }), undefined],
      [
        'warning',
        fill(UI_TEXT.restoreRefusedChanged, {
          files: fill(UI_TEXT.namedFilesMore, {
            files: named.slice(0, CHECKPOINT_NAMED_FILES_MAX).join(', '),
            count: 2,
          }),
        }),
        undefined,
      ],
      ['warning', fill(UI_TEXT.restoreRefusedBetween, { files: 'b.ts' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedOrderUnknown, { files: 'o.ts' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedLinked, { files: 'l.ts' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedNotKept, { files: 'k.ts' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedTooLarge, { files: 'big.bin' }), undefined],
      ['warning', fill(UI_TEXT.restoreRefusedFailed, { files: 'f.ts' }), undefined],
    ])
  })

  it.each([
    [
      'M: nothing to do when every file was already as before',
      { restoreId: undefined, unchanged: ['a.ts'] },
      () => [
        ['info', UI_TEXT.restoreNothing, undefined],
        ['info', plural(UI_TEXT.restoreUnchanged, 1), undefined],
      ],
    ],
    [
      'R: that commands ran, and the conversation may still rewind',
      { changed: ['a.ts'], ranProcesses: true },
      () => [
        ['info', plural(UI_TEXT.restoreDone, 1), 'r1'],
        ['warning', UI_TEXT.restoreCommandsNote, undefined],
      ],
    ],
  ] as const)('says %s', async (_name, overrides, expected) => {
    const { report, notices } = await reportOf(overrides)
    expect(report.isComplete).toBe(true)
    report.post()
    expect(notices).toEqual(expected())
  })

  it.each([
    ['a clean restore', {}, true],
    ['a file changed afterwards', { refused: [{ path: 'a.ts', reason: 'changedAfter' }] }, false],
    ['a file not kept', { refused: [{ path: 'a.ts', reason: 'notKept' }] }, false],
    ['an unsaved file', { refused: [{ path: 'a.ts', reason: 'unsaved' }] }, false],
    ['commands that ran', { ranProcesses: true }, true],
  ] as const)(
    'lets the conversation rewind only when no file is left behind: %s',
    async (_name, overrides, isComplete) => {
      const { report } = await reportOf(overrides)
      expect(report.isComplete).toBe(isComplete)
    },
  )

  it.each([
    ['writesIncomplete', () => UI_TEXT.restoreWritesIncomplete],
    ['legacyInRange', () => UI_TEXT.restoreLegacyInRange],
    ['legacyWindowOpen', () => UI_TEXT.restoreLegacyWindowOpen],
    ['turnElsewhere', () => UI_TEXT.restoreTurnElsewhere],
    ['nativeUnsafe', () => UI_TEXT.checkpointsNativeUnsafe],
    ['noCheckpoint', () => UI_TEXT.restoreNoCheckpoint],
  ] as const)('says why a restore did nothing: %s', async (reason, text) => {
    const { checkpoints, notices } = harness({
      backend: () => 'modelApi',
      restore: () => Promise.resolve({ ok: false, reason }),
    })
    await checkpoints.sessionChanged('s1')
    const report = await checkpoints.restore('s1', 't1', ['t1'])
    expect([report.isRestored, report.isComplete]).toEqual([false, false])
    report.post()
    expect(notices).toEqual([['warning', text(), undefined]])
  })

  it('tells the panel whether a Redo button is spent, and binds the Redo to its conversation', async () => {
    const outcomes: (() => Promise<RestoreOutcome>)[] = [
      () => Promise.resolve(restored({ changed: ['a.ts'], isRedoSpent: false })),
      () => Promise.resolve(restored({ changed: ['b.ts'], isRedoSpent: true })),
      () => Promise.resolve({ ok: false, reason: 'redoGone' }),
      () => Promise.reject(new Error('git crashed')),
    ]
    const { checkpoints, posted, notices, requests } = harness({
      backend: () => 'modelApi',
      redo: () => outcomes.shift()?.() ?? Promise.reject(new Error('no more')),
    })
    for (let index = 0; index < 4; index += 1) {
      await checkpoints.redo('r1', 's1')
    }
    expect(
      posted
        .filter((message) => message.type === 'restoreRedone')
        .map((message) => message.isSpent),
    ).toEqual([false, true, true, false])
    expect(notices.at(-1)).toEqual(['error', UI_TEXT.restoreFailed, undefined])
    expect(
      requests.every((request) => 'sourceSessionId' in request && request.sourceSessionId === 's1'),
    ).toBe(true)
  })
})
