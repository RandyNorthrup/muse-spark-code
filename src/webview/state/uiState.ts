// Webview UI state: a pure reducer over host messages and local edits. No DOM
// access here; the components apply focus and caret changes. Timestamps come
// in with the action (`at`) so reasoning durations stay deterministic in tests.
// The transcript row shapes live in transcriptEntries.ts as zod schemas, so a
// conversation saved across a reload is validated before it comes back (M25).

import type { AgentEvent, ItemSnapshot, RequirementRef, TodoItem } from '../../shared/agentEvents'
import {
  CHAT_REFERENCE_LABEL_CHARS,
  DEFAULT_EFFORT,
  type DictationEngine,
  type DictationUiStatus,
  type EffortLevel,
  HIDDEN_ITEM_KINDS,
  MILLISECONDS_PER_SECOND,
  type PermissionMode,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type {
  AttachmentSummary,
  AuthStatus,
  BackendKind,
  ChatReference,
  EditRef,
  EditorContextSummary,
  HostToWebviewMessage,
  MentionItem,
  ModelOption,
  SettingsSnapshot,
  SignInMethod,
  SkillOption,
} from '../../shared/protocol'
import { EMPTY_PAID_TALLY, type PaidState } from '../../shared/paid'
import type { SessionRow } from '../../shared/sessions'
import type { AccountFacts, SubscriptionUsage, UsageInsights } from '../../shared/usage'
import { toolLabel } from '../toolPresentation'
import type {
  ChildTranscript,
  ContextSummary,
  NoticeLevel,
  OutputRef,
  PendingApproval,
  PendingQuestion,
  TranscriptEntry,
  UsageSummary,
} from './transcriptEntries'

export type {
  ChildTranscript,
  ContextSummary,
  PendingApproval,
  PendingQuestion,
  TranscriptEntry,
  UsageSummary,
} from './transcriptEntries'

/** What the Account & usage dialog shows (M8, M14): the host's last `usageReport`. */
export interface UsageReport {
  readonly backend: BackendKind
  readonly subscription: SubscriptionUsage | undefined
  readonly account: AccountFacts | undefined
  readonly insights: { readonly day: UsageInsights; readonly week: UsageInsights } | undefined
}

/**
 * The last sentence for the screen-reader live region (M8). `sequence`
 * grows on every announcement so the same text twice is still read twice.
 */
export interface Announcement {
  readonly text: string
  readonly sequence: number
}

/** The microphone button (M9). */
export interface DictationUiState {
  readonly status: DictationUiStatus
  readonly reason: string | undefined
  /** Muse Voice while the paid engine is the microphone's (M35): it says so. */
  readonly engine: DictationEngine
}

export interface MentionResults {
  readonly requestId: number
  readonly items: readonly MentionItem[]
}

export interface OutputPage {
  readonly content: string
  readonly isEof: boolean
  readonly nextOffset: number
}

/**
 * A conversation the panel brought back from its saved state (M25), waiting
 * for the host to say which session is live: kept when it is the same one,
 * dropped otherwise (a window reload restarts every host).
 */
export interface PendingRestore {
  readonly sessionId: string | undefined
  /** The transcript was too long to save; only a notice can come back. */
  readonly isTranscriptOmitted: boolean
}

export interface UiState {
  readonly phase: 'connecting' | 'ready'
  readonly emptyStateHint: string
  readonly composerPlaceholder: string
  readonly settings: SettingsSnapshot | undefined
  /** The session's name once the host allocates one (`session/nameChanged`). */
  readonly title: string | undefined
  /** The active session (rename and fork are offered with one), M6. */
  readonly sessionId: string | undefined
  /** False where the host refuses rename and fork (D26: Muse Code 1.3.0 on Windows). */
  readonly canEditSessions: boolean
  /** The workspace's stored sessions, once the History dialog asked (M6). */
  readonly sessions: readonly SessionRow[] | undefined
  readonly archivedIds: readonly string[]
  readonly draft: string
  /** Incremented per host `focusInput`; the composer focuses when it changes. */
  readonly focusRequests: number
  /** Text waiting to be inserted at the composer caret, if any. */
  readonly pendingInsert: string | undefined
  readonly auth: {
    readonly status: AuthStatus
    readonly detail: string | undefined
    /** The backend in use (M7); undefined until the host has decided. */
    readonly backend: BackendKind | undefined
    /** The sign-in paths the gate offers; undefined means both. */
    readonly methods: readonly SignInMethod[] | undefined
  }
  readonly model:
    { readonly modelId: string; readonly contextLimit: number | undefined } | undefined
  readonly models: readonly ModelOption[]
  /** undefined until the host has listed them (needs a session). */
  readonly skills: readonly SkillOption[] | undefined
  readonly effort: EffortLevel
  readonly isThinkingEnabled: boolean
  readonly permissionMode: PermissionMode
  readonly attachments: readonly AttachmentSummary[]
  readonly mentionResults: MentionResults | undefined
  readonly transcript: readonly TranscriptEntry[]
  readonly activeTurnId: string | undefined
  /** The last turn the host reported finished (M25): a late `turnAccepted` for it starts nothing. */
  readonly lastCompletedTurnId: string | undefined
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  /** undefined until the host answered `readUsage` for this window. */
  readonly usageReport: UsageReport | undefined
  /** What the next message replies to or quotes (M17); the composer chip. */
  readonly reference: ChatReference | undefined
  /** Subagent transcripts by child session id (M14). */
  readonly childTranscripts: Readonly<Record<string, ChildTranscript>>
  /** Which child transcript holds an item (M25), so a delta finds it without a scan. */
  readonly childOwners: Readonly<Record<string, string>>
  /**
   * Conversation rows that arrived for a turn the conversation was not known
   * to run, by turn (M25): a subagent's items can reach the parent stream
   * before the row that names its child session, and move to its transcript
   * once that row arrives.
   */
  readonly strayItems: Readonly<Record<string, readonly string[]>>
  /** The chips a pending message took from the composer, by local id (M25). */
  readonly unsentAttachments: Readonly<Record<string, readonly AttachmentSummary[]>>
  /**
   * Images of a refused message the host may still hold but the composer no
   * longer shows (M25): the app asks the host to drop them, so none linger
   * unseen and come back as chips after a reload.
   */
  readonly attachmentsToRelease: readonly string[]
  /** The composer banner (M14): an unsupported upload, until dismissed. */
  readonly banner: string | undefined
  readonly announcement: Announcement | undefined
  /** The microphone button (M9): `reason` explains an unavailable one. */
  readonly dictation: DictationUiState
  /** The paid features that are on and this window's tally (M33, PLAN.md D30). */
  readonly paid: PaidState
  readonly todos: readonly TodoItem[]
  /** Fetched output pages keyed by `${itemId}:${outputRef}`. */
  readonly outputPages: Readonly<Record<string, OutputPage>>
  /** Monotonic counter behind locally generated transcript ids. */
  readonly localSequence: number
  /**
   * Monotonic arrival counter over every item the reducer takes in (M20):
   * user messages take it as `seq`, tool rows as `completedSeq` when they
   * complete, so the rewind can order edits across agents.
   */
  readonly sequence: number
  /** The active editor as the host last reported it (M5). */
  readonly editorContext: EditorContextSummary | undefined
  /** The file whose chip the user closed; forgotten when another file is active. */
  readonly dismissedEditorPath: string | undefined
  /**
   * The session a restored panel stored (D15), kept in the webview state
   * until a session is live here or the user clears (M25), so a failed
   * resume can be tried again on the next reload.
   */
  readonly restoredSessionId: string | undefined
  /** A restored conversation waiting for the host's `surfaceState` (M25). */
  readonly pendingRestore: PendingRestore | undefined
  /** Clears this panel made whose host echo has not come back yet (M25). */
  readonly pendingClearEchoes: number
}

export type UiAction =
  | { readonly type: 'hostMessage'; readonly message: HostToWebviewMessage; readonly at: number }
  | { readonly type: 'draftChanged'; readonly draft: string }
  | { readonly type: 'insertRequested'; readonly text: string }
  | { readonly type: 'insertApplied' }
  | { readonly type: 'focusRequested' }
  | {
      readonly type: 'submitted'
      readonly localId: string
      readonly text: string
      readonly attachments: readonly AttachmentSummary[]
      readonly contextLabel: string | undefined
      /** What the message replies to or quotes (M17); absent for a plain send. */
      readonly reference?: ChatReference | undefined
    }
  /** The composer now replies to an output or quotes a passage (M17). */
  | { readonly type: 'referenceSet'; readonly reference: ChatReference }
  | { readonly type: 'referenceCleared' }
  | { readonly type: 'attachmentRemoved'; readonly id: string }
  /** The panel's own New Conversation; the host echoes it back (M25). */
  | { readonly type: 'conversationCleared' }
  /** The × on the composer banner (M14). */
  | { readonly type: 'bannerDismissed' }
  /** The × on the open-file chip. */
  | { readonly type: 'editorContextDismissed' }
  /** The user chose on an approval card; lock that stage until the host moves on. */
  | {
      readonly type: 'approvalDecided'
      readonly approvalId: string
      readonly requirementId: RequirementRef
    }
  /** The user answered or cancelled a question card; lock it until the host settles it (M25). */
  | { readonly type: 'questionSubmitted'; readonly userInputId: string }
  /** A line for the transcript the webview itself has to say (M25). */
  | { readonly type: 'noticeRaised'; readonly level: NoticeLevel; readonly text: string }
  /** An image the composer refused before encoding it (M25): the banner, as a host refusal. */
  | { readonly type: 'attachmentRefused'; readonly name: string; readonly reason: string }
  /** The app asked the host to drop these images (M25). */
  | { readonly type: 'attachmentsReleased'; readonly ids: readonly string[] }

export const initialUiState: UiState = {
  phase: 'connecting',
  emptyStateHint: '',
  composerPlaceholder: '',
  settings: undefined,
  title: undefined,
  sessionId: undefined,
  canEditSessions: true,
  sessions: undefined,
  archivedIds: [],
  draft: '',
  focusRequests: 0,
  pendingInsert: undefined,
  auth: { status: 'checking', detail: undefined, backend: undefined, methods: undefined },
  model: undefined,
  models: [],
  skills: undefined,
  effort: DEFAULT_EFFORT,
  isThinkingEnabled: true,
  permissionMode: 'manual',
  attachments: [],
  mentionResults: undefined,
  transcript: [],
  activeTurnId: undefined,
  lastCompletedTurnId: undefined,
  usage: undefined,
  context: undefined,
  usageReport: undefined,
  reference: undefined,
  childTranscripts: {},
  childOwners: {},
  strayItems: {},
  unsentAttachments: {},
  attachmentsToRelease: [],
  banner: undefined,
  announcement: undefined,
  dictation: { status: 'idle', reason: undefined, engine: 'system' },
  paid: { features: [], tally: EMPTY_PAID_TALLY },
  todos: [],
  outputPages: {},
  localSequence: 0,
  sequence: 0,
  editorContext: undefined,
  dismissedEditorPath: undefined,
  restoredSessionId: undefined,
  pendingRestore: undefined,
  pendingClearEchoes: 0,
}

const SUMMARY_FIELD_PREFIX = 'summary.'
const OUTPUT_FIELD = 'output'
const TEXT_FIELD = 'text'
const IN_PROGRESS = 'inProgress'
const COMPLETED = 'completed'
const REJECTED = 'rejected'
const USER_MESSAGE_KIND = 'userMessage'
const SUBAGENT_KIND = 'subagent'
// A refusal that is about the image's size or count (M25), or a read that
// failed (M39), not its type: the banner says so instead of "Unsupported
// file type". Read per refusal, so the reasons are the installed table's.
function isStatedRefusal(reason: string): boolean {
  return [
    UI_TEXT.attachmentTooLarge,
    UI_TEXT.attachmentLimit,
    UI_TEXT.attachmentUnreadable,
  ].includes(reason)
}

/** A record's own value for `key`; never one of `Object.prototype`'s members. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** The record without `key`. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.hasOwn(record, key)
    ? Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
    : record
}

/** Queue a sentence for the live region; nothing to say leaves the state alone. */
function announce(state: UiState, text: string | undefined): UiState {
  return text === undefined
    ? state
    : { ...state, announcement: { text, sequence: (state.announcement?.sequence ?? 0) + 1 } }
}

/**
 * What the live region says when a turn ends. It is the only live region
 * (M25): the rows themselves carry no alert roles, so a failure's reason is
 * read out here.
 */
function turnAnnouncement(terminal: string, reason: string | undefined): string | undefined {
  switch (terminal) {
    case COMPLETED: {
      return UI_TEXT.announceTurnCompleted
    }
    case 'failed': {
      return reason === undefined
        ? UI_TEXT.announceTurnFailed
        : `${UI_TEXT.announceTurnFailed}: ${reason}`
    }
    case 'cancelled': {
      return UI_TEXT.announceTurnCancelled
    }
    default: {
      return undefined
    }
  }
}

/** "Listening" when recording starts, "Stopped listening" when it ends. */
function dictationAnnouncement(
  previous: DictationUiStatus,
  next: DictationUiStatus,
): string | undefined {
  if (next === 'listening' && previous !== 'listening') {
    return UI_TEXT.announceListening
  }
  return next === 'idle' && previous === 'listening' ? UI_TEXT.announceStoppedListening : undefined
}

/** Whether a tool status is an outcome the row shows as a failure (not running, done or cut off). */
export function isFailedStatus(status: string): boolean {
  return status !== IN_PROGRESS && status !== COMPLETED && status !== TOOL_STATUS_INTERRUPTED
}

/** "PowerShell: Failed" when a row turns failed or rejected (M25); nothing otherwise. */
function toolFailureAnnouncement(
  previous: TranscriptEntry | undefined,
  next: TranscriptEntry | undefined,
): string | undefined {
  if (next?.kind !== 'tool' || !isFailedStatus(next.status)) {
    return undefined
  }
  if (previous?.kind === 'tool' && previous.status === next.status) {
    return undefined
  }
  const outcome = next.status === REJECTED ? UI_TEXT.toolRejected : UI_TEXT.toolFailed
  return `${toolLabel(next.tool) ?? next.tool}: ${outcome}`
}

/** The composer chip and the user card's line for a reference: "Replying to: …" (M17). */
export function referenceLabel(reference: ChatReference): string {
  const heads: Readonly<Record<ChatReference['intent'], string>> = {
    reply: UI_TEXT.referenceReply,
    question: UI_TEXT.referenceQuestion,
    comment: UI_TEXT.referenceComment,
  }
  const excerpt = reference.text.replaceAll(/\s+/g, ' ').trim()
  const shown =
    excerpt.length > CHAT_REFERENCE_LABEL_CHARS
      ? `${excerpt.slice(0, CHAT_REFERENCE_LABEL_CHARS)}…`
      : excerpt
  return `${heads[reference.intent]}: ${shown}`
}

export function outputPageKey(itemId: string, outputRef: string): string {
  return `${itemId}:${outputRef}`
}

/**
 * Replace one entry. Rows that change are almost always the newest (a
 * streaming reply, a running tool), so the search runs from the end (M25);
 * an unchanged entry leaves the array as it was.
 */
function updateEntry(
  transcript: readonly TranscriptEntry[],
  id: string,
  update: (entry: TranscriptEntry) => TranscriptEntry,
): readonly TranscriptEntry[] {
  const index = transcript.findLastIndex((entry) => entry.id === id)
  const entry = transcript[index]
  if (entry === undefined) {
    return transcript
  }
  const next = update(entry)
  return next === entry ? transcript : transcript.with(index, next)
}

function findEntry(
  transcript: readonly TranscriptEntry[],
  id: string,
): TranscriptEntry | undefined {
  return transcript.findLast((entry) => entry.id === id)
}

function withInsert(state: UiState, text: string): UiState {
  return {
    ...state,
    pendingInsert: (state.pendingInsert ?? '') + text,
    focusRequests: state.focusRequests + 1,
  }
}

function withNotice(state: UiState, level: NoticeLevel, text: string): UiState {
  const localSequence = state.localSequence + 1
  return {
    ...state,
    localSequence,
    transcript: [
      ...state.transcript,
      { kind: 'notice', id: `notice:${String(localSequence)}`, level, text },
    ],
  }
}

/** The composer banner for a refused upload (M14); a size or count refusal says why (M25). */
function withBanner(state: UiState, name: string, reason: string): UiState {
  const banner = isStatedRefusal(reason)
    ? `${name}: ${reason}`
    : `${UI_TEXT.unsupportedFileTitle} ${name}. ${UI_TEXT.unsupportedFileDetail}`
  return announce({ ...state, banner }, `${name}: ${reason}`)
}

function toolEntry(item: ItemSnapshot): TranscriptEntry {
  return {
    kind: 'tool',
    id: item.itemId,
    tool: item.tool ?? item.kind,
    args: item.args ?? '',
    status: item.status,
    output: item.visibleOutput ?? '',
    failureReason: item.failureReason,
    patchSummary: item.patchSummary,
    patchRef: item.patchRef,
    outputRef: item.outputRef,
    completedSeq: undefined,
    isBackground: item.background === true,
    backgroundInitiator: item.backgroundInitiator,
    paid: item.paid,
    approval: undefined,
    approvalOutcome: undefined,
    question: undefined,
    questionOutcome: undefined,
  }
}

function subagentEntry(item: ItemSnapshot, seq: number): SubagentEntry {
  return {
    kind: 'subagent',
    id: item.itemId,
    seq,
    role: item.role,
    objective: item.objective,
    status: item.status,
    controlStatus: item.controlStatus,
    subagentId: item.subagentId,
    childSessionId: item.childSessionId,
    depth: item.depth,
    durationMs: item.durationMs,
    usage: item.usage,
    resultSummary: item.result?.summary,
    resultText: item.result?.text,
  }
}

/** A new row for an item; `seq` is its arrival number (a subagent keeps it, M25). */
function entryFor(item: ItemSnapshot, at: number, seq: number): TranscriptEntry {
  switch (item.kind) {
    case 'agentMessage': {
      return {
        kind: 'assistant',
        id: item.itemId,
        text: item.text ?? '',
        isStreaming: item.status === IN_PROGRESS,
        citations: item.citations,
      }
    }
    case 'reasoning': {
      const parts = item.summary ?? (item.text === undefined ? [] : [item.text])
      return {
        kind: 'reasoning',
        id: item.itemId,
        parts,
        isStreaming: item.status === IN_PROGRESS,
        startedAt: at,
        durationMs: undefined,
      }
    }
    case 'toolCall': {
      return toolEntry(item)
    }
    case SUBAGENT_KIND: {
      return subagentEntry(item, seq)
    }
    default: {
      return {
        kind: 'item',
        id: item.itemId,
        itemKind: item.kind,
        status: item.status,
        text: item.fallbackText ?? item.text,
      }
    }
  }
}

/** Fold a full item re-emission (`item/updated` / `item/completed`) into its entry. */
function mergeItem(entry: TranscriptEntry, item: ItemSnapshot, at: number): TranscriptEntry {
  switch (entry.kind) {
    case 'assistant': {
      return {
        ...entry,
        text: item.text ?? entry.text,
        isStreaming: item.status === IN_PROGRESS,
        citations: item.citations ?? entry.citations,
      }
    }
    case 'reasoning': {
      const isStreaming = item.status === IN_PROGRESS
      return {
        ...entry,
        parts: item.summary ?? (item.text === undefined ? entry.parts : [item.text]),
        isStreaming,
        durationMs: isStreaming ? entry.durationMs : at - entry.startedAt,
      }
    }
    case 'tool': {
      return {
        ...entry,
        tool: item.tool ?? entry.tool,
        args: item.args ?? entry.args,
        status: item.status,
        output: item.visibleOutput ?? entry.output,
        failureReason: item.failureReason ?? entry.failureReason,
        patchSummary: item.patchSummary ?? entry.patchSummary,
        patchRef: item.patchRef ?? entry.patchRef,
        outputRef: item.outputRef ?? entry.outputRef,
        isBackground: item.background ?? entry.isBackground,
        backgroundInitiator: item.backgroundInitiator ?? entry.backgroundInitiator,
        paid: item.paid ?? entry.paid,
      }
    }
    case 'subagent': {
      const fresh = subagentEntry(item, entry.seq)
      return {
        ...entry,
        role: fresh.role ?? entry.role,
        objective: fresh.objective ?? entry.objective,
        status: fresh.status,
        controlStatus: fresh.controlStatus ?? entry.controlStatus,
        subagentId: fresh.subagentId ?? entry.subagentId,
        childSessionId: fresh.childSessionId ?? entry.childSessionId,
        depth: fresh.depth ?? entry.depth,
        durationMs: fresh.durationMs ?? entry.durationMs,
        usage: fresh.usage ?? entry.usage,
        resultSummary: fresh.resultSummary ?? entry.resultSummary,
        resultText: fresh.resultText ?? entry.resultText,
      }
    }
    case 'item': {
      return { ...entry, status: item.status, text: item.fallbackText ?? item.text ?? entry.text }
    }
    default: {
      return entry
    }
  }
}

/**
 * A row whose turn ended (M25): a reply stops streaming, a thought stops
 * the clock, and a tool still running is marked interrupted with its card
 * gone, since nothing can answer it any more. A backgrounded tool runs on
 * past its turn (M14) and keeps its status. A later item update from the
 * host still overrides all of this.
 */
function settleEntry(entry: TranscriptEntry, at: number): TranscriptEntry {
  switch (entry.kind) {
    case 'assistant': {
      return entry.isStreaming ? { ...entry, isStreaming: false } : entry
    }
    case 'reasoning': {
      return entry.isStreaming
        ? { ...entry, isStreaming: false, durationMs: at - entry.startedAt }
        : entry
    }
    case 'tool': {
      const isCutOff = entry.status === IN_PROGRESS && !entry.isBackground
      if (!isCutOff && entry.approval === undefined && entry.question === undefined) {
        return entry
      }
      return {
        ...entry,
        status: isCutOff ? TOOL_STATUS_INTERRUPTED : entry.status,
        approval: undefined,
        question: undefined,
      }
    }
    default: {
      return entry
    }
  }
}

/** Question cards locked on a submission the host refused, open again (M25). */
function unlockQuestions(entries: readonly TranscriptEntry[]): readonly TranscriptEntry[] {
  return entries.some((entry) => entry.kind === 'tool' && entry.question?.isSubmitted === true)
    ? entries.map((entry) =>
        entry.kind === 'tool' && entry.question?.isSubmitted === true
          ? { ...entry, question: { ...entry.question, isSubmitted: false } }
          : entry,
      )
    : entries
}

function settleAll(entries: readonly TranscriptEntry[], at: number): readonly TranscriptEntry[] {
  const settled = entries.map((entry) => settleEntry(entry, at))
  return settled.every((entry, index) => entry === entries[index]) ? entries : settled
}

/** A user card rebuilt from a stored `userMessage` item (M6 replay). */
function replayedUserEntry(item: ItemSnapshot, seq: number): TranscriptEntry {
  return {
    kind: 'user',
    id: item.itemId,
    seq,
    text: item.text ?? '',
    status: 'sent',
    attachments: (item.attachments ?? []).map((attachment, index) => ({
      id: `${item.itemId}:${String(index)}`,
      name: attachment.mediaType,
      ...(attachment.width !== undefined && { width: attachment.width }),
      ...(attachment.height !== undefined && { height: attachment.height }),
    })),
    ...(item.turnId !== undefined && { turnId: item.turnId }),
  }
}

/**
 * Rebuild the transcript from a session's stored items (`historyLoaded`):
 * user messages become cards (the live path hides them, its own echo being
 * the card), everything else takes the live rows at their final state.
 */
function replayHistory(
  items: readonly ItemSnapshot[],
  at: number,
  sequence: number,
): { readonly entries: readonly TranscriptEntry[]; readonly sequence: number } {
  const entries: TranscriptEntry[] = []
  let next = sequence
  for (const item of items) {
    if (item.kind === USER_MESSAGE_KIND) {
      next += 1
      entries.push(replayedUserEntry(item, next))
    } else if (!HIDDEN_ITEM_KINDS.has(item.kind)) {
      next += 1
      entries.push(stampCompletion(entryFor(item, at, next), next))
    }
  }
  return { entries, sequence: next }
}

/**
 * A subagent's transcript read from its own session (M25, fixing M20's
 * replay): nothing in the read says when a row landed, so a row the panel
 * never saw arrive takes a number just after the last thing known to come
 * before it: the agent's own row (`anchor`), or a row of this transcript the
 * panel did see complete earlier in the session's order. That keeps it after
 * the messages sent before the agent started and before the next one. Rows
 * the panel already had live keep their own numbers and state; live rows the
 * read did not include yet stay at the end. Without an anchor (no agent row
 * names this session) the read rows take no completion number and stay out
 * of any rewind.
 */
function replayChild(
  items: readonly ItemSnapshot[],
  at: number,
  anchor: number | undefined,
  live: readonly TranscriptEntry[],
): readonly TranscriptEntry[] {
  const known = new Map(live.map((entry) => [entry.id, entry]))
  const shown = items.filter(
    (item) => item.kind === USER_MESSAGE_KIND || !HIDDEN_ITEM_KINDS.has(item.kind),
  )
  const slots = shown.length + 1
  let floor = anchor
  const read = shown.map((item, index) => {
    const knownEntry = known.get(item.itemId)
    if (knownEntry !== undefined) {
      if (knownEntry.kind === 'tool' && knownEntry.completedSeq !== undefined) {
        floor = Math.max(floor ?? knownEntry.completedSeq, knownEntry.completedSeq)
      }
      return knownEntry
    }
    // Strictly between `floor` and the next whole arrival number (the next
    // thing that really arrived), in read order.
    const seq =
      floor === undefined
        ? undefined
        : floor + ((Math.floor(floor) + 1 - floor) * (index + 1)) / slots
    if (item.kind === USER_MESSAGE_KIND) {
      return replayedUserEntry(item, seq ?? 0)
    }
    const entry = entryFor(item, at, seq ?? 0)
    return seq === undefined ? entry : stampCompletion(entry, seq)
  })
  const readIds = new Set(shown.map((item) => item.itemId))
  return [...read, ...live.filter((entry) => !readIds.has(entry.id))]
}

/**
 * A tool row that has completed takes the arrival number it completed at
 * (M20): the order its edit landed on disk. Stamped once; a later snapshot
 * of the same row keeps it.
 */
function stampCompletion(entry: TranscriptEntry, seq: number): TranscriptEntry {
  return entry.kind === 'tool' && entry.status === COMPLETED && entry.completedSeq === undefined
    ? { ...entry, completedSeq: seq }
    : entry
}

/**
 * The subagent whose child session a turn belongs to (M18). Seen live
 * 2026-09-23: a child's own items (its reply, its tool calls) reach the
 * parent stream with `turnId` equal to the child session id, so they are
 * the agent's transcript, not the conversation's.
 */
function childOwnerOf(state: UiState, turnId: string | undefined): SubagentEntry | undefined {
  return turnId === undefined
    ? undefined
    : state.transcript.find(
        (entry): entry is SubagentEntry =>
          entry.kind === SUBAGENT_KIND && entry.childSessionId === turnId,
      )
}

function upsertEntry(
  entries: readonly TranscriptEntry[],
  item: ItemSnapshot,
  at: number,
  seq: number,
): readonly TranscriptEntry[] {
  const isKnown = entries.some((entry) => entry.id === item.itemId)
  return isKnown
    ? updateEntry(entries, item.itemId, (entry) => stampCompletion(mergeItem(entry, item, at), seq))
    : [...entries, stampCompletion(mergeItem(entryFor(item, at, seq), item, at), seq)]
}

function ownersOf(childId: string, entries: readonly TranscriptEntry[]): Record<string, string> {
  return Object.fromEntries(entries.map((entry) => [entry.id, childId]))
}

function applyChildItem(
  state: UiState,
  owner: SubagentEntry,
  item: ItemSnapshot,
  at: number,
): UiState {
  const childId = owner.childSessionId ?? ''
  const current = own(state.childTranscripts, childId) ?? {
    name: owner.objective ?? owner.role,
    entries: [],
  }
  const sequence = state.sequence + 1
  return {
    ...state,
    sequence,
    childTranscripts: {
      ...state.childTranscripts,
      [childId]: { ...current, entries: upsertEntry(current.entries, item, at, sequence) },
    },
    childOwners: { ...state.childOwners, [item.itemId]: childId },
  }
}

/**
 * Remember a conversation row whose turn is neither the running one nor the
 * last finished one (M25): it may be a subagent's, arrived before the row
 * naming its child session.
 */
function noteStray(state: UiState, item: ItemSnapshot): UiState['strayItems'] {
  const { turnId } = item
  if (
    turnId === undefined ||
    item.kind === SUBAGENT_KIND ||
    turnId === state.activeTurnId ||
    turnId === state.lastCompletedTurnId
  ) {
    return state.strayItems
  }
  const listed = own(state.strayItems, turnId) ?? []
  return listed.includes(item.itemId)
    ? state.strayItems
    : { ...state.strayItems, [turnId]: [...listed, item.itemId] }
}

/** Move the rows that came before their subagent's row into its transcript (M25). */
function claimStrays(state: UiState, childId: string): UiState {
  const ids = own(state.strayItems, childId)
  const owner = childOwnerOf(state, childId)
  if (ids === undefined || owner === undefined) {
    return state
  }
  const moving = new Set(ids)
  const moved = state.transcript.filter((entry) => moving.has(entry.id))
  const current = own(state.childTranscripts, childId)
  return {
    ...state,
    strayItems: without(state.strayItems, childId),
    transcript: state.transcript.filter((entry) => !moving.has(entry.id)),
    childTranscripts: {
      ...state.childTranscripts,
      [childId]: {
        name: current?.name ?? owner.objective ?? owner.role,
        entries: [...moved, ...(current?.entries ?? [])],
      },
    },
    childOwners: { ...state.childOwners, ...ownersOf(childId, moved) },
  }
}

function applyItem(state: UiState, item: ItemSnapshot, at: number): UiState {
  if (HIDDEN_ITEM_KINDS.has(item.kind)) {
    return state
  }
  const owner = item.kind === SUBAGENT_KIND ? undefined : childOwnerOf(state, item.turnId)
  if (owner !== undefined) {
    return applyChildItem(state, owner, item, at)
  }
  const sequence = state.sequence + 1
  const previous = findEntry(state.transcript, item.itemId)
  const transcript = upsertEntry(state.transcript, item, at, sequence)
  const placed: UiState = { ...state, sequence, transcript, strayItems: noteStray(state, item) }
  const claimed =
    item.kind === SUBAGENT_KIND && item.childSessionId !== undefined
      ? claimStrays(placed, item.childSessionId)
      : placed
  return announce(claimed, toolFailureAnnouncement(previous, findEntry(transcript, item.itemId)))
}

function mapChildEntries(
  state: UiState,
  childId: string,
  update: (entries: readonly TranscriptEntry[]) => readonly TranscriptEntry[],
): UiState {
  const current = own(state.childTranscripts, childId)
  if (current === undefined) {
    return state
  }
  const entries = update(current.entries)
  return entries === current.entries
    ? state
    : {
        ...state,
        childTranscripts: { ...state.childTranscripts, [childId]: { ...current, entries } },
      }
}

function applyDelta(entry: TranscriptEntry, field: string, delta: string): TranscriptEntry {
  if (field === TEXT_FIELD && entry.kind === 'assistant') {
    return { ...entry, text: entry.text + delta }
  }
  if (field === OUTPUT_FIELD && entry.kind === 'tool') {
    return { ...entry, output: entry.output + delta }
  }
  if (entry.kind === 'reasoning' && field.startsWith(SUMMARY_FIELD_PREFIX)) {
    const index = Number(field.slice(SUMMARY_FIELD_PREFIX.length))
    const parts = [...entry.parts]
    while (parts.length <= index) {
      parts.push('')
    }
    parts[index] = (parts[index] ?? '') + delta
    return { ...entry, parts }
  }
  return entry
}

/** The tool entry an approval or question belongs to, created if the request came first. */
function withToolEntry(
  state: UiState,
  itemId: string,
  placeholder: () => TranscriptEntry,
  update: (entry: TranscriptEntry) => TranscriptEntry,
): UiState {
  const isKnown = state.transcript.some((entry) => entry.id === itemId)
  const transcript = isKnown
    ? updateEntry(state.transcript, itemId, update)
    : [...state.transcript, update(placeholder())]
  return { ...state, transcript }
}

/** A turn of the conversation ended (M25 settles the rows it left behind). */
function completeTurn(
  state: UiState,
  event: Extract<AgentEvent, { type: 'turnCompleted' }>,
  at: number,
): UiState {
  const child = childOwnerOf(state, event.turnId)
  if (child?.childSessionId !== undefined) {
    // A subagent's own turn ended: its transcript settles, the conversation runs on.
    return mapChildEntries(state, child.childSessionId, (entries) => settleAll(entries, at))
  }
  const failure: readonly TranscriptEntry[] =
    event.terminal === 'failed'
      ? [
          {
            kind: 'error',
            id: `error:${event.turnId}`,
            text: event.reason ?? event.errorKind ?? UI_TEXT.turnFailed,
          },
        ]
      : []
  return announce(
    {
      ...state,
      activeTurnId: undefined,
      lastCompletedTurnId: event.turnId,
      strayItems: without(state.strayItems, event.turnId),
      transcript: [...settleAll(state.transcript, at), ...failure],
    },
    turnAnnouncement(event.terminal, event.reason),
  )
}

function applyAgentEvent(state: UiState, event: AgentEvent, at: number): UiState {
  switch (event.type) {
    case 'turnStarted': {
      return childOwnerOf(state, event.turnId) === undefined
        ? {
            ...state,
            activeTurnId: event.turnId,
            strayItems: without(state.strayItems, event.turnId),
          }
        : state
    }
    case 'itemStarted':
    case 'itemUpdated':
    case 'itemCompleted': {
      return applyItem(state, event.item, at)
    }
    case 'textDelta': {
      const childId = own(state.childOwners, event.itemId)
      const apply = (entries: readonly TranscriptEntry[]) =>
        updateEntry(entries, event.itemId, (entry) => applyDelta(entry, event.field, event.delta))
      if (childId !== undefined) {
        return mapChildEntries(state, childId, apply)
      }
      const transcript = apply(state.transcript)
      return transcript === state.transcript ? state : { ...state, transcript }
    }
    case 'turnCompleted': {
      return completeTurn(state, event, at)
    }
    case 'turnRetry': {
      const seconds = Math.round(event.retryDelayMs / MILLISECONDS_PER_SECOND)
      return withNotice(
        state,
        'warning',
        fill(UI_TEXT.turnRetrying, {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          reason: event.reason,
          seconds,
        }),
      )
    }
    case 'tokenUsage': {
      return {
        ...state,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.cachedTokens !== undefined && { cachedTokens: event.cachedTokens }),
        },
      }
    }
    case 'contextUsage': {
      return {
        ...state,
        context: {
          usedTokens: event.usedTokens,
          windowTokens: event.windowTokens,
          pressure: event.pressure,
        },
      }
    }
    case 'modelChanged': {
      const listed = state.models.find((model) => model.modelId === event.modelId)
      return {
        ...state,
        model: {
          modelId: event.modelId,
          contextLimit: listed?.contextLimit ?? state.model?.contextLimit,
        },
      }
    }
    case 'sessionStatus': {
      return event.status === 'idle' ? { ...state, activeTurnId: undefined } : state
    }
    case 'sessionNamed': {
      return { ...state, title: event.name }
    }
    case 'approvalRequested': {
      const approval: PendingApproval = {
        approvalId: event.approvalId,
        requirementId: event.requirementId,
        subject: event.subject,
        rawArgs: event.rawArgs,
        availableChoices: event.availableChoices,
        isProtectedWrite: event.isProtectedWrite,
        isJudgeEscalated: event.isJudgeEscalated,
      }
      return announce(
        withToolEntry(
          state,
          event.itemId,
          () =>
            toolEntry({
              itemId: event.itemId,
              kind: 'toolCall',
              status: IN_PROGRESS,
              tool: event.toolName,
              args: event.rawArgs,
            }),
          (entry) => (entry.kind === 'tool' ? { ...entry, approval } : entry),
        ),
        fill(UI_TEXT.announceApprovalFor, { tool: toolLabel(event.toolName) ?? event.toolName }),
      )
    }
    case 'approvalUpdated': {
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'tool' && entry.approval?.approvalId === event.approvalId
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  requirementId: event.requirementId,
                  subject: event.subject,
                  availableChoices: event.availableChoices,
                },
              }
            : entry,
        ),
      }
    }
    case 'approvalResolved': {
      return {
        ...state,
        transcript: updateEntry(state.transcript, event.itemId, (entry) =>
          entry.kind === 'tool'
            ? {
                ...entry,
                approval: undefined,
                approvalOutcome: { decision: event.decision, resolvedBy: event.resolvedBy },
              }
            : entry,
        ),
      }
    }
    case 'questionRequested': {
      const question: PendingQuestion = {
        userInputId: event.userInputId,
        questions: event.questions,
      }
      return announce(
        withToolEntry(
          state,
          event.itemId,
          () =>
            toolEntry({
              itemId: event.itemId,
              kind: 'toolCall',
              status: IN_PROGRESS,
              tool: 'request_user_input',
            }),
          (entry) => (entry.kind === 'tool' ? { ...entry, question } : entry),
        ),
        UI_TEXT.announceQuestion,
      )
    }
    case 'questionSettled': {
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'tool' && entry.question?.userInputId === event.userInputId
            ? {
                ...entry,
                question: undefined,
                questionOutcome: { outcome: event.outcome, answers: event.answers },
              }
            : entry,
        ),
      }
    }
    case 'todoChanged': {
      return { ...state, todos: event.items }
    }
    case 'effortChanged':
    case 'approvalModeChanged':
    case 'skillsChanged': {
      // The host confirms the resulting composer state / skill list itself.
      return state
    }
    case 'turnWithdrawn': {
      // Only the message that will never run is marked (D26); the running
      // turn keeps its rows and its Stop.
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'user' && entry.turnId === event.turnId
            ? { ...entry, status: 'failed', reason: event.reason }
            : entry,
        ),
      }
    }
    case 'viewGap':
    case 'backendNotice': {
      // The controller's own (PLAN.md D26): it reloads or posts a notice instead.
      return state
    }
  }
}

/** The conversation dropped: New Conversation here, from a keybinding, or a stale restore. */
function clearedConversation(state: UiState): UiState {
  return {
    ...state,
    childTranscripts: {},
    childOwners: {},
    strayItems: {},
    unsentAttachments: {},
    attachmentsToRelease: [],
    banner: undefined,
    title: undefined,
    sessionId: undefined,
    restoredSessionId: undefined,
    transcript: [],
    attachments: [],
    reference: undefined,
    activeTurnId: undefined,
    lastCompletedTurnId: undefined,
    usage: undefined,
    context: undefined,
    todos: [],
    outputPages: {},
  }
}

/**
 * The host's word on this surface after a (re)load (M25). A restored
 * conversation stays only when its session is the one the host holds live;
 * the host's running turn (or none) replaces whatever the saved state said,
 * and rows left running by a turn that ended while the panel was away settle.
 */
function reconcile(
  state: UiState,
  message: Extract<HostToWebviewMessage, { type: 'surfaceState' }>,
  at: number,
): UiState {
  const restore = state.pendingRestore
  const live: UiState = { ...state, pendingRestore: undefined, activeTurnId: message.activeTurnId }
  if (restore === undefined) {
    return live
  }
  if (message.sessionId === undefined || restore.sessionId !== message.sessionId) {
    return {
      ...clearedConversation(live),
      activeTurnId: message.activeTurnId,
      restoredSessionId: state.restoredSessionId,
    }
  }
  if (restore.isTranscriptOmitted) {
    return withNotice(live, 'info', UI_TEXT.snapshotTooLong)
  }
  return message.activeTurnId === undefined
    ? { ...live, transcript: settleAll(live.transcript, at) }
    : live
}

function applyHostMessage(state: UiState, message: HostToWebviewMessage, at: number): UiState {
  switch (message.type) {
    case 'init': {
      return {
        ...state,
        phase: 'ready',
        emptyStateHint: message.emptyStateHint,
        composerPlaceholder: message.composerPlaceholder,
        settings: message.settings,
        permissionMode: message.settings.initialPermissionMode,
        // Opening the panel puts the caret in the composer, like Claude Code.
        focusRequests: state.focusRequests + 1,
      }
    }
    case 'settingsChanged': {
      return { ...state, settings: message.settings }
    }
    case 'focusInput': {
      return { ...state, focusRequests: state.focusRequests + 1 }
    }
    case 'conversationCleared': {
      // The echo of a clear this panel already made is spent, not applied
      // again: a message sent right after it must survive (M25).
      return state.pendingClearEchoes > 0
        ? { ...state, pendingClearEchoes: state.pendingClearEchoes - 1 }
        : clearedConversation(state)
    }
    case 'surfaceState': {
      return reconcile(state, message, at)
    }
    case 'insertText': {
      return withInsert(state, message.text)
    }
    case 'editorContext': {
      // A dismissal holds only while the same file stays active.
      const isSameFile = message.context?.relativePath === state.dismissedEditorPath
      return {
        ...state,
        editorContext: message.context,
        dismissedEditorPath: isSameFile ? state.dismissedEditorPath : undefined,
      }
    }
    case 'authState': {
      return {
        ...state,
        auth: {
          status: message.status,
          detail: message.detail,
          backend: message.backend,
          methods: message.methods,
        },
      }
    }
    case 'sessionInfo': {
      return {
        ...state,
        model: { modelId: message.modelId, contextLimit: message.contextLimit },
        sessionId: message.sessionId,
        canEditSessions: message.canEditSessions ?? true,
        // A live session replaces the one a restored panel was waiting for.
        restoredSessionId: message.sessionId === undefined ? state.restoredSessionId : undefined,
      }
    }
    case 'approvalReopened': {
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'tool' && entry.approval?.approvalId === message.approvalId
            ? { ...entry, approval: { ...entry.approval, decidedSourceIndex: undefined } }
            : entry,
        ),
      }
    }
    case 'promptDropped': {
      return {
        ...state,
        transcript: state.transcript.map((entry) => {
          if (entry.kind !== 'tool') {
            return entry
          }
          const isApproval =
            message.approvalId !== undefined && entry.approval?.approvalId === message.approvalId
          const isQuestion =
            message.userInputId !== undefined && entry.question?.userInputId === message.userInputId
          // Untouched rows keep their identity, so their memoised render holds (M25).
          if (!isApproval && !isQuestion) {
            return entry
          }
          return {
            ...entry,
            ...(isApproval && { approval: undefined }),
            ...(isQuestion && { question: undefined }),
          }
        }),
      }
    }
    case 'sessionList': {
      return { ...state, sessions: message.sessions, archivedIds: message.archivedIds }
    }
    case 'childTranscript': {
      const owner = childOwnerOf(state, message.sessionId)
      const live = own(state.childTranscripts, message.sessionId)
      const entries = replayChild(message.items, at, owner?.seq, live?.entries ?? [])
      return {
        ...state,
        childTranscripts: {
          ...state.childTranscripts,
          [message.sessionId]: { name: message.name ?? live?.name, entries },
        },
        childOwners: { ...state.childOwners, ...ownersOf(message.sessionId, entries) },
      }
    }
    case 'usageReport': {
      return {
        ...state,
        usageReport: {
          backend: message.backend,
          subscription: message.subscription,
          account: message.account,
          insights: message.insights,
        },
      }
    }
    case 'dictationState': {
      return announce(
        {
          ...state,
          dictation: {
            status: message.status,
            reason: message.reason,
            engine: message.engine ?? 'system',
          },
        },
        dictationAnnouncement(state.dictation.status, message.status),
      )
    }
    case 'paidState': {
      return { ...state, paid: message.state }
    }
    case 'historyLoaded': {
      const replayed = replayHistory(message.items, at, state.sequence)
      // The same session read again (a delivery gap, D26) keeps its usage.
      const isSameSession = message.sessionId === state.sessionId
      return announce(
        {
          ...state,
          sessionId: message.sessionId,
          restoredSessionId: undefined,
          title: message.name,
          transcript: replayed.entries,
          sequence: replayed.sequence,
          todos: message.todos,
          activeTurnId: message.activeTurnId,
          lastCompletedTurnId: undefined,
          usage: isSameSession ? state.usage : undefined,
          context: isSameSession ? state.context : undefined,
          outputPages: {},
          childTranscripts: {},
          childOwners: {},
          strayItems: {},
        },
        UI_TEXT.announceResumed,
      )
    }
    case 'turnAccepted': {
      // A fast turn can finish before its acceptance arrives (M25); the
      // acceptance then marks the card sent and starts nothing.
      const isFinished = message.turnId === state.lastCompletedTurnId
      return {
        ...state,
        activeTurnId: isFinished ? state.activeTurnId : message.turnId,
        strayItems: without(state.strayItems, message.turnId),
        unsentAttachments: without(state.unsentAttachments, message.localId),
        transcript: updateEntry(state.transcript, message.localId, (entry) =>
          entry.kind === 'user' ? { ...entry, status: 'sent', turnId: message.turnId } : entry,
        ),
      }
    }
    case 'sendFailed': {
      // A refused message's images (M25): back in the composer when the host
      // says it still holds them, so a resend carries them; otherwise the
      // host may have consumed them already, and a chip would name an image
      // a resend silently leaves out, so the host is asked to drop whatever
      // it still holds and the chips stay on the failed card only.
      const unsent = own(state.unsentAttachments, message.localId) ?? []
      const others = state.attachments.filter((attachment) =>
        unsent.every((chip) => chip.id !== attachment.id),
      )
      const isKept = message.attachmentsKept === true
      return announce(
        {
          ...state,
          attachments: isKept ? [...unsent, ...others] : state.attachments,
          attachmentsToRelease: isKept
            ? state.attachmentsToRelease
            : [...state.attachmentsToRelease, ...unsent.map((chip) => chip.id)],
          unsentAttachments: without(state.unsentAttachments, message.localId),
          transcript: updateEntry(state.transcript, message.localId, (entry) =>
            entry.kind === 'user' ? { ...entry, status: 'failed', reason: message.reason } : entry,
          ),
        },
        message.reason,
      )
    }
    case 'agentEvent': {
      return applyAgentEvent(state, message.event, at)
    }
    case 'modelList': {
      return { ...state, models: message.models }
    }
    case 'skillList': {
      return { ...state, skills: message.skills }
    }
    case 'composerState': {
      return {
        ...state,
        effort: message.effort,
        isThinkingEnabled: message.isThinkingEnabled,
        permissionMode: message.permissionMode,
      }
    }
    case 'mentionResults': {
      return { ...state, mentionResults: { requestId: message.requestId, items: message.items } }
    }
    case 'attachmentAdded': {
      const others = state.attachments.filter((entry) => entry.id !== message.attachment.id)
      return { ...state, attachments: [...others, message.attachment] }
    }
    case 'attachmentRejected': {
      // The composer banner (M14), as Claude Code shows it; the reason the
      // host gave is read out.
      return withBanner(state, message.name, message.reason)
    }
    case 'attachmentsCleared': {
      return { ...state, attachments: [] }
    }
    case 'notice': {
      // Warnings and errors are read out; informational notices stay visual.
      // The host reports a refused answer or cancel only with an error notice,
      // so an error unlocks the question cards waiting on the host (M25): the
      // user can try again instead of facing a card locked for good.
      const noticed = withNotice(state, message.level, message.text)
      return announce(
        message.level === 'error'
          ? { ...noticed, transcript: unlockQuestions(noticed.transcript) }
          : noticed,
        message.level === 'info' ? undefined : message.text,
      )
    }
    case 'outputPage': {
      const key = outputPageKey(message.itemId, message.outputRef)
      const previous = own(state.outputPages, key)
      // Pages chain by offset (M25): a repeated or out-of-order page is dropped
      // rather than spliced in twice.
      if (message.offsetBytes !== 0 && previous?.nextOffset !== message.offsetBytes) {
        return state
      }
      const content =
        message.offsetBytes === 0 ? message.content : (previous?.content ?? '') + message.content
      return {
        ...state,
        outputPages: {
          ...state.outputPages,
          [key]: {
            content,
            isEof: message.eof,
            nextOffset: message.offsetBytes + message.byteLen,
          },
        },
      }
    }
  }
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'hostMessage': {
      return applyHostMessage(state, action.message, action.at)
    }
    case 'draftChanged': {
      return { ...state, draft: action.draft }
    }
    case 'insertRequested': {
      return withInsert(state, action.text)
    }
    case 'insertApplied': {
      return { ...state, pendingInsert: undefined }
    }
    case 'focusRequested': {
      return { ...state, focusRequests: state.focusRequests + 1 }
    }
    case 'submitted': {
      return {
        ...state,
        draft: '',
        attachments: [],
        unsentAttachments:
          action.attachments.length === 0
            ? state.unsentAttachments
            : { ...state.unsentAttachments, [action.localId]: action.attachments },
        reference: undefined,
        sequence: state.sequence + 1,
        transcript: [
          ...state.transcript,
          {
            kind: 'user',
            id: action.localId,
            seq: state.sequence + 1,
            text: action.text,
            status: 'pending',
            attachments: action.attachments,
            ...(action.contextLabel !== undefined && { contextLabel: action.contextLabel }),
            ...(action.reference !== undefined && {
              referenceLabel: referenceLabel(action.reference),
            }),
          },
        ],
      }
    }
    case 'editorContextDismissed': {
      return { ...state, dismissedEditorPath: state.editorContext?.relativePath }
    }
    case 'referenceSet': {
      return { ...state, reference: action.reference }
    }
    case 'referenceCleared': {
      return { ...state, reference: undefined }
    }
    case 'attachmentRemoved': {
      return { ...state, attachments: state.attachments.filter((entry) => entry.id !== action.id) }
    }
    case 'approvalDecided': {
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'tool' && entry.approval?.approvalId === action.approvalId
            ? {
                ...entry,
                approval: {
                  ...entry.approval,
                  decidedSourceIndex: action.requirementId.sourceIndex,
                },
              }
            : entry,
        ),
      }
    }
    case 'questionSubmitted': {
      return {
        ...state,
        transcript: state.transcript.map((entry) =>
          entry.kind === 'tool' && entry.question?.userInputId === action.userInputId
            ? { ...entry, question: { ...entry.question, isSubmitted: true } }
            : entry,
        ),
      }
    }
    case 'noticeRaised': {
      return announce(
        withNotice(state, action.level, action.text),
        action.level === 'info' ? undefined : action.text,
      )
    }
    case 'attachmentRefused': {
      return withBanner(state, action.name, action.reason)
    }
    case 'attachmentsReleased': {
      return {
        ...state,
        attachmentsToRelease: state.attachmentsToRelease.filter((id) => !action.ids.includes(id)),
      }
    }
    case 'bannerDismissed': {
      return { ...state, banner: undefined }
    }
    case 'conversationCleared': {
      return {
        ...clearedConversation(state),
        pendingClearEchoes: state.pendingClearEchoes + 1,
      }
    }
  }
}

/** Whether the composer may submit right now (a running turn is steered). */
export function canSend(state: UiState): boolean {
  return (
    state.auth.status === 'signedIn' && (state.draft.trim() !== '' || state.attachments.length > 0)
  )
}

/** The open-file chip to show: the setting is on and the user has not closed it. */
export function visibleEditorContext(state: UiState): EditorContextSummary | undefined {
  const { editorContext } = state
  if (editorContext === undefined || state.settings?.attachOpenFile !== true) {
    return undefined
  }
  return editorContext.relativePath === state.dismissedEditorPath ? undefined : editorContext
}

/** Where "Fork from here" on a user card cuts: after the previous turn, or a fresh start. */
export type ForkCut =
  { readonly type: 'afterTurn'; readonly lastTurnId: string } | { readonly type: 'fresh' }

/**
 * The cut point for forking before the given user card: the last turn of
 * an earlier user message, or a fresh conversation when it is the first.
 * Undefined when the id is not a sent user card.
 */
export function forkCutBefore(
  transcript: readonly TranscriptEntry[],
  entryId: string,
): ForkCut | undefined {
  const index = transcript.findIndex((entry) => entry.id === entryId)
  const target = transcript[index]
  if (target?.kind !== 'user' || target.status !== 'sent') {
    return undefined
  }
  const earlier = transcript
    .slice(0, index)
    .findLast((entry) => entry.kind === 'user' && entry.turnId !== undefined)
  return earlier?.kind === 'user' && earlier.turnId !== undefined
    ? { type: 'afterTurn', lastTurnId: earlier.turnId }
    : { type: 'fresh' }
}

/**
 * The edits that landed after a user message, newest first: what "Rewind
 * code to here" reverts. The conversation's own edits and every subagent's
 * (their rows live in the child transcripts, M18), ordered by the arrival
 * number their completion took (M20), so edits that overlap unwind in the
 * reverse of the order they were applied. Only completed edit rows carry a
 * patch document.
 */
export function editsAfter(state: UiState, entryId: string): readonly EditRef[] {
  const message = state.transcript.find((entry) => entry.id === entryId)
  if (message?.kind !== 'user') {
    return []
  }
  const pools = [
    state.transcript,
    ...Object.values(state.childTranscripts).map((child) => child.entries),
  ]
  return pools
    .flat()
    .filter(
      (
        entry,
      ): entry is ToolEntry & {
        readonly completedSeq: number
        readonly patchRef: OutputRef
      } =>
        entry.kind === 'tool' &&
        entry.status === COMPLETED &&
        entry.patchRef !== undefined &&
        entry.completedSeq !== undefined &&
        entry.completedSeq > message.seq,
    )
    .toSorted((a, b) => b.completedSeq - a.completedSeq)
    .map((entry) => ({ itemId: entry.id, outputRef: entry.patchRef.id }))
}

export type SubagentEntry = Extract<TranscriptEntry, { kind: 'subagent' }>
export type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

/** The subagents of this conversation, in transcript order (M14). */
export function agentsOf(state: UiState): readonly SubagentEntry[] {
  return state.transcript.filter((entry): entry is SubagentEntry => entry.kind === SUBAGENT_KIND)
}

/** The tool calls the CLI put in the background (M14). */
export function backgroundTasksOf(state: UiState): readonly ToolEntry[] {
  return state.transcript.filter(
    (entry): entry is ToolEntry => entry.kind === 'tool' && entry.isBackground,
  )
}

/** Whether any tool row is waiting on the user (approval or question). */
export function hasPendingRequest(state: UiState): boolean {
  return state.transcript.some(
    (entry) =>
      entry.kind === 'tool' && (entry.approval !== undefined || entry.question !== undefined),
  )
}
