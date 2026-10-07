import { JudgeStatusLine } from './components/JudgeStatusLine'
import {
  type ReactNode,
  Suspense,
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { QuestionAnswer } from '../shared/agentEvents'
import type { PlanNoticePort } from './components/PlanUi'
import type { OpenQuestionAnswer } from '../shared/questions'
import {
  type CheckpointAvailability,
  type DictationAction,
  type EffortLevel,
  GOAL_SLASH_COMMAND,
  HANDOFF_SLASH_COMMAND,
  LEGAL_SLASH_COMMAND,
  LOOP_SLASH_COMMAND,
  HOOK_RUN_SLASH_COMMAND,
  type GoalCommandVerb,
  MUSE_DELEGATION_ENABLED,
  REVIEW_SLASH_COMMAND,
  SETTING_DEFAULTS,
  type SubagentAction,
  UI_TEXT,
  SLASH_COMMAND_NAMES,
} from '../shared/constants'
import {
  parseReviewPrompt,
  reviewCommandText,
  type ReviewRequest,
  reviewRequestSchema,
} from '../shared/reviewCommand'
import { isLegalPrompt, parseLegalPrompt } from '../shared/legalCommand'
import type { LegalScanRequestMessage } from '../shared/legal'
import { editorContextLabel } from '../shared/editorContext'
import type { LegalFinding } from '../shared/legal'
import { effortAt, effortIndex, effortLabel, effortLevelsFor } from '../shared/effort'
import { parseGoalPrompt, requiresObjective } from '../shared/goalCommand'
import { parseHandoffPrompt } from '../shared/handoff'
import { parseLoopPrompt } from '../core/backends/modelapi/schedules'
import { fill, formatNumber, plural, templateParts } from '../shared/l10n/text'
import {
  availablePermissionModes,
  nextPermissionMode,
  permissionModeDetail,
} from '../shared/permissionModes'
import { paidFeatureName, paidFeaturePrice, usablePaidFeatures } from '../shared/paid'
import type * as PaletteRegistryModule from '../shared/paletteRegistry'
import type { PaletteAction } from '../shared/palette'
import { type SlashCommand, slashCommandsOf } from '../shared/slashCommands'
import type { GitAction, GitDraftKind } from '../shared/git'
import type {
  ChatReference,
  LineRange,
  NoticeAction,
  ReportEventRef,
  ReviewFile,
  SignInMethod,
  WebviewToHostMessage,
} from '../shared/protocol'
import { parseHostToWebviewMessage } from '../shared/protocol'
import type { GitFormEdit } from './state/gitState'
import type { ApprovalDecisionInput } from './components/ApprovalCard'
import { AttentionDock } from './components/AttentionDock'
import { QuestionSurface } from './components/QuestionSurface'
import { Composer, type ImageData, type SlashPaletteSlot } from './components/Composer'
import { DiffTally } from './components/DiffTally'
const EffortSlider = deferred(async () => {
  const module = await import('./components/EffortSlider')
  return { default: module.EffortSlider }
})
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { DeferredReportDialog } from './components/DeferredReportDialog'
import { AddContextIcon, ExpandChevron, UploadIcon } from './components/icons'
import { modeIcon } from './components/modeIcons'
import type { PaletteKeys, PaletteView } from './components/Palette'
import type { MenuEntry } from './components/PopoverMenu'
import { TodoPanel } from './components/TodoPanel'
import type { TeamTreeActions } from './components/TeamTree'
import { teamRunningTaskCount, teamTaskCount } from './state/teamEntries'
import { type QueuedCardRef, Transcript } from './components/Transcript'
import type { TeamCardActions } from './components/TeamCards'
import { diffTally } from '../shared/diffTally'
import { type ErrorReporter, webviewErrorReport } from './errorReport'
import { createUiStore, listenToHost, type UiStore } from './state/store'
import { hasFileAttachment } from './state/transcriptEntries'
import {
  canSend,
  agentsOf,
  backgroundTasksOf,
  conversationEdits,
  editsAfter,
  forkCutBefore,
  initialUiState,
  isRunningTask,
  planReplyIdOf,
  referenceLabel,
  reviewHunkKey,
  type UiState,
  userShellCommandOf,
  visibleEditorContext,
  waitingApprovals,
  questionsInOrder,
  workflowsOf,
} from './state/uiState'
import { isChildRunning } from './workflowDetails'
import type { QuoteIntent } from './components/QuoteMenu'
import { Modal } from './components/Modal'
import { reportCommandArguments } from '../shared/reportCommand'
import { deferred } from './components/DeferredSurface'

const LegalReport = deferred(async () => {
  const module = await import('./components/LegalReport')
  return { default: module.LegalReport }
}, true)
const UsageReportAction = deferred(() => import('./reporting/UsageReportAction'))

const SignIn = deferred(async () => {
  const module = await import('./components/SignIn')
  return { default: module.SignIn }
})
const GoalPanel = deferred(async () => {
  const module = await import('./components/GoalPanel')
  return { default: module.GoalPanel }
})
const SchedulePanel = deferred(async () => {
  const module = await import('./components/SchedulePanel')
  return { default: module.SchedulePanel }
})
const Palette = deferred(async () => {
  const module = await import('./components/Palette')
  return { default: module.Palette }
})
const PopoverMenu = deferred(async () => {
  const module = await import('./components/PopoverMenu')
  return { default: module.PopoverMenu }
})

const HistoryDialog = deferred(async () => {
  const module = await import('./components/HistoryDialog')
  return { default: module.HistoryDialog }
})
const AgentMap = deferred(async () => {
  const module = await import('./components/AgentMap')
  return { default: module.AgentMap }
}, true)
const UsageDialog = deferred(async () => {
  const module = await import('./components/UsageDialog')
  return { default: module.UsageSurface }
}, true)
const PlanUi = deferred(async () => {
  const module = await import('./components/PlanUi')
  return { default: module.PlanUi }
})
const SetupBanner = deferred(async () => {
  const module = await import('./components/SetupBanner')
  return { default: module.SetupBanner }
})
const BestOfNDialog = deferred(async () => {
  const module = await import('./components/BestOfNDialog')
  return { default: module.BestOfNDialog }
}, true)
const ReviewPane = deferred(async () => {
  const module = await import('./components/ReviewPane')
  return { default: module.ReviewPane }
}, true)
const ReferencePage = deferred(async () => {
  const stylesheet = document.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = new URL('referencePage.css', import.meta.url).href
  document.head.append(stylesheet)
  const module = await import('./components/ReferencePage')
  return {
    default: module.createReferencePage({
      react: { createElement, Fragment, useEffect, useMemo, useState },
      text: UI_TEXT,
      fill,
      formatNumber,
      Modal,
    }),
  }
}, true)

const HandoffDialog = deferred(async () => {
  const { HandoffDialog } = await import('./components/HandoffDialog')
  return { default: HandoffDialog }
}, true)

const SecretPromptDialog = deferred(async () => {
  const { SecretPromptDialog } = await import('./components/SecretPromptDialog')
  return { default: SecretPromptDialog }
}, true)

const SessionBoardDialog = deferred(async () => {
  const { SessionBoardDialog } = await import('./components/SessionBoardDialog')
  return { default: SessionBoardDialog }
})

const PromptLibraryBridge = deferred(async () => {
  const { PromptLibraryBridge } = await import('./prompts/PromptLibraryBridge')
  return { default: PromptLibraryBridge }
}, true)
const ChatShareBridge = deferred(async () => {
  const { ChatShareBridge } = await import('./sharing/ChatShareBridge')
  return { default: ChatShareBridge }
}, true)

const ShareView = deferred(async () => {
  const { ShareView } = await import('./components/ShareView')
  return { default: ShareView }
}, true)

export interface AppProps {
  readonly planNoticePort?: PlanNoticePort
  readonly postMessage: (message: WebviewToHostMessage) => void
  /**
   * The UI store. main.tsx owns one that outlives a crashed tree and keeps
   * reducing host messages under the crash screen (M25); without one the
   * app makes its own and listens to the host itself (the tests).
   */
  readonly store?: UiStore
  /** Injected so tests get deterministic ids. */
  readonly newLocalId?: () => string
  /** Injected so tests get deterministic timestamps. */
  readonly now?: () => number
}

type RewindConversationRequest = Extract<WebviewToHostMessage, { type: 'rewindConversation' }>

/**
 * The conversation rewind for a user card (M53): a fork cut before its turn
 * and its prompt back in the composer; undefined when the card cannot be
 * rewound (no cut, a running or a file card, no session).
 */
function rewindRequest(current: UiState, entryId: string): RewindConversationRequest | undefined {
  const entry = current.transcript.find((candidate) => candidate.id === entryId)
  const cut = forkCutBefore(current.transcript, entryId)
  if (
    cut === undefined ||
    current.sessionId === undefined ||
    entry?.kind !== 'user' ||
    entry.turnId === undefined ||
    entry.turnId === current.activeTurnId ||
    hasFileAttachment(entry.attachments)
  ) {
    return undefined
  }
  return {
    type: 'rewindConversation',
    sourceSessionId: current.sessionId,
    itemId: entry.replayItemId ?? entry.id,
    turnId: entry.turnId,
    ...(cut.type === 'afterTurn' && { lastTurnId: cut.lastTurnId }),
    text: entry.text,
    imageCount: entry.attachments.length,
  }
}

/** Why the user card's menu offers no file restore (M72), or undefined when it can. */
function restoreNoteOf(state: UiState): string | undefined {
  if (state.checkpoints.restoreBlocker === 'modelApiOnly') {
    return UI_TEXT.checkpointsModelApiOnly
  }
  if (state.checkpoints.restoreBlocker === 'nativeUnsafe') {
    return UI_TEXT.checkpointsNativeUnsafe
  }
  const notes: Readonly<Partial<Record<CheckpointAvailability, string>>> = {
    restricted: UI_TEXT.checkpointsRestricted,
    off: UI_TEXT.checkpointsOff,
    noGit: UI_TEXT.checkpointsNoGit,
  }
  return notes[state.checkpoints.availability]
}

// These panels share this runtime's React and installed language; importing
// them waits for state to show (Git) or the user's Account & usage action.
const GitPanel = deferred(async () => {
  const { GitPanel } = await import('./components/GitPanel')
  return { default: GitPanel }
})

/** What floats above the composer: a palette view, a menu, the History dialog or a modal. */
type Overlay =
  | PaletteView
  | 'modes'
  | 'attach'
  | 'history'
  | 'board'
  | 'bestOfN'
  | 'usage'
  | 'agents'
  | 'review'
  | 'prompts'
  | 'chatShare'
  | 'help'

// The palette rows that leave it open (a value changes in place); run from
// the prompt's "/" palette they keep the `/` too, so it stays (M38).
const KEEPS_PALETTE_OPEN: ReadonlySet<PaletteAction['type']> = new Set([
  'setEffort',
  'toggleThinking',
  'toggleFocusView',
  'toggleCtrlEnterToSend',
  'none',
])

// What choosing `/goal` leaves in the prompt: the command, ready for the objective (M45).
const GOAL_PROMPT_START = `/${GOAL_SLASH_COMMAND} `
const LOOP_PROMPT_START = `/${LOOP_SLASH_COMMAND} `
const HOOK_PROMPT_START = `/${HOOK_RUN_SLASH_COMMAND} `
// What choosing `/review` leaves: the command, ready for what to review (M70).
const REVIEW_PROMPT_START = `/${REVIEW_SLASH_COMMAND} `
// What choosing `/legal` leaves: the command, ready for a file subset (M97).
const LEGAL_PROMPT_START = `/${LEGAL_SLASH_COMMAND} `
// What choosing `/handoff` leaves in the prompt: the command, ready for the goal (M74).
const HANDOFF_PROMPT_START = `/${HANDOFF_SLASH_COMMAND} `
const GATED_STATUSES = new Set(['noCli', 'installing', 'signedOut', 'signingIn', 'error'])
const ATTACH_UPLOAD = 'upload'
const ATTACH_CONTEXT = 'context'
const MENTION_TRIGGER = '@'
const WHITESPACE_END = /\s$/
/** How far from the end the transcript still counts as "at the end" (M15). */
const SCROLL_END_SLACK_PX = 24

function isGated(state: UiState): boolean {
  return GATED_STATUSES.has(state.auth.status) && state.transcript.length === 0
}

/** The pill reads `model effort`, as the Claude Code pill does. */
export function modelLabelFor(state: UiState): string {
  if (state.auth.status !== 'signedIn') {
    return UI_TEXT.notSignedIn
  }
  if (state.model === undefined) {
    return UI_TEXT.hostStarting
  }
  const effort = state.isThinkingEnabled ? effortLabel(state.effort) : UI_TEXT.thinkingOff
  // A BYO model names its provider beside its model (M95): the listing's
  // label, else the reference's provider, so a bare id reads as it did.
  const option = state.models.find((model) => model.modelId === state.model?.modelId)
  const provider = option?.providerLabel ?? providerOf(state.model.modelId)
  return provider === undefined
    ? `${state.model.modelId} ${effort}`
    : `${provider} · ${option?.displayLabel ?? state.model.modelId} ${effort}`
}

/** The reference's provider (`openrouter` of `openrouter/…`); undefined for Meta's bare ids. */
function providerOf(modelId: string): string | undefined {
  const slash = modelId.indexOf('/')
  return slash === -1 ? undefined : modelId.slice(0, slash)
}

/**
 * The composer's paid badge (M33, PLAN.md D30): the paid features that are
 * on, named, with their prices in the tooltip. Shown on the Model API
 * backend only, the one that uses them.
 */
function paidBadgeFor(
  state: UiState,
): { readonly label: string; readonly title: string } | undefined {
  // The features on that this backend uses (M44: the key's images and voice on Muse Code).
  const usable = usablePaidFeatures(state.auth.backend, state.paid.isKeyStored)
  const features = state.paid.features.filter((feature) => usable.includes(feature))
  if (features.length === 0) {
    return undefined
  }
  const title = fill(UI_TEXT.paidBadgeTitle, {
    prices: features
      .map((feature) => `${paidFeatureName(feature)} ${paidFeaturePrice(feature)}`)
      .join('; '),
  })
  // What no longer asks here (M58) is said too: loud even when silent.
  const always = features.filter((feature) => state.paid.alwaysAllowed.includes(feature))
  return {
    label: fill(UI_TEXT.paidBadge, {
      features: features.map((feature) => paidFeatureName(feature)).join(', '),
    }),
    title:
      always.length === 0
        ? title
        : `${title} ${fill(UI_TEXT.usagePaidAlwaysNote, {
            features: always.map((feature) => paidFeatureName(feature)).join(', '),
          })}`,
  }
}

/** The "+" menu's rows, built when it opens so they are in the installed table. */
function attachEntries(): readonly MenuEntry[] {
  return [
    { id: ATTACH_UPLOAD, label: UI_TEXT.uploadFromComputer, icon: <UploadIcon /> },
    { id: ATTACH_CONTEXT, label: UI_TEXT.addContext, icon: <AddContextIcon /> },
  ]
}

/** "⇧ + tab to switch", with the keys as a key cap wherever the language puts them. */
function modesHint(): ReactNode {
  return (
    <span className="popover-hint">
      {templateParts(UI_TEXT.modesSwitchHint).map((part, index) =>
        typeof part === 'string' ? part : <kbd key={String(index)}>{UI_TEXT.modesHintKeys}</kbd>,
      )}
    </span>
  )
}

// Stable defaults: a fresh function per render would re-run the message
// effect (and re-post `ready`) on every render.
const defaultLocalId = () => crypto.randomUUID()
const defaultNow = () => Date.now()

function promptStartFor(action: PaletteAction): string | undefined {
  switch (action.type) {
    case 'insertSkill': {
      return `/${action.selector} `
    }
    case 'startGoal': {
      return GOAL_PROMPT_START
    }
    case 'startLoop': {
      return LOOP_PROMPT_START
    }
    case 'startHook': {
      return HOOK_PROMPT_START
    }
    case 'startReview': {
      return REVIEW_PROMPT_START
    }
    case 'startLegalScan': {
      return LEGAL_PROMPT_START
    }
    case 'startHandoff': {
      return HANDOFF_PROMPT_START
    }
    default: {
      return undefined
    }
  }
}

export function App({
  postMessage,
  store: externalStore,
  newLocalId = defaultLocalId,
  now = defaultNow,
  planNoticePort,
}: AppProps) {
  // Callbacks read the store's current state when they run instead of
  // closing over it, so they keep their identity across renders and the
  // memoised transcript rows skip a keystroke or a delta elsewhere (M25).
  const [store] = useState(() => externalStore ?? createUiStore(initialUiState))
  const [isOwnStore] = useState(externalStore === undefined)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const { dispatch } = store
  const selectedModel = state.models.find((model) => model.modelId === state.model?.modelId)
  const selectedProvider = providerOf(state.model?.modelId ?? '') ?? selectedModel?.providerId
  const hasPlan =
    state.auth.status === 'signedIn' &&
    (selectedProvider === 'chatgpt' ||
      selectedProvider === 'copilot' ||
      selectedModel?.pricing === 'plan')
  const [isPlanModalOpen, setPlanModalOpen] = useState<boolean>()
  const [chosenOverlay, setOverlay] = useState<Overlay | undefined>(undefined)
  const sharingAction = useCallback(
    (action: string, payload: unknown = {}) => {
      postMessage({ type: 'sharingAction', id: newLocalId(), action, payload })
    },
    [postMessage, newLocalId],
  )
  const savePrompt = useCallback(
    (text: string) => {
      sharingAction('saveText', { text })
    },
    [sharingAction],
  )
  const sharePrompt = useCallback(
    (text: string) => {
      sharingAction('shareText', { text })
    },
    [sharingAction],
  )
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const parsed = parseHostToWebviewMessage(event.data)
      if (parsed.ok && parsed.message.type === 'openSharing')
        setOverlay(parsed.message.surface === 'chat' ? 'chatShare' : 'prompts')
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [])
  // The review pane's changes go with their conversation (a clear, another
  // session), and the pane goes with them (M70).
  const overlay =
    chosenOverlay === 'review' && state.reviewPane === undefined ? undefined : chosenOverlay
  const [isInstallConfirmOpen, setIsInstallConfirmOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined)
  const canBypass = state.settings?.allowDangerouslySkipPermissions ?? false
  // The Auto reviewer on Muse Code (M90), as its setting says, and the paid
  // one on the Model API (M78), on with its price accepted.
  const hasMuseCodeReviewer =
    state.settings?.museCodeAutoReviewer ?? SETTING_DEFAULTS.museCodeAutoReviewer
  const hasModelApiReviewer = state.paid.features.includes('autoReviewer')

  // The transcript follows new entries while the reader is at its end; once
  // they scroll up it holds still and offers a jump to the newest (M15).
  // `seenTranscript` is the transcript as of the reader's last scroll, so
  // "new below" means it changed since, while they were away from the end.
  const bodyRef = useRef<HTMLElement>(null)
  const [isPinnedToEnd, setIsPinnedToEnd] = useState(true)
  const nextGoalRequestId = useRef(0)
  const nextHandoffRequestId = useRef(0)
  const nextAttachmentRequestId = useRef(0)
  const isPinnedRef = useRef(isPinnedToEnd)
  const [seenTranscript, setSeenTranscript] = useState(state.transcript)
  const hasNewBelow =
    !isPinnedToEnd && state.transcript !== seenTranscript && state.transcript.length > 0
  const scrollToEnd = useCallback(() => {
    const body = bodyRef.current
    if (body !== null) {
      body.scrollTop = body.scrollHeight
    }
    setIsPinnedToEnd(true)
    setSeenTranscript(store.getState().transcript)
  }, [store])
  const onBodyScroll = useCallback(() => {
    const body = bodyRef.current
    if (body === null) {
      return
    }
    const isAtEnd = body.scrollHeight - body.scrollTop - body.clientHeight <= SCROLL_END_SLACK_PX
    setIsPinnedToEnd(isAtEnd)
    setSeenTranscript(store.getState().transcript)
  }, [store])
  useEffect(() => {
    isPinnedRef.current = isPinnedToEnd
  }, [isPinnedToEnd])
  // Before paint, so a new row never shows a frame above the end.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (isPinnedToEnd && body !== null) {
      body.scrollTop = body.scrollHeight
    }
  }, [state.transcript, isPinnedToEnd])

  useEffect(() => {
    const report: ErrorReporter = (source, error) => {
      postMessage(webviewErrorReport(source, error))
    }
    const stop = isOwnStore ? listenToHost(store, window, now, report) : undefined
    postMessage({ type: 'ready', attachmentEpoch: store.getState().attachmentEpoch })
    return () => {
      stop?.()
    }
  }, [store, isOwnStore, postMessage, now])

  // A refused message's images the host may still hold go back to it to be
  // dropped (M25): the reducer lists them, the app posts and acknowledges.
  const { attachmentsToRelease } = state
  useEffect(() => {
    if (attachmentsToRelease.length === 0) {
      return
    }
    for (const id of attachmentsToRelease) {
      postMessage({ type: 'removeAttachment', id })
    }
    dispatch({ type: 'attachmentsReleased', ids: attachmentsToRelease })
  }, [attachmentsToRelease, postMessage, dispatch])

  // Focus anywhere in the panel makes it the surface the keybindings act on
  // (M25): New Conversation clears the conversation the user was looking at.
  useEffect(() => {
    const onFocus = () => {
      postMessage({ type: 'surfaceFocused' })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
    }
  }, [postMessage])

  const onDraftChange = useCallback(
    (draft: string) => {
      dispatch({ type: 'draftChanged', draft })
    },
    [dispatch],
  )
  const onInsertApplied = useCallback(() => {
    dispatch({ type: 'insertApplied' })
  }, [dispatch])
  const onFocusChange = useCallback(
    (isFocused: boolean) => {
      postMessage({ type: 'inputFocusChanged', focused: isFocused })
    },
    [postMessage],
  )
  // The header button starts a new conversation in this surface, as in
  // Claude Code; a new editor tab is Ctrl+Shift+Esc or the view-title `+`.
  // The host echoes the clear back; the reducer spends that echo (M25).
  const onNewConversation = useCallback(() => {
    dispatch({ type: 'conversationCleared' })
    postMessage({ type: 'clearConversation', attachmentEpoch: store.getState().attachmentEpoch })
  }, [dispatch, postMessage, store])
  // The session goal's verbs (M45, PLAN.md D38): the strip's buttons and `/goal …`.
  const onGoalCommand = useCallback(
    (verb: GoalCommandVerb, objective?: string, source?: 'composer' | 'inline') => {
      const requestId = `goal:${newLocalId()}:${String(++nextGoalRequestId.current)}`
      if (source === 'composer') {
        dispatch({ type: 'goalSubmitted', requestId })
      } else if (source === 'inline' && objective !== undefined) {
        dispatch({ type: 'goalEditSubmitted', requestId, objective })
      }
      postMessage({
        type: 'goalCommand',
        requestId,
        verb,
        ...(objective !== undefined && { objective }),
      })
    },
    [dispatch, newLocalId, postMessage],
  )
  const onGoalEditStarted = useCallback(
    (objective: string) => {
      dispatch({ type: 'goalEditStarted', objective })
    },
    [dispatch],
  )
  const onGoalEditChanged = useCallback(
    (draft: string) => {
      dispatch({ type: 'goalEditChanged', draft })
    },
    [dispatch],
  )
  const onGoalEditCanceled = useCallback(() => {
    dispatch({ type: 'goalEditCanceled' })
  }, [dispatch])
  const onGoalEditSaved = useCallback(
    (objective: string) => {
      if (store.getState().goalEdit?.pending !== undefined) {
        return
      }
      onGoalCommand('edit', objective, 'inline')
    },
    [store, onGoalCommand],
  )
  // Git and pull requests (M71): the panel's buttons, forms and drafts.
  const onGitAction = useCallback(
    (action: GitAction) => {
      postMessage({ type: 'gitAction', action })
    },
    [postMessage],
  )
  const onGitEdit = useCallback(
    (edit: GitFormEdit) => {
      dispatch({ type: 'gitFormEdited', edit })
    },
    [dispatch],
  )
  const onGitClose = useCallback(() => {
    postMessage({ type: 'gitAction', action: 'cancel' })
    dispatch({ type: 'gitFormClosed' })
  }, [dispatch, postMessage])
  const onGitCommit = useCallback(() => {
    const { form } = store.getState().git
    if (form?.kind !== 'commit') {
      return
    }
    dispatch({ type: 'gitFormBusy' })
    postMessage({
      type: 'gitCommit',
      message: form.message,
      includeUnstaged: form.includeUnstaged,
    })
  }, [store, dispatch, postMessage])
  const onGitCreatePullRequest = useCallback(() => {
    const { form } = store.getState().git
    if (form?.kind !== 'pullRequest') {
      return
    }
    dispatch({ type: 'gitFormBusy' })
    postMessage({
      type: 'gitCreatePullRequest',
      head: form.facts.head,
      base: form.base,
      title: form.title,
      body: form.body,
      isDraft: form.isDraft,
    })
  }, [store, dispatch, postMessage])
  // The user's own message asks for the draft (PLAN.md D49: part of their turn).
  const onGitGenerate = useCallback(
    (kind: GitDraftKind) => {
      const current = store.getState()
      if (current.auth.status !== 'signedIn' || current.activeTurnId !== undefined) {
        return
      }
      const localId = newLocalId()
      const text =
        kind === 'commitMessage' ? UI_TEXT.gitAskCommitMessage : UI_TEXT.gitAskPullRequest
      dispatch({ type: 'gitDraftRequested', localId, text })
      postMessage({
        type: 'sendMessage',
        localId,
        text,
        attachmentIds: [],
        gitDraft: kind,
        ...(current.git.form?.kind === 'pullRequest' && { gitDraftBase: current.git.form.base }),
      })
      setIsPinnedToEnd(true)
    },
    [store, dispatch, newLocalId, postMessage],
  )
  // `/handoff …` is a command to the backend, not a message (M74): the
  // host cards the accepted request itself, and the brief comes back as a
  // dialog before anything starts. The draft clears only once the host
  // accepts it, as for `/goal` (M45): a refused handoff keeps its goal.
  const onHandoff = useCallback(
    (goal: string | undefined) => {
      const requestId = `handoff:${newLocalId()}:${String(++nextHandoffRequestId.current)}`
      dispatch({ type: 'handoffSubmitted', requestId })
      postMessage({
        type: 'requestHandoff',
        requestId,
        ...(goal !== undefined && { goal }),
      })
    },
    [dispatch, newLocalId, postMessage],
  )
  const onHandoffChanged = useCallback(
    (draft: string) => {
      dispatch({ type: 'handoffChanged', draft })
    },
    [dispatch],
  )
  const onHandoffConfirm = useCallback(
    (brief: string) => {
      const pending = store.getState().handoff
      if (pending === undefined || pending.isConfirming) {
        return
      }
      dispatch({ type: 'handoffConfirming' })
      postMessage({ type: 'confirmHandoff', requestId: pending.requestId, brief })
    },
    [store, dispatch, postMessage],
  )
  const onHandoffCancel = useCallback(() => {
    const pending = store.getState().handoff
    dispatch({ type: 'handoffDismissed' })
    if (pending !== undefined) {
      postMessage({ type: 'cancelHandoff', requestId: pending.requestId })
    }
  }, [store, dispatch, postMessage])
  const onScheduleRun = useCallback(
    (id: string, occurrenceMs: number) => {
      postMessage({ type: 'scheduleRun', id, occurrenceMs })
    },
    [postMessage],
  )
  const onScheduleCancel = useCallback(
    (id: string) => {
      postMessage({ type: 'scheduleCancel', id })
    },
    [postMessage],
  )
  const onScheduleEnable = useCallback(() => {
    postMessage({ type: 'setPaidFeature', feature: 'scheduledPrompts', isOn: true })
  }, [postMessage])
  // `/review …` and the palette's review rows (M70): the card first, then the
  // host's word on it, as for a message. False when the request is refused here.
  const onReview = useCallback(
    (request: ReviewRequest, text: string): boolean => {
      const parsed = reviewRequestSchema.safeParse(request)
      if (!parsed.success) {
        dispatch({
          type: 'noticeRaised',
          level: 'warning',
          text: UI_TEXT.reviewInstructionsTooLong,
        })
        return false
      }
      const localId = newLocalId()
      dispatch({ type: 'cardSubmitted', localId, text })
      postMessage({ type: 'startReview', localId, text, request: parsed.data })
      setIsPinnedToEnd(true)
      return true
    },
    [dispatch, newLocalId, postMessage],
  )
  // `/legal …` and the palette's legal row (M97): the host runs the
  // deterministic scan and answers with the report (lane W renders it), so
  // no card is submitted. The parse is total over the schema, so the input
  // always posts as parsed.
  const onLegalScan = useCallback(
    (text: string): boolean => {
      if (!isLegalPrompt(text)) return false
      const input = parseLegalPrompt(text)
      if (input === undefined) {
        dispatch({ type: 'noticeRaised', level: 'warning', text: UI_TEXT.legalCommandUsage })
        return true
      }
      postMessage({ type: 'requestLegalScan', input } satisfies LegalScanRequestMessage)
      setIsPinnedToEnd(true)
      return true
    },
    [dispatch, postMessage],
  )
  const onSubmit = useCallback(() => {
    const current = store.getState()
    if (onLegalScan(current.draft.trim())) {
      dispatch({ type: 'draftChanged', draft: '' })
      return
    }
    if (current.draft.trim() === `/${SLASH_COMMAND_NAMES.help}`) {
      dispatch({ type: 'draftChanged', draft: '' })
      setOverlay('help')
      return
    }
    const reportArguments = reportCommandArguments(current.draft)
    if (reportArguments !== undefined) {
      if (current.pendingReportCommand !== undefined) return
      const requestId = newLocalId()
      dispatch({ type: 'reportSubmitted', requestId })
      postMessage({ type: 'runReport', requestId, argumentsText: reportArguments })
      return
    }
    if (!canSend(current)) {
      return
    }
    // `!command` runs in the workspace (M46): its row comes from the host,
    // and the images and the reference chip wait for the next message.
    const command = userShellCommandOf(current.draft)
    if (command !== undefined) {
      dispatch({ type: 'draftChanged', draft: '' })
      postMessage({ type: 'runUserShell', command })
      setIsPinnedToEnd(true)
      return
    }
    const text = current.draft.trim()
    if (text === HOOK_PROMPT_START.trim() || text.startsWith(HOOK_PROMPT_START)) {
      const name = text.slice(HOOK_PROMPT_START.trim().length).trim()
      if (name === '') {
        dispatch({ type: 'noticeRaised', level: 'warning', text: UI_TEXT.manualHookPick })
        return
      }
      dispatch({ type: 'draftChanged', draft: '' })
      postMessage({ type: 'runManualHook', name })
      return
    }
    // `/review …` (M70): a review turn, its card what was typed. The chips
    // and the reference chip wait for the next message.
    const review = parseReviewPrompt(text)
    if (review !== undefined) {
      if (onReview(review, text)) {
        dispatch({ type: 'draftChanged', draft: '' })
      }
      return
    }
    // `/goal …` is a command to the backend, not a message (M45): no card.
    const goal = parseGoalPrompt(text)
    if (goal !== undefined) {
      if (current.pendingGoalCommand?.draftRevision === current.draftRevision) {
        return
      }
      if (requiresObjective(goal.verb) && (goal.objective ?? '') === '') {
        dispatch({ type: 'noticeRaised', level: 'warning', text: UI_TEXT.goalObjectiveMissing })
        return
      }
      onGoalCommand(goal.verb, goal.objective, 'composer')
      setIsPinnedToEnd(true)
      return
    }
    // `/handoff …` distils the conversation for a fresh one (M74), on
    // either backend (the host says where it cannot run).
    const handoff = parseHandoffPrompt(text)
    if (handoff !== undefined) {
      // Sent already and not yet answered: a second Enter sends nothing.
      if (current.pendingHandoffCommand?.draftRevision === current.draftRevision) {
        return
      }
      onHandoff(handoff.goal)
      setIsPinnedToEnd(true)
      return
    }
    // Model API schedules are extension-owned. Muse Code's cron remains a
    // model-mediated ordinary turn because MSP has no scheduler verbs (M52).
    const loop = current.auth.backend === 'modelApi' ? parseLoopPrompt(text) : undefined
    if (loop !== undefined) {
      if (!loop.ok) {
        dispatch({ type: 'noticeRaised', level: 'warning', text: UI_TEXT.loopSyntax })
        return
      }
      dispatch({ type: 'draftChanged', draft: '' })
      switch (loop.command.verb) {
        case 'create': {
          postMessage({
            type: 'scheduleCreate',
            cadence: loop.command.cadence,
            prompt: loop.command.prompt,
          })
          break
        }
        case 'list': {
          postMessage({ type: 'scheduleList' })
          break
        }
        case 'cancel': {
          postMessage({ type: 'scheduleCancel', id: loop.command.id })
          break
        }
      }
      return
    }
    const localId = newLocalId()
    const attachmentIds = current.attachments.map((attachment) => attachment.id)
    // The open-file chip travels with the message: the host adds the context.
    const editorContext = visibleEditorContext(current)
    dispatch({
      type: 'submitted',
      localId,
      text,
      attachments: current.attachments,
      contextLabel: editorContext === undefined ? undefined : editorContextLabel(editorContext),
      reference: current.reference,
      // The card shows when it was sent until the host's recorded time arrives (D66).
      at: now(),
    })
    postMessage({
      type: 'sendMessage',
      localId,
      text,
      attachmentIds,
      includeEditorContext: editorContext !== undefined,
      ...(current.reference !== undefined && { reference: current.reference }),
    })
    // The reader's own message always lands in view (M15).
    setIsPinnedToEnd(true)
  }, [
    store,
    dispatch,
    newLocalId,
    now,
    postMessage,
    onGoalCommand,
    onReview,
    onLegalScan,
    onHandoff,
  ])
  // Send exactly the payload the dialog previewed. The composer may now
  // hold a newer draft, different chips or a different reference.
  const onSecretPromptSendAnyway = useCallback(() => {
    const current = store.getState()
    const held = current.secretPrompt
    if (held === undefined || current.auth.status !== 'signedIn') return
    const localId = newLocalId()
    const text = held.draft.trim()
    dispatch({
      type: 'submitted',
      localId,
      text,
      isSecretResend: true,
      at: now(),
      attachments: held.attachments,
      contextLabel: held.contextLabel,
      ...(held.reference !== undefined && { reference: held.reference }),
    })
    postMessage({
      type: 'sendMessage',
      localId,
      text,
      secretAccepted: true,
      attachmentIds: held.attachments.map((attachment) => attachment.id),
      includeEditorContext: held.contextLabel !== undefined,
      ...(held.reference !== undefined && { reference: held.reference }),
    })
    setIsPinnedToEnd(true)
  }, [store, dispatch, newLocalId, now, postMessage])
  const onSecretPromptDismiss = useCallback(() => {
    dispatch({ type: 'secretPromptDismissed' })
  }, [dispatch])
  const onDismissEditorContext = useCallback(() => {
    dispatch({ type: 'editorContextDismissed' })
  }, [dispatch])
  // Replying to an output and quoting a highlighted passage (M17): both set
  // the composer's reference chip; the message carries it as context.
  const [quoteMenuState, setQuoteMenu] = useState<
    | {
        readonly entryId: string
        readonly role: string
        readonly text: string
        readonly epoch: number
        readonly origin: { readonly x: number; readonly y: number }
      }
    | undefined
  >(undefined)
  // A clear can come from another panel. A saved selection from its rows is inert.
  const quoteMenu = quoteMenuState?.epoch === state.attachmentEpoch ? quoteMenuState : undefined
  const onDismissReference = useCallback(() => {
    dispatch({ type: 'referenceCleared' })
  }, [dispatch])
  const onReply = useCallback(
    (entryId: string) => {
      const entry = store.getState().transcript.find((candidate) => candidate.id === entryId)
      if (entry?.kind !== 'assistant') {
        return
      }
      dispatch({
        type: 'referenceSet',
        reference: { intent: 'reply', role: 'assistant', entryId, text: entry.text },
      })
      dispatch({ type: 'focusRequested' })
    },
    [store, dispatch],
  )
  const onTranscriptContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      const anchor = selection?.anchorNode ?? null
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      const row = element?.closest<HTMLElement>('[data-entry-id]') ?? null
      const entryId = row?.dataset['entryId']
      // A right-click on another row than the one holding the text is not a
      // quote of it (the review of F2, P1); the gaps between rows still are.
      const target = event.target instanceof Element ? event.target : null
      const clickedRow = target?.closest('[data-entry-id]') ?? null
      if (
        text === '' ||
        row === null ||
        entryId === undefined ||
        (clickedRow !== null && clickedRow !== row)
      ) {
        return
      }
      event.preventDefault()
      setQuoteMenu({
        entryId,
        role: row.dataset['role'] ?? 'assistant',
        origin: { x: event.clientX, y: event.clientY },
        text,
        epoch: store.getState().attachmentEpoch,
      })
    },
    [store],
  )
  const onCloseQuoteMenu = useCallback(() => {
    setQuoteMenu(undefined)
  }, [])
  const onQuote = useCallback(
    (intent: QuoteIntent) => {
      if (quoteMenu === undefined) {
        return
      }
      dispatch({
        type: 'referenceSet',
        reference: {
          intent,
          role: quoteMenu.role,
          entryId: quoteMenu.entryId,
          text: quoteMenu.text,
        },
      })
      setQuoteMenu(undefined)
      dispatch({ type: 'focusRequested' })
    },
    [quoteMenu, dispatch],
  )
  // Our menu replaces the browser's on a selection, so it carries the
  // browser's Copy too (M25).
  const onCopyQuote = useCallback(() => {
    if (quoteMenu !== undefined) {
      postMessage({ type: 'copyText', text: quoteMenu.text })
    }
    setQuoteMenu(undefined)
  }, [quoteMenu, postMessage])
  const onHideOnboarding = useCallback(() => {
    postMessage({ type: 'hostAction', action: 'hideOnboarding' })
  }, [postMessage])
  const onStop = useCallback(() => {
    postMessage({ type: 'cancelTurn' })
  }, [postMessage])
  const onDictation = useCallback(
    (action: DictationAction) => {
      postMessage({ type: 'dictation', action })
    },
    [postMessage],
  )
  const onSignIn = useCallback(
    (method: SignInMethod) => {
      postMessage({ type: 'signIn', method })
    },
    [postMessage],
  )
  const onRetry = useCallback(() => {
    postMessage({ type: 'retryBackend' })
  }, [postMessage])
  const onOpenExternal = useCallback(
    (url: string) => {
      postMessage({ type: 'openExternal', url })
    },
    [postMessage],
  )
  const onCopy = useCallback(
    (text: string) => {
      postMessage({ type: 'copyText', text })
    },
    [postMessage],
  )
  const onInsert = useCallback(
    (text: string) => {
      postMessage({ type: 'insertCode', text })
    },
    [postMessage],
  )
  const onReadOutput = useCallback(
    (itemId: string, outputRef: string, offsetBytes: number) => {
      postMessage({ type: 'readOutput', itemId, outputRef, offsetBytes })
    },
    [postMessage],
  )
  const onReadImage = useCallback(
    (itemId: string, path: string) => {
      postMessage({ type: 'readToolImage', itemId, path })
    },
    [postMessage],
  )
  const onOpenOutput = useCallback(
    (itemId: string, label: string, text: string, outputRef: string | undefined) => {
      postMessage({
        type: 'openOutput',
        itemId,
        label,
        text,
        ...(outputRef !== undefined && { outputRef }),
      })
    },
    [postMessage],
  )
  const onApply = useCallback(
    (text: string) => {
      postMessage({ type: 'applyCode', text })
    },
    [postMessage],
  )
  const onOpenEditDiff = useCallback(
    (itemId: string, outputRef: string) => {
      postMessage({ type: 'openEditDiff', itemId, outputRef })
    },
    [postMessage],
  )
  // An edit row's Revert (M87, D66 item 17): the host confirms before it writes.
  const onRevertEdit = useCallback(
    (itemId: string, outputRef: string) => {
      postMessage({ type: 'revertEdit', itemId, outputRef })
    },
    [postMessage],
  )
  // Edit on a queued card (M87, PLAN.md D66): the host takes the message back
  // under the ids it gave the card, or says it already reached the model.
  const onEditQueued = useCallback(
    ({ localId, turnId, userMessageId }: QueuedCardRef) => {
      postMessage({
        type: 'withdrawQueued',
        localId,
        turnId,
        ...(userMessageId !== undefined && { userMessageId }),
      })
    },
    [postMessage],
  )
  // The task list in an editor tab the user can move into its own window (M87).
  const onOpenTasksTab = useCallback(() => {
    postMessage({ type: 'hostAction', action: 'openTasksTab' })
  }, [postMessage])
  const onOpenFile = useCallback(
    (filePath: string, range: LineRange | undefined) => {
      postMessage({ type: 'openFile', path: filePath, ...range })
    },
    [postMessage],
  )
  // The legal report's selected-fix handoff (M97 lane W): preview fixes for
  // exactly the selected findings, then confirm exactly the shown preview.
  // The host rechecks mode, trust, workspace and hashes before any write.
  const onRequestLegalFix = useCallback(
    (findings: readonly LegalFinding[], isProjectLicenseIncluded: boolean) => {
      const report = store.getState().legalReport
      if (report === undefined) {
        return
      }
      const requestId = newLocalId()
      dispatch({ type: 'legalFixRequested', requestId })
      postMessage({
        type: 'requestLegalFix',
        requestId,
        scan: {
          scanId: report.requestId,
          ruleVersion: report.result.ruleVersion,
          dataVersion: report.result.dataVersion,
          scope: report.result.scope,
        },
        findings: [...findings],
        includeProjectLicense: isProjectLicenseIncluded,
      })
    },
    [postMessage, store, dispatch, newLocalId],
  )
  const onConfirmLegalFix = useCallback(
    (previewId: string) => {
      postMessage({ type: 'confirmLegalFix', previewId })
    },
    [postMessage],
  )
  const onRescanLegal = useCallback(() => {
    postMessage({ type: 'requestLegalScan' })
  }, [postMessage])
  const onCloseLegalReport = useCallback(() => {
    dispatch({ type: 'legalReportClosed' })
  }, [dispatch])
  const onRefuseLink = useCallback(() => {
    dispatch({ type: 'noticeRaised', level: 'warning', text: UI_TEXT.linkOutsideWorkspace })
  }, [dispatch])
  const onDecide = useCallback(
    (decision: ApprovalDecisionInput) => {
      dispatch({
        type: 'approvalDecided',
        approvalId: decision.approvalId,
        requirementId: decision.requirementId,
      })
      postMessage({
        type: 'decideApproval',
        approvalId: decision.approvalId,
        choiceId: decision.choiceId,
        requirementId: decision.requirementId,
        ...(decision.feedback !== undefined && { feedback: decision.feedback }),
      })
    },
    [dispatch, postMessage],
  )
  // Both views lock before dispatch; only an explicit nothing-taken failure unlocks.
  const onQuestionAction = useCallback(
    (userInputId: string, reply: OpenQuestionAnswer | 'dismiss' | undefined) => {
      const sessionId = store.getState().sessionId
      const attachmentEpoch = store.getState().attachmentEpoch
      void import('./components/QuestionUi')
        .then((actions) => {
          const current = store.getState()
          if (current.sessionId === sessionId && current.attachmentEpoch === attachmentEpoch)
            actions.questionAction(store, postMessage, userInputId, reply)
        })
        .catch((error: unknown) => {
          postMessage(webviewErrorReport('promise', error))
        })
    },
    [postMessage, store],
  )
  const onAnswer = useCallback(
    (userInputId: string, answers: readonly QuestionAnswer[]) => {
      onQuestionAction(userInputId, { answers: [...answers] })
    },
    [onQuestionAction],
  )
  const onCancelQuestion = useCallback(
    (userInputId: string) => {
      onQuestionAction(userInputId, undefined)
    },
    [onQuestionAction],
  )
  // The team's waiting and merge cards (M96 lane U2): the answers post to
  // the host, which lanes T/A/W answer. The cards lock locally until the
  // host's next update replaces the row.
  const teamActions = useMemo<TeamCardActions>(
    () => ({
      onAnswerWaiting: (waitingId, choice) => {
        postMessage({ type: 'answerTeamWaiting', waitingId, choice })
      },
      onDecideMerge: (taskId, decision) => {
        postMessage({ type: 'decideTeamMerge', taskId, decision })
      },
      onReviewDiff: (taskId) => {
        postMessage({ type: 'reviewTeamDiff', taskId })
      },
    }),
    [postMessage],
  )
  // The Agent map's team tree (M96 lane U2): every button posts to the
  // host; the tree itself renders from the host's `teamTree` message.
  const teamTreeActions = useMemo<TeamTreeActions>(
    () => ({
      onOpenTranscript: (taskId) => {
        postMessage({ type: 'openTeamTaskTranscript', taskId })
      },
      onStopTask: (taskId) => {
        postMessage({ type: 'stopTeamTask', taskId })
      },
      onReviewDiff: (taskId) => {
        postMessage({ type: 'reviewTeamDiff', taskId })
      },
      onDecideMerge: (taskId, decision) => {
        postMessage({ type: 'decideTeamMerge', taskId, decision })
      },
      onEditRole: (roleId) => {
        postMessage({ type: 'openTeamRoles', roleId })
      },
      onResetEntry: (entryId) => {
        postMessage({ type: 'resetTeamEntry', entryId })
      },
      onStopAll: () => {
        postMessage({ type: 'stopAllTeamTasks' })
      },
    }),
    [postMessage],
  )
  const onClarifyQuestion = useCallback(
    (userInputId: string, text: string) => {
      onQuestionAction(userInputId, { explanation: text })
    },
    [onQuestionAction],
  )
  const onDismissQuestion = useCallback(
    (userInputId: string) => {
      onQuestionAction(userInputId, 'dismiss')
    },
    [onQuestionAction],
  )
  const onJumpQuestion = useCallback(
    (direction: 'next' | 'previous') => {
      dispatch({ type: 'questionJump', direction })
    },
    [dispatch],
  )

  useEffect(() => {
    const count = questionsInOrder(state).filter((question) => question.state === 'open').length
    const title = state.title ?? UI_TEXT.untitledConversation
    document.title =
      count === 0 ? title : `${title} · ${plural(UI_TEXT.openQuestionsTabCount, count)}`
  }, [state])
  // All three lock the form until the host settles it (M91 lane M).
  const onAcceptElicitation = useCallback(
    (elicitationId: string, values: Record<string, unknown>) => {
      dispatch({ type: 'elicitationSubmitted', elicitationId })
      postMessage({ type: 'elicitationAnswer', elicitationId, action: 'accept', values })
    },
    [dispatch, postMessage],
  )
  const onDeclineElicitation = useCallback(
    (elicitationId: string) => {
      dispatch({ type: 'elicitationSubmitted', elicitationId })
      postMessage({ type: 'elicitationAnswer', elicitationId, action: 'decline' })
    },
    [dispatch, postMessage],
  )
  const onCancelElicitation = useCallback(
    (elicitationId: string) => {
      dispatch({ type: 'elicitationSubmitted', elicitationId })
      postMessage({ type: 'elicitationAnswer', elicitationId, action: 'cancel' })
    },
    [dispatch, postMessage],
  )
  // A row's Move to background and Stop wait for the host's word (M46).
  const onMoveToBackground = useCallback(
    (itemId: string) => {
      dispatch({ type: 'taskRequested', itemId, request: 'background' })
      postMessage({ type: 'moveToBackground', itemId })
    },
    [dispatch, postMessage],
  )
  const onStopTask = useCallback(
    (itemId: string) => {
      dispatch({ type: 'taskRequested', itemId, request: 'stop' })
      postMessage({ type: 'stopTask', itemId })
    },
    [dispatch, postMessage],
  )
  const onStopAllTasks = useCallback(() => {
    postMessage({ type: 'stopAllTasks' })
  }, [postMessage])
  const onCyclePermissionMode = useCallback(() => {
    const current = store.getState()
    postMessage({
      type: 'setPermissionMode',
      mode: nextPermissionMode(
        current.permissionMode,
        current.settings?.allowDangerouslySkipPermissions ?? false,
      ),
    })
  }, [store, postMessage])
  const openOverlay = useCallback(
    (view: Overlay) => {
      if ((view === 'actions' || view === 'models') && store.getState().skills === undefined) {
        postMessage({ type: 'listSkills' })
      }
      switch (view) {
        case 'history': {
          // Always re-list: the rows change while the dialog is closed.
          postMessage({ type: 'listSessions' })
          break
        }
        case 'board': {
          // The board re-reads too: conversations change while it is closed.
          postMessage({ type: 'listSessions' })
          postMessage({ type: 'requestSessionBoard' })
          break
        }
        case 'usage':
        case 'agents': {
          // The Agent map notes Muse Code's delegation and workflow settings
          // from the same account facts (M47), read fresh as the dialog's are.
          postMessage({ type: 'readUsage' })
          break
        }
        default: {
          break
        }
      }
      setOverlay(view)
    },
    [store, postMessage],
  )
  const closeOverlay = useCallback(() => {
    setOverlay(undefined)
    // A brief that waited behind the closed modal opens now and takes the
    // focus itself (M74); the prompt behind it is inert.
    if (store.getState().handoff === undefined) {
      dispatch({ type: 'focusRequested' })
    }
  }, [store, dispatch])
  // A local share file open read-only (M84): closing returns focus the same way.
  const onCloseShare = useCallback(() => {
    dispatch({ type: 'shareClosed' })
    if (store.getState().handoff === undefined) {
      dispatch({ type: 'focusRequested' })
    }
  }, [store, dispatch])
  // A share section that failed to render shows that in its place; the host's log says why.
  const onShareSectionError = useCallback(
    (error: unknown) => {
      postMessage(webviewErrorReport('render', error))
    },
    [postMessage],
  )
  // Every composer button toggles what it opens: a second click closes.
  const toggleOverlay = useCallback(
    (view: Overlay) => {
      if (overlay === view) {
        closeOverlay()
      } else {
        openOverlay(view)
      }
    },
    [overlay, closeOverlay, openOverlay],
  )
  const onOpenPalette = useCallback(() => {
    toggleOverlay('actions')
  }, [toggleOverlay])
  const onOpenModelPicker = useCallback(() => {
    toggleOverlay('models')
  }, [toggleOverlay])
  const onOpenModeMenu = useCallback(() => {
    toggleOverlay('modes')
  }, [toggleOverlay])
  const onOpenAttachMenu = useCallback(() => {
    toggleOverlay('attach')
  }, [toggleOverlay])
  const onPaletteBack = useCallback(() => {
    setOverlay('actions')
  }, [])
  // The review pane (M70): the conversation's edits, read afresh each time it opens.
  const openReviewPane = useCallback(() => {
    const requestId = `review:${newLocalId()}`
    dispatch({ type: 'reviewPaneRequested', requestId })
    postMessage({
      type: 'readReviewChanges',
      requestId,
      edits: [...conversationEdits(store.getState())],
    })
    setOverlay('review')
  }, [dispatch, newLocalId, postMessage, store])
  const onReviewAccept = useCallback(
    (key: string, isAccepted: boolean) => {
      dispatch({ type: 'reviewHunkAccepted', key, isAccepted })
    },
    [dispatch],
  )
  const onReviewRevert = useCallback(
    (file: ReviewFile, hunkIndex: number) => {
      dispatch({
        type: 'reviewHunkReverting',
        key: reviewHunkKey(file.itemId, file.fileIndex, hunkIndex),
      })
      postMessage({
        type: 'revertReviewHunk',
        itemId: file.itemId,
        outputRef: file.outputRef,
        fileIndex: file.fileIndex,
        hunkIndex,
      })
    },
    [dispatch, postMessage],
  )
  // A comment on a line (M70): a message with the lines it is about, which
  // steers the running turn or starts the next one, as any message does.
  const onReviewComment = useCallback(
    (text: string, reference: ChatReference) => {
      const localId = newLocalId()
      dispatch({
        type: 'cardSubmitted',
        localId,
        text,
        reference,
        announcement: UI_TEXT.reviewCommentSent,
      })
      postMessage({ type: 'sendMessage', localId, text, attachmentIds: [], reference })
    },
    [dispatch, newLocalId, postMessage],
  )
  const onOpenHistory = useCallback(() => {
    toggleOverlay('history')
  }, [toggleOverlay])
  const onOpenBoard = useCallback(() => {
    toggleOverlay('board')
  }, [toggleOverlay])
  const onOpenBestOfN = useCallback(() => {
    setOverlay('bestOfN')
  }, [])
  const onStartBestOfN = useCallback(
    (prompt: string, attempts: number, requestCeilingPerAttempt: number) => {
      postMessage({ type: 'startBestOfN', prompt, attempts, requestCeilingPerAttempt })
    },
    [postMessage],
  )
  const onTakeBestOfNAttempt = useCallback(
    (attemptId: string) => {
      const run = store.getState().bestOfN
      if (run !== undefined) {
        postMessage({ type: 'takeBestOfNAttempt', runId: run.runId, attemptId })
      }
    },
    [postMessage, store],
  )
  const onCancelBestOfN = useCallback(() => {
    const run = store.getState().bestOfN
    if (run !== undefined) {
      postMessage({ type: 'cancelBestOfN', runId: run.runId })
    }
  }, [postMessage, store])
  const onOpenSideChat = useCallback(() => {
    const sessionId = store.getState().sessionId
    if (sessionId !== undefined) {
      postMessage({ type: 'openSideChat', sourceSessionId: sessionId })
    }
  }, [postMessage, store])
  // Plans as files (M79): the host reads the reply back; the ids only name it.
  const onSavePlan = useCallback(
    (entryId: string) => {
      const sessionId = store.getState().sessionId
      if (sessionId !== undefined) {
        postMessage({ type: 'savePlan', sourceSessionId: sessionId, itemId: entryId })
      }
    },
    [postMessage, store],
  )
  const onImplementPlan = useCallback(
    (entryId: string) => {
      const sessionId = store.getState().sessionId
      if (sessionId !== undefined) {
        postMessage({ type: 'implementPlan', sourceSessionId: sessionId, itemId: entryId })
      }
    },
    [postMessage, store],
  )
  const onOpenAgents = useCallback(() => {
    setSelectedAgentId(undefined)
    toggleOverlay('agents')
  }, [toggleOverlay])
  const onReadChild = useCallback(
    (sessionId: string) => {
      postMessage({ type: 'readChildSession', sessionId })
    },
    [postMessage],
  )
  const onControlAgent = useCallback(
    (subagentId: string, action: SubagentAction) => {
      postMessage({ type: 'subagentControl', subagentId, action })
    },
    [postMessage],
  )
  const onMessageAgent = useCallback(
    (subagentId: string, body: string, isFollowup: boolean) => {
      postMessage({ type: 'subagentMessage', subagentId, body, isFollowup })
    },
    [postMessage],
  )
  const onOpenMuseSettings = useCallback(() => {
    postMessage({ type: 'hostAction', action: 'openMuseSettings' })
  }, [postMessage])
  const onCompact = useCallback(() => {
    postMessage({ type: 'compact' })
  }, [postMessage])
  const onDismissBanner = useCallback(() => {
    dispatch({ type: 'bannerDismissed' })
  }, [dispatch])
  const onRefuseFile = useCallback(
    (name: string, reason: string) => {
      dispatch({ type: 'attachmentRefused', name, reason })
    },
    [dispatch],
  )
  const onResumeSession = useCallback(
    (sessionId: string) => {
      dispatch({ type: 'sessionChangeRequested' })
      postMessage({
        type: 'resumeSession',
        sessionId,
        attachmentEpoch: store.getState().attachmentEpoch,
      })
      closeOverlay()
    },
    [dispatch, postMessage, closeOverlay, store],
  )
  const onSetSessionArchived = useCallback(
    (sessionId: string, isArchived: boolean) => {
      postMessage({ type: 'setSessionArchived', sessionId, isArchived })
    },
    [postMessage],
  )
  const onRename = useCallback(
    (name: string) => {
      postMessage({ type: 'renameSession', name })
    },
    [postMessage],
  )
  // "Fork from here" keeps the turns before that message; before the first
  // message there is nothing to keep, so it is a new conversation.
  const onFork = useCallback(
    (entryId: string) => {
      const cut = forkCutBefore(store.getState().transcript, entryId)
      if (cut === undefined) {
        return
      }
      if (cut.type === 'fresh') {
        onNewConversation()
        return
      }
      dispatch({ type: 'sessionChangeRequested' })
      postMessage({
        type: 'forkSession',
        lastTurnId: cut.lastTurnId,
        attachmentEpoch: store.getState().attachmentEpoch,
      })
    },
    [store, onNewConversation, dispatch, postMessage],
  )
  // "Fork conversation and rewind code" (M72): one host action, so the fork
  // cannot overtake the rewind's confirmation; a fork before the first
  // message is a new conversation.
  const onForkRewind = useCallback(
    (entryId: string) => {
      const current = store.getState()
      const cut = forkCutBefore(current.transcript, entryId)
      if (cut === undefined) {
        return
      }
      const edits = [...editsAfter(current, entryId)]
      if (cut.type === 'fresh') {
        postMessage({ type: 'rewindCode', edits, fork: {} })
        return
      }
      dispatch({ type: 'sessionChangeRequested' })
      postMessage({
        type: 'rewindCode',
        edits,
        fork: { lastTurnId: cut.lastTurnId, attachmentEpoch: store.getState().attachmentEpoch },
      })
    },
    [store, dispatch, postMessage],
  )
  // "Rewind code to here": the host reverts the edits after that message,
  // newest first, and says so (or that there was nothing to revert).
  const onRewind = useCallback(
    (entryId: string) => {
      postMessage({ type: 'rewindCode', edits: [...editsAfter(store.getState(), entryId)] })
    },
    [store, postMessage],
  )
  const onRewindConversation = useCallback(
    (entryId: string) => {
      const request = rewindRequest(store.getState(), entryId)
      if (request === undefined) {
        return
      }
      dispatch({ type: 'sessionChangeRequested' })
      // The epoch the session change just raised, so no older encode lands.
      postMessage({ ...request, attachmentEpoch: store.getState().attachmentEpoch })
    },
    [store, dispatch, postMessage],
  )
  // "Restore files to here" (M72): the host confirms, restores and reports.
  const onRestoreFiles = useCallback(
    (entryId: string) => {
      const current = store.getState()
      const entry = current.transcript.find((candidate) => candidate.id === entryId)
      if (entry?.kind !== 'user' || entry.turnId === undefined || current.sessionId === undefined) {
        return
      }
      postMessage({
        type: 'restoreFiles',
        sourceSessionId: current.sessionId,
        turnId: entry.turnId,
      })
    },
    [store, postMessage],
  )
  // "Rewind conversation and restore files" (M72): the files first, then M53's rewind.
  const onRestoreBoth = useCallback(
    (entryId: string) => {
      const request = rewindRequest(store.getState(), entryId)
      if (request === undefined) {
        return
      }
      dispatch({ type: 'sessionChangeRequested' })
      postMessage({
        type: 'restoreFiles',
        sourceSessionId: request.sourceSessionId,
        turnId: request.turnId,
        rewind: { ...request, attachmentEpoch: store.getState().attachmentEpoch },
      })
    },
    [store, dispatch, postMessage],
  )
  const onRedo = useCallback(
    (entryId: string, restoreId: string) => {
      const sourceSessionId = store.getState().sessionId
      if (sourceSessionId === undefined) {
        return
      }
      dispatch({ type: 'redoRequested', entryId })
      postMessage({ type: 'redoRestore', restoreId, sourceSessionId })
    },
    [store, dispatch, postMessage],
  )
  // "Report this" on a recorded failure (M93 lane W): the row's
  // sanitized event reference opens the report workflow, never its text.
  const onReportProblem = useCallback(
    (_entryId: string, ref: ReportEventRef) => {
      postMessage({ type: 'openReport', ref })
    },
    [postMessage],
  )
  const onReportClosed = useCallback(() => {
    dispatch({ type: 'reportClosed' })
  }, [dispatch])
  // A Muse Code fault's way on (D26): the header's New conversation, or a
  // restart the host runs.
  const onNoticeAction = useCallback(
    (entryId: string, action: NoticeAction) => {
      dispatch({ type: 'noticeActionRequested', entryId })
      if (action === 'newConversation') {
        onNewConversation()
        return
      }
      postMessage({ type: 'hostAction', action })
    },
    [dispatch, onNewConversation, postMessage],
  )
  const checkpointTurnIds = useMemo(
    () =>
      new Set(
        state.checkpoints.canRestore && state.checkpoints.sessionId === state.sessionId
          ? state.checkpoints.turnIds
          : [],
      ),
    [state.checkpoints, state.sessionId],
  )
  const legacyCheckpointTurnIds = useMemo(
    () =>
      new Set(
        state.checkpoints.sessionId === state.sessionId ? state.checkpoints.legacyTurnIds : [],
      ),
    [state.checkpoints, state.sessionId],
  )
  const onRemoveAttachment = useCallback(
    (id: string) => {
      dispatch({ type: 'attachmentRemoved', id })
      postMessage({ type: 'removeAttachment', id })
    },
    [dispatch, postMessage],
  )
  const onSearchMentions = useCallback(
    (requestId: number, query: string) => {
      postMessage({ type: 'searchMentions', requestId, query })
    },
    [postMessage],
  )
  const onAttachImage = useCallback(
    (image: ImageData) => {
      const { attachmentEpoch, ...data } = image
      if (attachmentEpoch !== store.getState().attachmentEpoch) {
        return
      }
      postMessage({ type: 'attachImageData', ...data, attachmentEpoch })
    },
    [store, postMessage],
  )
  const onDroppedUris = useCallback(
    (uris: readonly string[]) => {
      postMessage({ type: 'droppedUris', uris: [...uris] })
    },
    [postMessage],
  )
  const onSelectModel = useCallback(
    (modelId: string) => {
      postMessage({ type: 'setModel', modelId })
      closeOverlay()
    },
    [postMessage, closeOverlay],
  )
  const onSelectEffort = useCallback(
    (effort: EffortLevel) => {
      postMessage({ type: 'setEffort', effort })
    },
    [postMessage],
  )
  const onSelectMode = useCallback(
    (id: string) => {
      const mode = availablePermissionModes(canBypass).find((candidate) => candidate === id)
      if (mode !== undefined) {
        postMessage({ type: 'setPermissionMode', mode })
      }
      closeOverlay()
    },
    [postMessage, canBypass, closeOverlay],
  )
  const onSelectAttach = useCallback(
    (id: string) => {
      if (id === ATTACH_UPLOAD) {
        postMessage({ type: 'pickFile' })
        setOverlay(undefined)
        return
      }
      // "Add context": start an @-mention where the caret is; the mention
      // menu opens as soon as the `@` lands. A mention token must follow
      // whitespace, so one is added after a non-blank draft.
      const { draft } = store.getState()
      const isSpaceNeeded = draft !== '' && !WHITESPACE_END.test(draft)
      dispatch({
        type: 'insertRequested',
        text: `${isSpaceNeeded ? ' ' : ''}${MENTION_TRIGGER}`,
      })
      setOverlay(undefined)
    },
    [store, dispatch, postMessage],
  )
  const onPaletteAction = useCallback(
    (action: PaletteAction) => {
      switch (action.type) {
        case 'attachFile': {
          postMessage({ type: 'pickFile' })
          closeOverlay()
          break
        }
        case 'mentionFile': {
          postMessage({ type: 'pickMentionFile' })
          closeOverlay()
          break
        }
        case 'clearConversation': {
          onNewConversation()
          closeOverlay()
          break
        }
        case 'shareChat': {
          setOverlay('chatShare')
          break
        }
        case 'promptCommand': {
          if (action.command === 'library') setOverlay('prompts')
          else sharingAction(action.command === 'use' ? 'use' : 'shareSaved')
          break
        }
        case 'openHistory': {
          openOverlay('history')
          break
        }
        case 'openUsage': {
          openOverlay('usage')
          break
        }
        case 'openHelp': {
          openOverlay('help')
          break
        }
        case 'openAgents': {
          setSelectedAgentId(undefined)
          openOverlay('agents')
          break
        }
        case 'openModelPicker': {
          setOverlay('models')
          break
        }
        case 'setEffort': {
          postMessage({ type: 'setEffort', effort: action.effort })
          break
        }
        case 'toggleThinking': {
          postMessage({ type: 'setThinking', enabled: !store.getState().isThinkingEnabled })
          break
        }
        case 'openPermissionModes': {
          setOverlay('modes')
          break
        }
        case 'toggleFocusView':
        case 'toggleCtrlEnterToSend': {
          postMessage({ type: 'hostAction', action: action.type })
          break
        }
        case 'openSettings':
        case 'openKeybindings':
        case 'openLog':
        case 'showWhatsNew': {
          postMessage({ type: 'hostAction', action: action.type })
          closeOverlay()
          break
        }
        case 'showReport': {
          closeOverlay()
          postMessage({ type: 'runReport', requestId: newLocalId(), argumentsText: '' })
          break
        }
        case 'openReport': {
          // The same dialog every entry point opens (M93): the host builds it.
          closeOverlay()
          postMessage({ type: 'openReport' })
          break
        }
        case 'signOut': {
          postMessage({ type: 'signOut' })
          closeOverlay()
          break
        }
        case 'insertSkill': {
          dispatch({ type: 'insertRequested', text: `/${action.selector} ` })
          setOverlay(undefined)
          break
        }
        case 'startGoal': {
          // The prompt becomes `/goal ` for the objective (M45).
          dispatch({ type: 'draftChanged', draft: GOAL_PROMPT_START })
          closeOverlay()
          break
        }
        case 'startLoop': {
          dispatch({ type: 'draftChanged', draft: LOOP_PROMPT_START })
          closeOverlay()
          break
        }
        case 'startHook': {
          dispatch({ type: 'draftChanged', draft: HOOK_PROMPT_START })
          closeOverlay()
          break
        }
        case 'startHandoff': {
          // The prompt becomes `/handoff ` for the goal (M74).
          dispatch({ type: 'draftChanged', draft: HANDOFF_PROMPT_START })
          closeOverlay()
          break
        }
        case 'compact': {
          postMessage({ type: 'compact' })
          closeOverlay()
          break
        }
        case 'showPlans': {
          postMessage({ type: 'showPlans' })
          closeOverlay()
          break
        }
        // Panel-opening actions, including the models view's footer rows
        // (M95): the host runs lane K's commands through host actions.
        case 'manageSkills':
        case 'importSkills':
        case 'importFromAgents':
        case 'showMcpServers':
        case 'showHooks':
        case 'showMemory':
        case 'newWorktree':
        case 'removeWorktree':
        case 'addModelProvider':
        case 'manageModels':
        case 'openPullRequestInConversation': {
          postMessage({ type: 'hostAction', action: action.type })
          closeOverlay()
          break
        }
        case 'exportConversation': {
          postMessage({ type: 'exportConversation', format: action.format })
          closeOverlay()
          break
        }
        case 'gitAction': {
          postMessage({ type: 'gitAction', action: action.action })
          closeOverlay()
          break
        }
        case 'importSession': {
          postMessage({ type: 'importSession' })
          closeOverlay()
          break
        }
        case 'openShareFile': {
          postMessage({ type: 'openShareFile' })
          closeOverlay()
          break
        }
        case 'openExternal': {
          postMessage({ type: 'openExternal', url: action.url })
          closeOverlay()
          break
        }
        case 'setPaidFeature': {
          // The host asks for the price before turning one on (D30).
          postMessage({ type: 'setPaidFeature', feature: action.feature, isOn: action.isOn })
          break
        }
        case 'startReview': {
          // The prompt becomes `/review ` for what to review (M70).
          dispatch({ type: 'draftChanged', draft: REVIEW_PROMPT_START })
          closeOverlay()
          break
        }
        case 'startLegalScan': {
          // The prompt becomes `/legal ` for a file subset (M97).
          dispatch({ type: 'draftChanged', draft: LEGAL_PROMPT_START })
          closeOverlay()
          break
        }
        case 'review': {
          onReview(action.request, reviewCommandText(action.request))
          closeOverlay()
          break
        }
        case 'openReviewPane': {
          openReviewPane()
          break
        }
        case 'none': {
          break
        }
      }
    },
    [
      store,
      dispatch,
      postMessage,
      newLocalId,
      closeOverlay,
      openOverlay,
      onNewConversation,
      onReview,
      openReviewPane,
      sharingAction,
    ],
  )

  const [paletteModule, setPaletteModule] = useState<typeof PaletteRegistryModule>()
  const [paletteFailure, setPaletteFailure] = useState(false)
  const isNeedsPalette =
    overlay === 'actions' || overlay === 'models' || state.draft.startsWith('/')
  useEffect(() => {
    if (!isNeedsPalette || paletteModule !== undefined || paletteFailure) return
    let isActive = true
    void import('../shared/paletteRegistry')
      .then((module) => {
        if (isActive) setPaletteModule(module)
      })
      .catch(() => {
        if (isActive) setPaletteFailure(true)
      })
    return () => {
      isActive = false
    }
  }, [isNeedsPalette, paletteModule, paletteFailure])
  const paletteContext = useMemo(
    () => ({
      arePromptCommandsBound: true,
      currentModel: state.model,
      models: state.models,
      effort: state.effort,
      isThinkingEnabled: state.isThinkingEnabled,
      permissionMode: state.permissionMode,
      isFocusView: state.settings?.focusView ?? false,
      useCtrlEnterToSend: state.settings?.useCtrlEnterToSend ?? false,
      usage: state.usage,
      skills: state.skills,
      backend: state.auth.backend,
      paidFeatures: state.paid.features,
      isKeyStored: state.paid.isKeyStored,
    }),
    [
      state.paid.isKeyStored,
      state.model,
      state.models,
      state.effort,
      state.isThinkingEnabled,
      state.permissionMode,
      state.settings,
      state.usage,
      state.skills,
      state.auth.backend,
      state.paid.features,
    ],
  )
  const slashLoadState = paletteModule === undefined ? 'loading' : 'ready'
  const paletteGroups = useMemo(
    () => paletteModule?.buildPalette(paletteContext) ?? [],
    [paletteModule, paletteContext],
  )
  const onOpenUsage = useCallback(() => {
    openOverlay('usage')
  }, [openOverlay])
  // The host asks for Account & usage (the Tab status menu's row, M94).
  const usageRequests = state.usageRequests
  const seenUsageRequests = useRef(usageRequests)
  useEffect(() => {
    if (usageRequests === seenUsageRequests.current) {
      return
    }
    seenUsageRequests.current = usageRequests
    openOverlay('usage')
  }, [usageRequests, openOverlay])
  const helpRequests = state.helpRequests
  const seenHelpRequests = useRef(helpRequests)
  useEffect(() => {
    if (helpRequests === seenHelpRequests.current) return
    seenHelpRequests.current = helpRequests
    openOverlay('help')
  }, [helpRequests, openOverlay])
  // The prompt's "/" menus (M38). A row chosen there takes the `/` with it,
  // unless it leaves the palette open; a skill becomes `/selector ` for its
  // arguments.
  const slashCommands = useMemo(() => slashCommandsOf(paletteGroups), [paletteGroups])
  const slashPaletteKeys = useRef<PaletteKeys>(null)
  const onPromptAction = useCallback(
    (action: PaletteAction) => {
      const start = promptStartFor(action)
      if (start !== undefined) {
        dispatch({ type: 'draftChanged', draft: start })
        dispatch({ type: 'focusRequested' })
        return
      }
      if (!KEEPS_PALETTE_OPEN.has(action.type)) {
        dispatch({ type: 'draftChanged', draft: '' })
      }
      onPaletteAction(action)
    },
    [dispatch, onPaletteAction],
  )
  const onSlashCommand = useCallback(
    (command: SlashCommand) => {
      onPromptAction(command.action)
    },
    [onPromptAction],
  )
  const onSlashMenuOpen = useCallback(() => {
    const current = store.getState()
    if (current.auth.status === 'signedIn' && current.skills === undefined) {
      postMessage({ type: 'listSkills' })
    }
  }, [store, postMessage])
  const renderSlashPalette = useCallback(
    (slot: SlashPaletteSlot) => (
      <Palette
        view="actions"
        groups={paletteGroups}
        context={paletteModule === undefined ? paletteContext : undefined}
        models={state.models}
        currentModelId={state.model?.modelId}
        onAction={onPromptAction}
        onSelectModel={onSelectModel}
        onBack={onPaletteBack}
        onClose={slot.onClose}
        isAttached
        keepFocus
        keys={slashPaletteKeys}
        onActiveRowChange={slot.onActiveRowChange}
      />
    ),
    [
      paletteGroups,
      paletteModule,
      paletteContext,
      state.models,
      state.model,
      onPromptAction,
      onSelectModel,
      onPaletteBack,
    ],
  )
  const modeEntries = useMemo(
    (): readonly MenuEntry[] =>
      availablePermissionModes(canBypass).map((mode) => ({
        id: mode,
        label: UI_TEXT.permissionModes[mode],
        detail: permissionModeDetail(mode, state.auth.backend, {
          museCode: hasMuseCodeReviewer,
          modelApi: hasModelApiReviewer,
        }),
        icon: modeIcon(mode),
        isChecked: mode === state.permissionMode,
      })),
    [canBypass, state.permissionMode, state.auth.backend, hasMuseCodeReviewer, hasModelApiReviewer],
  )
  const agents = agentsOf(state)
  // The approvals waiting, docked above the composer (D26).
  const waiting = useMemo(() => waitingApprovals(state.transcript), [state.transcript])
  // The conversation's edits added up (M87): no row until one lands.
  const tally = useMemo(() => diffTally(state.transcript), [state.transcript])
  const backgroundTasks = backgroundTasksOf(state)
  // A workflow's agents are agents too (M47): the header's pill counts them.
  const workflows = workflowsOf(state)
  const workflowAgents = workflows.flatMap((workflow) => workflow.children)
  const agentCount = agents.length + workflowAgents.length
  const runningAgentCount =
    agents.filter((agent) => agent.status === 'inProgress').length +
    workflowAgents.filter((child) => isChildRunning(child)).length
  const effortLevels =
    state.models.find((model) => model.modelId === state.model?.modelId)?.effortLevels ??
    effortLevelsFor(state.model?.modelId)
  const onStepEffort = useCallback(
    (direction: -1 | 1) => {
      if (effortLevels.length === 0) return false
      onSelectEffort(effortAt(effortLevels, effortIndex(effortLevels, state.effort) + direction))
      return true
    },
    [onSelectEffort, effortLevels, state.effort],
  )

  const isShellReady =
    state.settings !== undefined &&
    state.pendingRestore === undefined &&
    state.auth.status !== 'checking'
  // The first commit of the conversation itself (not the "Connecting…" shell):
  // a crash after it is not the restored state's doing (M25).
  useLayoutEffect(() => {
    if (isShellReady) {
      store.noteRendered()
    }
  }, [store, isShellReady])
  const isBodyGated = isGated(state)
  const hasTranscript = state.transcript.length > 0
  // Height changes that are not new rows keep the pin too (M25): the
  // composer growing, the task list appearing, a patch page arriving, a row
  // opening. The body and each of its children are watched.
  useEffect(() => {
    const body = bodyRef.current
    if (body === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      if (isPinnedRef.current) {
        body.scrollTop = body.scrollHeight
      }
    })
    observer.observe(body)
    for (const child of body.children) {
      observer.observe(child)
    }
    return () => {
      observer.disconnect()
    }
  }, [isShellReady, isBodyGated, hasTranscript])

  const title =
    state.pendingRestore === undefined && state.auth.status === 'signedIn'
      ? (state.title ?? UI_TEXT.untitledConversation)
      : UI_TEXT.untitledConversation

  if (
    state.settings === undefined ||
    state.pendingRestore !== undefined ||
    state.auth.status === 'checking'
  ) {
    // A restored panel waits for the host to confirm its conversation and account.
    return (
      <div className="app">
        <Header title={title} isFocusView={false} onNewConversation={onNewConversation} />
        <main className="body">
          <p className="hint" role="status">
            {UI_TEXT.connecting}
          </p>
        </main>
      </div>
    )
  }

  const isRunning = state.activeTurnId !== undefined
  const signInGate = GATED_STATUSES.has(state.auth.status) ? (
    <SignIn
      key={state.auth.status}
      status={state.auth.status}
      detail={state.auth.detail}
      methods={state.auth.methods}
      verificationUrl={state.auth.verificationUrl}
      userCode={state.auth.userCode}
      installCommand={state.auth.installCommand}
      withTranscript={hasTranscript}
      onSignIn={onSignIn}
      onInstall={() => {
        postMessage({ type: 'installMuseCode' })
      }}
      onInstallConfirmationChange={setIsInstallConfirmOpen}
      onCancelSignIn={() => {
        postMessage({ type: 'cancelSignIn' })
      }}
      onRetry={onRetry}
      onOpenExternal={onOpenExternal}
    />
  ) : null
  const canOpenSideChat =
    state.sessionId !== undefined &&
    state.canEditSessions &&
    !state.isSideChat &&
    state.transcript.some(
      (entry) =>
        entry.kind === 'user' && entry.turnId !== undefined && entry.turnId !== state.activeTurnId,
    )
  let body
  if (isBodyGated) {
    body = signInGate
  } else if (hasTranscript) {
    body = (
      <>
        {signInGate}
        <Transcript
          entries={state.transcript}
          activeTurnId={state.activeTurnId}
          isRunning={isRunning}
          isFocusView={state.settings.focusView}
          outputPages={state.outputPages}
          toolImages={state.toolImages}
          onReadImage={onReadImage}
          onOpenLink={onOpenExternal}
          onCopy={onCopy}
          // Imported history (M84) is someone else's file: Copy only, as in a share file.
          onSavePrompt={state.isImported ? undefined : savePrompt}
          onSharePrompt={state.isImported ? undefined : sharePrompt}
          onInsert={state.isImported ? undefined : onInsert}
          onReadOutput={onReadOutput}
          onOpenOutput={onOpenOutput}
          onAnswer={onAnswer}
          onCancelQuestion={onCancelQuestion}
          onClarifyQuestion={onClarifyQuestion}
          onAcceptElicitation={onAcceptElicitation}
          onDeclineElicitation={onDeclineElicitation}
          onCancelElicitation={onCancelElicitation}
          onMoveToBackground={onMoveToBackground}
          onStopTask={onStopTask}
          canStopUserShell={state.auth.backend === 'modelApi'}
          onApply={state.isImported ? undefined : onApply}
          onOpenEditDiff={onOpenEditDiff}
          // Imported history (M84) is someone else's: nothing in it writes the workspace.
          onRevertEdit={
            state.isImported || state.sessionId === undefined ? undefined : onRevertEdit
          }
          onOpenFile={onOpenFile}
          onRefuseLink={onRefuseLink}
          onFork={state.sessionId === undefined || !state.canEditSessions ? undefined : onFork}
          onForkRewind={
            state.sessionId === undefined || !state.canEditSessions ? undefined : onForkRewind
          }
          onRewind={state.sessionId === undefined ? undefined : onRewind}
          onRewindConversation={
            state.sessionId === undefined || !state.canEditSessions
              ? undefined
              : onRewindConversation
          }
          checkpointTurnIds={checkpointTurnIds}
          legacyCheckpointTurnIds={legacyCheckpointTurnIds}
          onRestoreFiles={state.sessionId === undefined ? undefined : onRestoreFiles}
          onRestoreBoth={
            state.sessionId === undefined || !state.canEditSessions ? undefined : onRestoreBoth
          }
          onRedo={state.checkpoints.canRestore ? onRedo : undefined}
          onNoticeAction={onNoticeAction}
          onReportProblem={onReportProblem}
          restoreNote={restoreNoteOf(state)}
          conversationNote={
            state.sessionId !== undefined && !state.canEditSessions
              ? UI_TEXT.conversationRewindUnavailable
              : undefined
          }
          onReply={onReply}
          showReplyUsage={state.settings.modelApiReplyUsage}
          planReplyId={planReplyIdOf(state)}
          onSavePlan={onSavePlan}
          onImplementPlan={state.isSideChat ? undefined : onImplementPlan}
          quoteMenuEntryId={quoteMenu?.entryId}
          quoteMenuOrigin={quoteMenu?.origin}
          onQuote={onQuote}
          onCopyQuote={onCopyQuote}
          onCloseQuoteMenu={onCloseQuoteMenu}
          teamActions={teamActions}
          onEditQueued={onEditQueued}
          // A Model API steer waits for the next request; Muse Code's reaches the turn at once.
          canEditSteered={state.auth.backend === 'modelApi'}
        />
      </>
    )
  } else {
    body = (
      <EmptyState
        hint={state.emptyStateHint}
        isOnboardingShown={!state.settings.hideOnboarding}
        onHideOnboarding={onHideOnboarding}
      />
    )
  }
  const editorContext = visibleEditorContext(state)

  let floating
  switch (overlay) {
    case 'actions':
    case 'models': {
      floating = (
        <Palette
          key={overlay}
          view={overlay}
          groups={paletteGroups}
          context={paletteModule === undefined ? paletteContext : undefined}
          models={state.models}
          currentModelId={state.model?.modelId}
          onAction={onPaletteAction}
          onSelectModel={onSelectModel}
          onBack={onPaletteBack}
          onClose={closeOverlay}
        />
      )
      break
    }
    case 'modes': {
      floating = (
        <PopoverMenu
          label={UI_TEXT.modesLabel}
          title={UI_TEXT.modesTitle}
          hint={modesHint()}
          entries={modeEntries}
          align="right"
          footer={
            effortLevels.length === 0 ? undefined : (
              <div className="effort-row">
                <span className="effort-row-label">
                  {UI_TEXT.effortItem} ({effortLabel(state.effort)})
                </span>
                <EffortSlider
                  levels={effortLevels}
                  current={state.effort}
                  onSelect={onSelectEffort}
                />
              </div>
            )
          }
          onSelect={onSelectMode}
          onStep={onStepEffort}
          onClose={closeOverlay}
        />
      )
      break
    }
    case 'attach': {
      floating = (
        <PopoverMenu
          label={UI_TEXT.attachMenuLabel}
          entries={attachEntries()}
          align="left"
          onSelect={onSelectAttach}
          onClose={closeOverlay}
        />
      )
      break
    }
    case 'history':
    case 'help':
    case 'usage':
    case 'agents':
    case 'review':
    case undefined: {
      // History hangs from the header; usage, the Agent map and the review pane are modals.
      floating = null
      break
    }
  }
  const reviewPane =
    overlay === 'review' && state.reviewPane !== undefined ? (
      <ReviewPane
        pane={state.reviewPane}
        hunks={state.reviewHunks}
        isRunning={isRunning}
        onAccept={onReviewAccept}
        onRevert={onReviewRevert}
        onOpenFile={onOpenFile}
        onComment={onReviewComment}
        onClose={closeOverlay}
      />
    ) : null
  const agentMap =
    overlay === 'agents' ? (
      <AgentMap
        backend={state.auth.backend}
        title={title}
        modelId={state.model?.modelId}
        contextUsedTokens={state.context?.usedTokens}
        agents={agents}
        backgroundTasks={backgroundTasks}
        delegationMode={state.usageReport?.account?.delegationMode}
        isDelegationEnabled={state.usageReport?.account?.delegationMode === MUSE_DELEGATION_ENABLED}
        childTranscripts={state.childTranscripts}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onReadChild={onReadChild}
        onControl={onControlAgent}
        onMessage={onMessageAgent}
        onStopTask={onStopTask}
        onStopAllTasks={onStopAllTasks}
        onOpenMuseSettings={onOpenMuseSettings}
        onClose={closeOverlay}
        workflows={workflows}
        workflowTriggerMode={state.usageReport?.account?.workflowTriggerMode}
        team={state.teamTree}
        teamActions={teamTreeActions}
      />
    ) : null
  const history =
    overlay === 'history' ? (
      <HistoryDialog
        onSavePrompt={(sessionId) => {
          sharingAction('saveHistory', { sessionId })
        }}
        sessions={state.sessions}
        openQuestionCounts={state.openQuestionCounts}
        archivedIds={state.archivedIds}
        currentSessionId={state.sessionId}
        archiveAfterDays={state.settings.archiveInactiveSessions}
        now={now}
        onResume={onResumeSession}
        onSetArchived={onSetSessionArchived}
        onClose={closeOverlay}
      />
    ) : null
  const board =
    overlay === 'board' ? (
      <SessionBoardDialog
        rows={state.board}
        currentSessionId={state.sessionId}
        onResume={(sessionId, backend) => {
          postMessage({ type: 'activateBoardSession', sessionId, backend })
          closeOverlay()
        }}
        onStartBestOfN={onOpenBestOfN}
        onClose={closeOverlay}
      />
    ) : null
  const bestOfN =
    overlay === 'bestOfN' ? (
      <BestOfNDialog
        run={state.bestOfN}
        isPaidOn={state.paid.features.includes('bestOfN')}
        defaultPrompt={state.draft}
        onStart={onStartBestOfN}
        onTake={onTakeBestOfNAttempt}
        onOpen={(attemptId) => {
          if (state.bestOfN !== undefined)
            postMessage({ type: 'openBestOfNAttempt', runId: state.bestOfN.runId, attemptId })
        }}
        onCancelRun={onCancelBestOfN}
        onClose={closeOverlay}
      />
    ) : null
  const usageDialog =
    overlay === 'usage' ? (
      <UsageDialog
        state={state}
        postMessage={postMessage}
        onSetupSignIn={onSignIn}
        reportAction={
          <UsageReportAction
            onUsageReport={() => {
              closeOverlay()
              postMessage({ type: 'runReport', requestId: newLocalId(), argumentsText: 'usage' })
            }}
          />
        }
        now={now}
        onOpenExternal={onOpenExternal}
        onClose={closeOverlay}
      />
    ) : null
  // One modal at a time (M74): a brief that arrives while Usage, the Agent
  // map, review pane, a share file or the install confirmation is open waits for it to close, then
  // opens, so its Start is never reachable under a dialog that hides it.
  const isOtherModalOpen =
    overlay === 'prompts' ||
    overlay === 'chatShare' ||
    overlay === 'help' ||
    overlay === 'usage' ||
    overlay === 'agents' ||
    overlay === 'bestOfN' ||
    reviewPane !== null ||
    isInstallConfirmOpen ||
    state.share !== undefined
  // The legal report opens over the transcript when its scan answers, like
  // the handoff brief: it waits while another modal owns the panel (M74),
  // and closes with Escape, the × button or the backdrop (M97 lane W).
  const legalReport =
    isOtherModalOpen ||
    state.report !== undefined ||
    state.secretPrompt !== undefined ||
    state.legalReport === undefined ? null : (
      <LegalReport
        key={state.legalReport.requestId}
        result={state.legalReport.result}
        preview={state.legalFixPreview}
        fixResult={state.legalFixResult}
        permissionMode={state.permissionMode}
        onRequestFix={onRequestLegalFix}
        onConfirm={onConfirmLegalFix}
        onExplain={() => {
          postMessage({ type: 'requestLegalExplanation' })
        }}
        onExport={() => {
          postMessage({ type: 'exportLegalReport' })
        }}
        onRescan={onRescanLegal}
        onOpenFile={onOpenFile}
        onClose={onCloseLegalReport}
      />
    )
  // The report dialog (M93) keeps the same policy: it waits for those, and a
  // brief that arrives while it is open waits for it in turn, so two modals
  // never share the panel and the open one keeps focus.
  const handoffDialog =
    isOtherModalOpen ||
    legalReport !== null ||
    state.report !== undefined ||
    state.handoff === undefined ? null : (
      <HandoffDialog
        goal={state.handoff.goal}
        todos={state.handoff.todos}
        draft={state.handoff.draft}
        isConfirming={state.handoff.isConfirming}
        onChange={onHandoffChanged}
        onConfirm={onHandoffConfirm}
        onCancel={onHandoffCancel}
        onClose={onHandoffCancel}
      />
    )
  // The report-a-problem preview (M93 lane W): the sealed draft the host
  // built, shown byte-identical, one modal at a time (above), and over the
  // crash screen too (main.tsx renders the same host there, so a render
  // failure keeps its way on). Keyed by the host's session: a new dialog
  // starts its own count of choices.
  const reportDialog =
    isOtherModalOpen || state.report === undefined ? null : (
      <DeferredReportDialog
        key={state.report.session}
        report={state.report}
        postMessage={postMessage}
        onClose={onReportClosed}
      />
    )
  // M92e: the secret dialog waits behind any other modal (as the handoff
  // dialog does), and holds the composer inert while it shows; it and the
  // report dialog never share the panel either (M93).
  const secretPromptDialog =
    isOtherModalOpen || state.report !== undefined || state.secretPrompt === undefined ? null : (
      <SecretPromptDialog
        redactedText={state.secretPrompt.redactedText}
        onSendAnyway={onSecretPromptSendAnyway}
        onEdit={onSecretPromptDismiss}
        onClose={onSecretPromptDismiss}
      />
    )
  // Behind a modal nothing takes focus or clicks (M25): the modal traps Tab,
  // the rest of the panel is inert.
  const isPlanDialogOpen = hasPlan && (isPlanModalOpen ?? true)
  const isModalOpen =
    isOtherModalOpen ||
    legalReport !== null ||
    state.handoff !== undefined ||
    state.secretPrompt !== undefined ||
    state.report !== undefined ||
    isPlanDialogOpen

  return (
    <QuestionSurface
      sessionId={state.sessionId}
      navigation={state.questionNavigation}
      onDismiss={onDismissQuestion}
    >
      <div className="app">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {state.announcement === undefined ? null : (
            <span key={state.announcement.sequence}>{state.announcement.text}</span>
          )}
        </div>
        <div className="header-area" inert={isModalOpen}>
          <Header
            title={title}
            isFocusView={state.settings.focusView}
            isSideChat={state.isSideChat}
            onNewConversation={onNewConversation}
            onOpenHistory={onOpenHistory}
            onOpenBoard={onOpenBoard}
            onRename={
              state.sessionId === undefined || !state.canEditSessions ? undefined : onRename
            }
            agentCount={agentCount}
            runningAgentCount={runningAgentCount}
            runningTaskCount={backgroundTasks.filter((task) => isRunningTask(task)).length}
            teamTaskCount={state.teamTree === undefined ? 0 : teamTaskCount(state.teamTree)}
            runningTeamTaskCount={
              state.teamTree === undefined ? 0 : teamRunningTaskCount(state.teamTree)
            }
            onOpenAgents={onOpenAgents}
            onOpenSideChat={canOpenSideChat ? onOpenSideChat : undefined}
          />
          {history}
          {board}
        </div>
        <>
          {overlay === 'help' ? (
            <ReferencePage
              postMessage={postMessage}
              values={state.referenceValues}
              settings={state.settings}
              onClose={closeOverlay}
            />
          ) : null}
          {overlay === 'prompts' ? (
            <PromptLibraryBridge post={postMessage} onClose={closeOverlay} />
          ) : null}
          {overlay === 'chatShare' ? (
            <ChatShareBridge key={state.sessionId} post={postMessage} onClose={closeOverlay} />
          ) : null}
          {usageDialog}
          {agentMap}
          {reviewPane}
          {bestOfN}
        </>
        {handoffDialog}
        {secretPromptDialog}
        {reportDialog}
        {legalReport}
        <Suspense fallback={null}>
          {hasPlan ? (
            <PlanUi
              surface="dialog"
              state={state}
              providerId={selectedProvider}
              isOtherModalOpen={
                isOtherModalOpen ||
                state.report !== undefined ||
                state.secretPrompt !== undefined ||
                state.handoff !== undefined
              }
              onModalChange={setPlanModalOpen}
              onChooseModel={onOpenModelPicker}
              store={store}
              postMessage={postMessage}
              port={planNoticePort}
            />
          ) : null}
        </Suspense>
        {state.share === undefined ? null : (
          <>
            <ShareView
              title={state.share.title}
              exportedAt={state.share.exportedAt}
              sourceBackend={state.share.sourceBackend}
              modelId={state.share.modelId}
              redacted={state.share.redacted}
              items={state.share.items}
              onClose={onCloseShare}
              onOpenLink={onOpenExternal}
              onCopy={onCopy}
              onSectionError={onShareSectionError}
            />
          </>
        )}
        <main
          ref={bodyRef}
          className={hasTranscript ? 'body body-transcript' : 'body'}
          inert={isModalOpen}
          onScroll={onBodyScroll}
          onContextMenu={onTranscriptContextMenu}
        >
          {body}
          {hasNewBelow ? (
            <button
              type="button"
              className="jump-latest"
              title={UI_TEXT.jumpToLatestTitle}
              onClick={scrollToEnd}
            >
              <ExpandChevron isOpen />
              {UI_TEXT.jumpToLatest}
            </button>
          ) : null}
        </main>
        {/* Review opens M70's pane on the same edits (D66 item 10). */}
        <DiffTally counts={tally} onReview={openReviewPane} />
        {state.git.form === undefined &&
        state.git.state.worktree === undefined &&
        state.git.state.pullRequest === undefined &&
        state.git.state.hold === undefined ? null : (
          <>
            <GitPanel
              git={state.git}
              isInert={isModalOpen}
              canGenerate={state.auth.status === 'signedIn' && state.activeTurnId === undefined}
              onAction={onGitAction}
              onEdit={onGitEdit}
              onClose={onGitClose}
              onCommit={onGitCommit}
              onCreatePullRequest={onGitCreatePullRequest}
              onGenerate={onGitGenerate}
              onOpenLink={onOpenExternal}
            />
          </>
        )}
        {state.goal === undefined ? null : (
          <GoalPanel
            key={state.sessionId}
            goal={state.goal}
            isInert={isModalOpen}
            onCommand={onGoalCommand}
            editor={{
              draft: state.goalEdit?.draft,
              isPending: state.goalEdit?.pending !== undefined,
              onStart: onGoalEditStarted,
              onChange: onGoalEditChanged,
              onCancel: onGoalEditCanceled,
              onSave: onGoalEditSaved,
            }}
          />
        )}
        {state.schedules.length === 0 ? null : (
          <SchedulePanel
            jobs={state.schedules}
            nowMs={now()}
            isPaidOn={state.paid.features.includes('scheduledPrompts')}
            isInert={isModalOpen}
            onRun={onScheduleRun}
            onCancel={onScheduleCancel}
            onEnable={onScheduleEnable}
          />
        )}
        <TodoPanel items={state.todos} isInert={isModalOpen} onOpenInTab={onOpenTasksTab} />
        {isBodyGated ? null : (
          <AttentionDock
            waiting={waiting}
            onDecide={onDecide}
            isInert={isModalOpen}
            questionGroup={{
              questions: questionsInOrder(state),
              elicitations: state.transcript.flatMap((entry) =>
                entry.kind === 'tool' && entry.elicitation !== undefined ? [entry.elicitation] : [],
              ),
              onAnswer,
              onCancel: onCancelQuestion,
              onClarify: onClarifyQuestion,
              onAcceptElicitation,
              onDeclineElicitation,
              onCancelElicitation,
              onJump: onJumpQuestion,
            }}
          />
        )}
        <div className="composer-area" inert={isModalOpen}>
          {floating}
          {isBodyGated || state.setupComplete === undefined ? null : (
            <Suspense fallback={null}>
              <SetupBanner
                provider={state.setupComplete.provider}
                model={state.setupComplete.model}
                onManageProviders={() => {
                  postMessage({ type: 'hostAction', action: 'manageModels' })
                }}
                onDismiss={() => {
                  dispatch({ type: 'setupCompleteDismissed' })
                }}
              />
            </Suspense>
          )}
          <JudgeStatusLine status={state.judge} />
          {hasPlan && selectedProvider === 'copilot' ? (
            <Suspense fallback={null}>
              <PlanUi surface="note" onOpenExternal={onOpenExternal} />
            </Suspense>
          ) : null}
          <Composer
            onSavePrompt={savePrompt}
            onSharePrompt={sharePrompt}
            onUseSavedPrompt={() => {
              sharingAction('use')
            }}
            draft={state.draft}
            placeholder={state.composerPlaceholder}
            settings={state.settings}
            canSend={canSend(state)}
            isRunning={isRunning}
            modelLabel={modelLabelFor(state)}
            planMark={
              hasPlan ? (
                <Suspense fallback={null}>
                  <PlanUi
                    surface="mark"
                    model={selectedModel}
                    providerId={selectedProvider}
                    onOpenExternal={onOpenExternal}
                  />
                </Suspense>
              ) : undefined
            }
            permissionMode={state.permissionMode}
            context={state.context}
            paidBadge={paidBadgeFor(state)}
            onOpenUsage={onOpenUsage}
            focusRequests={state.focusRequests}
            pendingInsert={state.pendingInsert}
            attachments={state.attachments}
            attachmentEpoch={state.attachmentEpoch}
            attachmentSettlements={state.attachmentSettlements}
            newAttachmentRequestId={() =>
              `attachment:${newLocalId()}:${String(++nextAttachmentRequestId.current)}`
            }
            mentionResults={state.mentionResults}
            editorContextLabel={
              editorContext === undefined ? undefined : editorContextLabel(editorContext)
            }
            dictation={state.dictation}
            now={now}
            referenceLabel={
              state.reference === undefined ? undefined : referenceLabel(state.reference)
            }
            onDismissReference={onDismissReference}
            onDictation={onDictation}
            onDismissEditorContext={onDismissEditorContext}
            onDraftChange={onDraftChange}
            onInsertApplied={onInsertApplied}
            onSubmit={onSubmit}
            onStop={onStop}
            onFocusChange={onFocusChange}
            onOpenPalette={onOpenPalette}
            onOpenModelPicker={onOpenModelPicker}
            onCyclePermissionMode={state.isSideChat ? undefined : onCyclePermissionMode}
            onOpenModeMenu={state.isSideChat ? undefined : onOpenModeMenu}
            onOpenAttachMenu={onOpenAttachMenu}
            onRemoveAttachment={onRemoveAttachment}
            onSearchMentions={onSearchMentions}
            onAttachImage={onAttachImage}
            onRefuseFile={onRefuseFile}
            onDroppedUris={onDroppedUris}
            onCompact={onCompact}
            banner={state.banner}
            onDismissBanner={onDismissBanner}
            slashCommands={slashCommands}
            slashLoadState={paletteFailure ? 'failed' : slashLoadState}
            isMenuOpen={overlay !== undefined}
            renderSlashPalette={renderSlashPalette}
            slashPaletteKeys={slashPaletteKeys}
            onSlashCommand={onSlashCommand}
            onSlashMenuOpen={onSlashMenuOpen}
          />
        </div>
      </div>
    </QuestionSurface>
  )
}
