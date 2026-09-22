// Webview UI state: a pure reducer over host messages and local edits. No DOM
// access here; the components apply focus and caret changes.

import type { AgentEvent } from '../../shared/agentEvents'
import { DEFAULT_EFFORT, type EffortLevel, type PermissionMode } from '../../shared/constants'
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

export type TranscriptEntry =
  | {
      readonly kind: 'user'
      readonly id: string
      readonly text: string
      readonly status: 'pending' | 'sent' | 'failed'
      readonly reason?: string
    }
  | {
      readonly kind: 'assistant'
      readonly id: string
      readonly text: string
      readonly isStreaming: boolean
    }
  | {
      readonly kind: 'activity'
      readonly id: string
      readonly itemKind: string
      readonly status: string
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

export interface UiState {
  readonly phase: 'connecting' | 'ready'
  readonly extensionVersion: string
  readonly emptyStateHint: string
  readonly composerPlaceholder: string
  readonly settings: SettingsSnapshot | undefined
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
  /** Monotonic counter behind locally generated transcript ids. */
  readonly localSequence: number
}

export type UiAction =
  | { readonly type: 'hostMessage'; readonly message: HostToWebviewMessage }
  | { readonly type: 'draftChanged'; readonly draft: string }
  | { readonly type: 'insertRequested'; readonly text: string }
  | { readonly type: 'insertApplied' }
  | { readonly type: 'focusRequested' }
  | { readonly type: 'submitted'; readonly localId: string; readonly text: string }
  | { readonly type: 'attachmentRemoved'; readonly id: string }
  | { readonly type: 'conversationCleared' }

export const initialUiState: UiState = {
  phase: 'connecting',
  extensionVersion: '',
  emptyStateHint: '',
  composerPlaceholder: '',
  settings: undefined,
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
  localSequence: 0,
}

// Host-internal items that carry nothing the user should see.
const HIDDEN_ITEM_KINDS = new Set(['userMessage', 'reminderChild'])

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

function applyAgentEvent(state: UiState, event: AgentEvent): UiState {
  switch (event.type) {
    case 'turnStarted': {
      return { ...state, activeTurnId: event.turnId }
    }
    case 'itemStarted': {
      if (HIDDEN_ITEM_KINDS.has(event.kind)) {
        return state
      }
      const entry: TranscriptEntry =
        event.kind === 'agentMessage'
          ? { kind: 'assistant', id: event.itemId, text: '', isStreaming: true }
          : { kind: 'activity', id: event.itemId, itemKind: event.kind, status: 'inProgress' }
      return { ...state, transcript: [...state.transcript, entry] }
    }
    case 'textDelta': {
      return {
        ...state,
        transcript: updateEntry(state.transcript, event.itemId, (entry) =>
          entry.kind === 'assistant' ? { ...entry, text: entry.text + event.delta } : entry,
        ),
      }
    }
    case 'itemCompleted': {
      return {
        ...state,
        transcript: updateEntry(state.transcript, event.itemId, (entry) => {
          if (entry.kind === 'assistant') {
            return { ...entry, text: event.text ?? entry.text, isStreaming: false }
          }
          return entry.kind === 'activity' ? { ...entry, status: event.status } : entry
        }),
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
    case 'effortChanged':
    case 'approvalModeChanged':
    case 'skillsChanged': {
      // The host confirms the resulting composer state / skill list itself.
      return state
    }
  }
}

function applyHostMessage(state: UiState, message: HostToWebviewMessage): UiState {
  switch (message.type) {
    case 'init': {
      return {
        ...state,
        phase: 'ready',
        extensionVersion: message.extensionVersion,
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
      return applyAgentEvent(state, message.event)
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
  }
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'hostMessage': {
      return applyHostMessage(state, action.message)
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
          { kind: 'user', id: action.localId, text: action.text, status: 'pending' },
        ],
      }
    }
    case 'attachmentRemoved': {
      return { ...state, attachments: state.attachments.filter((entry) => entry.id !== action.id) }
    }
    case 'conversationCleared': {
      return {
        ...state,
        transcript: [],
        attachments: [],
        activeTurnId: undefined,
        usage: undefined,
        context: undefined,
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
