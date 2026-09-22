// Webview UI state: a pure reducer over host messages and local edits. No DOM
// access here; the components apply focus and caret changes. Timestamps come
// in with the action (`at`) so reasoning durations stay deterministic in tests.

import type {
  AgentEvent,
  ApprovalChoice,
  ApprovalSubject,
  ItemSnapshot,
  Question,
  QuestionAnswer,
  RequirementRef,
  TodoItem,
} from '../../shared/agentEvents'
import {
  DEFAULT_EFFORT,
  type EffortLevel,
  HIDDEN_ITEM_KINDS,
  MILLISECONDS_PER_SECOND,
  type PermissionMode,
} from '../../shared/constants'
import type {
  AttachmentSummary,
  AuthStatus,
  HostToWebviewMessage,
  MentionItem,
  ModelOption,
  SettingsSnapshot,
  SkillOption,
} from '../../shared/protocol'

export type NoticeLevel = 'info' | 'warning' | 'error'

export interface PendingApproval {
  readonly approvalId: string
  readonly requirementId: RequirementRef
  readonly subject: ApprovalSubject
  readonly rawArgs: string
  readonly availableChoices: readonly ApprovalChoice[]
  readonly isProtectedWrite: boolean
  readonly isJudgeEscalated: boolean
}

export interface PendingQuestion {
  readonly userInputId: string
  readonly questions: readonly Question[]
}

export interface OutputRef {
  readonly id: string
  readonly byteLen: number
}

export interface PatchSummary {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export type TranscriptEntry =
  | {
      readonly kind: 'user'
      readonly id: string
      readonly text: string
      readonly status: 'pending' | 'sent' | 'failed'
      readonly reason?: string
      readonly attachments: readonly AttachmentSummary[]
    }
  | {
      readonly kind: 'assistant'
      readonly id: string
      readonly text: string
      readonly isStreaming: boolean
    }
  | {
      readonly kind: 'reasoning'
      readonly id: string
      /** Summary parts (`summary.N` deltas), or the raw text as one part. */
      readonly parts: readonly string[]
      readonly isStreaming: boolean
      readonly startedAt: number
      readonly durationMs: number | undefined
    }
  | {
      readonly kind: 'tool'
      readonly id: string
      readonly tool: string
      readonly args: string
      readonly status: string
      /** Transcript-visible output (`output` deltas / `visibleOutput`). */
      readonly output: string
      readonly failureReason: string | undefined
      readonly patchSummary: PatchSummary | undefined
      readonly patchRef: OutputRef | undefined
      readonly outputRef: OutputRef | undefined
      readonly approval: PendingApproval | undefined
      readonly approvalOutcome:
        { readonly decision: string; readonly resolvedBy: string } | undefined
      readonly question: PendingQuestion | undefined
      readonly questionOutcome:
        { readonly outcome: string; readonly answers: readonly QuestionAnswer[] } | undefined
    }
  | {
      /** Kinds the UI does not know (subagent, workflow, compaction, …). */
      readonly kind: 'item'
      readonly id: string
      readonly itemKind: string
      readonly status: string
      readonly text: string | undefined
    }
  | { readonly kind: 'error'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'notice'
      readonly id: string
      readonly level: NoticeLevel
      readonly text: string
    }

export interface UsageSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
}

export interface ContextSummary {
  readonly usedTokens: number
  readonly windowTokens: number | undefined
  readonly pressure: string
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

export interface UiState {
  readonly phase: 'connecting' | 'ready'
  readonly emptyStateHint: string
  readonly composerPlaceholder: string
  readonly settings: SettingsSnapshot | undefined
  /** The session's name once the host allocates one (`session/nameChanged`). */
  readonly title: string | undefined
  readonly draft: string
  /** Incremented per host `focusInput`; the composer focuses when it changes. */
  readonly focusRequests: number
  /** Text waiting to be inserted at the composer caret, if any. */
  readonly pendingInsert: string | undefined
  readonly auth: { readonly status: AuthStatus; readonly detail: string | undefined }
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
  readonly usage: UsageSummary | undefined
  readonly context: ContextSummary | undefined
  readonly todos: readonly TodoItem[]
  /** Fetched output pages keyed by `${itemId}:${outputRef}`. */
  readonly outputPages: Readonly<Record<string, OutputPage>>
  /** Monotonic counter behind locally generated transcript ids. */
  readonly localSequence: number
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
    }
  | { readonly type: 'attachmentRemoved'; readonly id: string }
  | { readonly type: 'conversationCleared' }

export const initialUiState: UiState = {
  phase: 'connecting',
  emptyStateHint: '',
  composerPlaceholder: '',
  settings: undefined,
  title: undefined,
  draft: '',
  focusRequests: 0,
  pendingInsert: undefined,
  auth: { status: 'checking', detail: undefined },
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
  usage: undefined,
  context: undefined,
  todos: [],
  outputPages: {},
  localSequence: 0,
}

const SUMMARY_FIELD_PREFIX = 'summary.'
const OUTPUT_FIELD = 'output'
const TEXT_FIELD = 'text'
const IN_PROGRESS = 'inProgress'

export function outputPageKey(itemId: string, outputRef: string): string {
  return `${itemId}:${outputRef}`
}

function updateEntry(
  transcript: readonly TranscriptEntry[],
  id: string,
  update: (entry: TranscriptEntry) => TranscriptEntry,
): readonly TranscriptEntry[] {
  return transcript.map((entry) => (entry.id === id ? update(entry) : entry))
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
    approval: undefined,
    approvalOutcome: undefined,
    question: undefined,
    questionOutcome: undefined,
  }
}

function entryFor(item: ItemSnapshot, at: number): TranscriptEntry {
  switch (item.kind) {
    case 'agentMessage': {
      return {
        kind: 'assistant',
        id: item.itemId,
        text: item.text ?? '',
        isStreaming: item.status === IN_PROGRESS,
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
      return { ...entry, text: item.text ?? entry.text, isStreaming: item.status === IN_PROGRESS }
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

function applyItem(state: UiState, item: ItemSnapshot, at: number): UiState {
  if (HIDDEN_ITEM_KINDS.has(item.kind)) {
    return state
  }
  const isKnown = state.transcript.some((entry) => entry.id === item.itemId)
  const transcript = isKnown
    ? updateEntry(state.transcript, item.itemId, (entry) => mergeItem(entry, item, at))
    : [...state.transcript, mergeItem(entryFor(item, at), item, at)]
  return { ...state, transcript }
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

function applyAgentEvent(state: UiState, event: AgentEvent, at: number): UiState {
  switch (event.type) {
    case 'turnStarted': {
      return { ...state, activeTurnId: event.turnId }
    }
    case 'itemStarted':
    case 'itemUpdated':
    case 'itemCompleted': {
      return applyItem(state, event.item, at)
    }
    case 'textDelta': {
      return {
        ...state,
        transcript: updateEntry(state.transcript, event.itemId, (entry) =>
          applyDelta(entry, event.field, event.delta),
        ),
      }
    }
    case 'turnCompleted': {
      const failure: readonly TranscriptEntry[] =
        event.terminal === 'failed'
          ? [
              {
                kind: 'error',
                id: `error:${event.turnId}`,
                text: event.reason ?? event.errorKind ?? 'The turn failed.',
              },
            ]
          : []
      return { ...state, activeTurnId: undefined, transcript: [...state.transcript, ...failure] }
    }
    case 'turnRetry': {
      const seconds = Math.round(event.retryDelayMs / MILLISECONDS_PER_SECOND)
      return withNotice(
        state,
        'warning',
        `Attempt ${String(event.attempt)}/${String(event.maxAttempts)} failed (${event.reason}); retrying in ${String(seconds)} s.`,
      )
    }
    case 'tokenUsage': {
      return {
        ...state,
        usage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cachedTokens: event.cachedTokens,
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
      return withToolEntry(
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
      return withToolEntry(
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
  }
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
    case 'insertText': {
      return withInsert(state, message.text)
    }
    case 'authState': {
      return { ...state, auth: { status: message.status, detail: message.detail } }
    }
    case 'sessionInfo': {
      return { ...state, model: { modelId: message.modelId, contextLimit: message.contextLimit } }
    }
    case 'turnAccepted': {
      return {
        ...state,
        activeTurnId: message.turnId,
        transcript: updateEntry(state.transcript, message.localId, (entry) =>
          entry.kind === 'user' ? { ...entry, status: 'sent' } : entry,
        ),
      }
    }
    case 'sendFailed': {
      return {
        ...state,
        transcript: updateEntry(state.transcript, message.localId, (entry) =>
          entry.kind === 'user' ? { ...entry, status: 'failed', reason: message.reason } : entry,
        ),
      }
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
      return withNotice(state, 'warning', `${message.name}: ${message.reason}`)
    }
    case 'attachmentsCleared': {
      return { ...state, attachments: [] }
    }
    case 'notice': {
      return withNotice(state, message.level, message.text)
    }
    case 'outputPage': {
      const key = outputPageKey(message.itemId, message.outputRef)
      const previous = state.outputPages[key]
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
        transcript: [
          ...state.transcript,
          {
            kind: 'user',
            id: action.localId,
            text: action.text,
            status: 'pending',
            attachments: action.attachments,
          },
        ],
      }
    }
    case 'attachmentRemoved': {
      return { ...state, attachments: state.attachments.filter((entry) => entry.id !== action.id) }
    }
    case 'conversationCleared': {
      return {
        ...state,
        title: undefined,
        transcript: [],
        attachments: [],
        activeTurnId: undefined,
        usage: undefined,
        context: undefined,
        todos: [],
        outputPages: {},
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

/** Whether any tool row is waiting on the user (approval or question). */
export function hasPendingRequest(state: UiState): boolean {
  return state.transcript.some(
    (entry) =>
      entry.kind === 'tool' && (entry.approval !== undefined || entry.question !== undefined),
  )
}
