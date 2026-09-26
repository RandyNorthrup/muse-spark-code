// The conversation the panel keeps in VS Code's webview state (M25, PLAN.md
// D28). Beside the session id the host reads after a window reload (D15) the
// webview saves a snapshot of what it shows, so the crash screen's Reload (or
// a panel moved to another window) comes back with its transcript, its
// pending cards and its running turn instead of an empty panel. What comes
// back is untrusted like any boundary input: parsed with zod, versioned, and
// kept only once the host confirms its session is still the live one (the
// reducer's `surfaceState`).

import * as z from 'zod/mini'
import { sessionGoalSchema, todoItemSchema } from '../../shared/agentEvents'
import { WEBVIEW_SNAPSHOT_VERSION, WEBVIEW_STATE_MAX_CHARS } from '../../shared/constants'
import { chatReferenceSchema } from '../../shared/protocol'
import {
  childTranscriptSchema,
  contextSummarySchema,
  transcriptEntrySchema,
  usageSummarySchema,
} from './transcriptEntries'
import { initialUiState, type UiState } from './uiState'

const snapshotSchema = z.object({
  version: z.literal(WEBVIEW_SNAPSHOT_VERSION),
  /** The session the transcript belongs to; the restore needs the host to hold it live. */
  sessionId: z.optional(z.string()),
  title: z.optional(z.string()),
  transcript: z.readonly(z.array(transcriptEntrySchema)),
  childTranscripts: z.record(z.string(), childTranscriptSchema),
  todos: z.readonly(z.array(todoItemSchema)),
  // M45: optional, so a snapshot saved before the goal strip still reads.
  goal: z.optional(sessionGoalSchema),
  usage: z.optional(usageSummarySchema),
  context: z.optional(contextSummarySchema),
  sequence: z.number(),
  localSequence: z.number(),
  draft: z.string(),
  reference: z.optional(chatReferenceSchema),
  lastCompletedTurnId: z.optional(z.string()),
})
type UiSnapshot = z.infer<typeof snapshotSchema>

const webviewStateSchema = z.object({
  /** What the host resumes after a window reload (D15, `parsePersistedState`). */
  sessionId: z.optional(z.string()),
  /** The conversation as shown, validated separately so a stale shape loses only itself. */
  snapshot: z.optional(z.unknown()),
  /** The session whose transcript was too long to save (WEBVIEW_STATE_MAX_CHARS). */
  omittedSessionId: z.optional(z.string()),
})
export type WebviewState = z.infer<typeof webviewStateSchema>

function snapshotOf(state: UiState): UiSnapshot {
  return {
    version: WEBVIEW_SNAPSHOT_VERSION,
    sessionId: state.sessionId,
    title: state.title,
    transcript: state.transcript,
    childTranscripts: state.childTranscripts,
    todos: state.todos,
    goal: state.goal,
    usage: state.usage,
    context: state.context,
    sequence: state.sequence,
    localSequence: state.localSequence,
    draft: state.draft,
    reference: state.reference,
    lastCompletedTurnId: state.lastCompletedTurnId,
  }
}

/**
 * What goes into the webview state. The session id stays until a session is
 * live here or the user clears (a restored panel whose resume failed keeps
 * it for the next reload); the snapshot rides along unless it is over the
 * size cap, or `isTranscriptKept` is false because the state crashed the
 * app's first render and bringing it back would crash it again.
 */
export function webviewStateOf(
  state: UiState,
  isTranscriptKept: boolean,
  maxChars = WEBVIEW_STATE_MAX_CHARS,
): WebviewState {
  const sessionId = state.sessionId ?? state.restoredSessionId
  const base: WebviewState = sessionId === undefined ? {} : { sessionId }
  if (!isTranscriptKept) {
    return base
  }
  const snapshot = snapshotOf(state)
  if (JSON.stringify(snapshot).length <= maxChars) {
    return { ...base, snapshot }
  }
  return state.sessionId === undefined ? base : { ...base, omittedSessionId: state.sessionId }
}

/** Which child transcript holds each row (the reducer's delta index). */
function childOwnersOf(snapshot: UiSnapshot): Record<string, string> {
  return Object.fromEntries(
    Object.entries(snapshot.childTranscripts).flatMap(([childId, child]) =>
      child.entries.map((entry) => [entry.id, childId]),
    ),
  )
}

/**
 * The state a webview document starts from: empty, or the saved
 * conversation waiting for the host's `surfaceState` to keep or drop it.
 * Anything that does not parse starts empty, keeping the session id when
 * that part is sound.
 */
export function restoredUiState(raw: unknown): UiState {
  const persisted = webviewStateSchema.safeParse(raw)
  if (!persisted.success) {
    return initialUiState
  }
  const { sessionId, snapshot, omittedSessionId } = persisted.data
  const base: UiState = { ...initialUiState, restoredSessionId: sessionId }
  const parsed = snapshotSchema.safeParse(snapshot)
  // A valid snapshot for another session must not supply history details here.
  if (parsed.success && parsed.data.sessionId === sessionId) {
    const saved = parsed.data
    return {
      ...base,
      title: saved.title,
      transcript: saved.transcript,
      childTranscripts: saved.childTranscripts,
      childOwners: childOwnersOf(saved),
      todos: saved.todos,
      goal: saved.goal,
      usage: saved.usage,
      context: saved.context,
      sequence: saved.sequence,
      localSequence: saved.localSequence,
      draft: saved.draft,
      reference: saved.reference,
      lastCompletedTurnId: saved.lastCompletedTurnId,
      pendingRestore: { sessionId: saved.sessionId, isTranscriptOmitted: false },
    }
  }
  return omittedSessionId === undefined
    ? base
    : { ...base, pendingRestore: { sessionId: omittedSessionId, isTranscriptOmitted: true } }
}
