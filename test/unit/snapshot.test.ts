import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { type HostToWebviewMessage, parsePersistedState } from '../../src/shared/protocol'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

// M25 (PLAN.md D28): the conversation the panel keeps in VS Code's webview
// state, so the crash screen's Reload comes back with it.

/** What VS Code keeps: `setState` serialises the value to JSON. */
function throughJson(value: unknown): unknown {
  // Not structuredClone: JSON drops the keys whose value is undefined, as VS Code's copy does.
  const text = JSON.stringify(value)
  return JSON.parse(text) as unknown
}

function fromHost(state: UiState, message: HostToWebviewMessage): UiState {
  return uiReducer(state, { type: 'hostMessage', message, at: 0 })
}

const approval = {
  approvalId: 'a1',
  requirementId: { approvalId: 'a1', sourceIndex: 1 },
  subject: { kind: 'shell', command: 'ls; pwd' },
  rawArgs: '{"command":"ls; pwd"}',
  availableChoices: [
    { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  ],
  isProtectedWrite: false,
  isJudgeEscalated: false,
  decidedSourceIndex: 0,
}

/** Every row kind, with the optional fields both set and left out. */
const shown: UiState = {
  ...initialUiState,
  sessionId: 's1',
  title: 'Parser',
  draft: 'and then',
  sequence: 7,
  localSequence: 2,
  lastCompletedTurnId: 't0',
  usage: { inputTokens: 5, outputTokens: 2, cachedTokens: 1 },
  context: { usedTokens: 7, windowTokens: 10, pressure: 'normal' },
  todos: [{ text: 'Write tests', status: 'inProgress', activeForm: 'Writing tests' }],
  goal: { objective: 'Ship it', status: 'active', percentComplete: 40, nextWork: 'Docs' },
  reference: { intent: 'reply', role: 'assistant', entryId: 'm0', text: 'Use pnpm.' },
  transcript: [
    {
      kind: 'user',
      id: 'l1',
      seq: 1,
      text: 'fix it',
      status: 'sent',
      attachments: [{ id: 'a', name: 'shot.png', width: 2, height: 3 }],
      referenceLabel: 'Replying to: Use pnpm.',
      turnId: 't1',
    },
    { kind: 'reasoning', id: 'r1', parts: ['why'], isStreaming: false, startedAt: 0 },
    {
      kind: 'tool',
      id: 'sh1',
      tool: 'powershell',
      args: '{}',
      status: 'inProgress',
      output: 'partial',
      isBackground: false,
      approval,
    },
    {
      kind: 'tool',
      id: 'e1',
      tool: 'edit_file',
      args: '{}',
      status: 'completed',
      output: '',
      patchRef: { id: 'p1', byteLen: 10 },
      patchSummary: { files: 1, added: 1, removed: 0 },
      completedSeq: 4.5,
      isBackground: false,
      questionOutcome: {
        outcome: 'answered',
        answers: [{ questionId: 'q', selectedLabel: 'Red' }],
      },
    },
    { kind: 'subagent', id: 'sa1', seq: 3, status: 'inProgress', childSessionId: 'child-1' },
    { kind: 'assistant', id: 'm1', text: 'Working on it', isStreaming: true },
    { kind: 'item', id: 'i1', itemKind: 'workflow', status: 'completed' },
    { kind: 'error', id: 'x1', text: 'The turn failed.' },
    { kind: 'notice', id: 'n1', level: 'warning', text: 'careful' },
  ],
  childTranscripts: {
    'child-1': {
      name: 'Notes agent',
      entries: [{ kind: 'assistant', id: 'c1', text: 'done', isStreaming: false }],
    },
  },
}

describe('the saved conversation (M25)', () => {
  it('comes back whole through JSON and waits for the host to confirm its session', () => {
    const restored = restoredUiState(throughJson(webviewStateOf(shown, true)))
    expect(restored.transcript).toEqual(shown.transcript)
    expect(restored.childTranscripts).toEqual(shown.childTranscripts)
    expect(restored.childOwners).toEqual({ c1: 'child-1' })
    expect(restored).toMatchObject({
      title: 'Parser',
      draft: 'and then',
      sequence: 7,
      localSequence: 2,
      lastCompletedTurnId: 't0',
      usage: shown.usage,
      context: shown.context,
      todos: shown.todos,
      goal: shown.goal,
      reference: shown.reference,
      restoredSessionId: 's1',
      pendingRestore: { sessionId: 's1', isTranscriptOmitted: false },
    })
    const live = fromHost(restored, { type: 'surfaceState', sessionId: 's1', activeTurnId: 't1' })
    expect(live.transcript).toEqual(shown.transcript)
    expect(live.activeTurnId).toBe('t1')
  })

  it('leaves the session id where the host reads it after a window reload (D15)', () => {
    expect(parsePersistedState(throughJson(webviewStateOf(shown, true)))).toEqual({
      sessionId: 's1',
    })
    const waiting: UiState = { ...initialUiState, restoredSessionId: 'old' }
    expect(parsePersistedState(throughJson(webviewStateOf(waiting, true)))).toEqual({
      sessionId: 'old',
    })
    expect(webviewStateOf(initialUiState, false)).toEqual({})
  })

  it('keeps only the session id past the size cap, and says so once the host confirms it', () => {
    const saved = throughJson(webviewStateOf(shown, true, 100))
    expect(saved).toEqual({ sessionId: 's1', omittedSessionId: 's1' })
    const restored = restoredUiState(saved)
    expect(restored.transcript).toEqual([])
    const confirmed = fromHost(restored, { type: 'surfaceState', sessionId: 's1' })
    expect(confirmed.transcript).toMatchObject([{ kind: 'notice', text: UI_TEXT.snapshotTooLong }])
    expect(webviewStateOf({ ...shown, sessionId: undefined }, true, 100)).toEqual({})
  })

  it('keeps only the session id when the state crashed the first render', () => {
    expect(webviewStateOf(shown, false)).toEqual({ sessionId: 's1' })
  })

  it('starts empty for state that is not ours, and keeps a sound session id', () => {
    for (const raw of [undefined, null, 'old', { sessionId: 7 }]) {
      expect(restoredUiState(raw)).toBe(initialUiState)
    }
    const saved = throughJson(webviewStateOf(shown, true))
    const stale = Object.assign({}, saved, { snapshot: { version: 999 } })
    expect(restoredUiState(stale)).toMatchObject({
      restoredSessionId: 's1',
      pendingRestore: undefined,
      transcript: [],
    })
    const broken = {
      sessionId: 's1',
      snapshot: Object.assign({}, webviewStateOf(shown, true).snapshot, {
        transcript: [{ kind: 'x' }],
      }),
    }
    expect(restoredUiState(broken)).toMatchObject({ pendingRestore: undefined, transcript: [] })
    const wrongSession = throughJson({ ...webviewStateOf(shown, true), sessionId: 'other' })
    expect(restoredUiState(wrongSession)).toMatchObject({
      restoredSessionId: 'other',
      pendingRestore: undefined,
      transcript: [],
    })
  })
})
