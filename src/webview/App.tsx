import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { QuestionAnswer } from '../shared/agentEvents'
import {
  type CheckpointAvailability,
  type DictationAction,
  type EffortLevel,
  GOAL_SLASH_COMMAND,
  HANDOFF_SLASH_COMMAND,
  LOOP_SLASH_COMMAND,
  type GoalCommandVerb,
  MUSE_DELEGATION_ENABLED,
  REVIEW_SLASH_COMMAND,
  SETTING_DEFAULTS,
  type SubagentAction,
  UI_TEXT,
} from '../shared/constants'
import {
  parseReviewPrompt,
  reviewCommandText,
  type ReviewRequest,
  reviewRequestSchema,
} from '../shared/reviewCommand'
import { editorContextLabel } from '../shared/editorContext'
import { effortAt, effortIndex, effortLabel, effortLevelsFor } from '../shared/effort'
import { parseGoalPrompt, requiresObjective } from '../shared/goalCommand'
import { parseHandoffPrompt } from '../shared/handoff'
import { parseLoopPrompt } from '../core/backends/modelapi/schedules'
import { fill, templateParts } from '../shared/l10n/text'
import {
  availablePermissionModes,
  nextPermissionMode,
  permissionModeDetail,
} from '../shared/permissionModes'
import { paidFeatureName, paidFeaturePrice, usablePaidFeatures } from '../shared/paid'
import { buildPalette, type PaletteAction } from '../shared/palette'
import { type SlashCommand, slashCommandsOf } from '../shared/slashCommands'
import type {
  ChatReference,
  LineRange,
  NoticeAction,
  ReportEventRef,
  ReviewFile,
  SignInMethod,
  WebviewToHostMessage,
} from '../shared/protocol'
import type { ApprovalDecisionInput } from './components/ApprovalCard'
import { AgentMap } from './components/AgentMap'
import { ApprovalDock } from './components/ApprovalDock'
import { Composer, type ImageData, type SlashPaletteSlot } from './components/Composer'
import { DiffTally } from './components/DiffTally'
import { EffortSlider } from './components/EffortSlider'
import { EmptyState } from './components/EmptyState'
import { GoalPanel } from './components/GoalPanel'
import { SchedulePanel } from './components/SchedulePanel'
import { Header } from './components/Header'
import { HistoryDialog } from './components/HistoryDialog'
import { ReviewPane } from './components/ReviewPane'
import { SessionBoardDialog } from './components/SessionBoardDialog'
import { BestOfNDialog } from './components/BestOfNDialog'
import { UsageDialog } from './components/UsageDialog'
import { HandoffDialog } from './components/HandoffDialog'
import { ReportDialogHost } from './components/ReportDialog'
import { ShareView } from './components/ShareView'
import { AddContextIcon, ExpandChevron, UploadIcon } from './components/icons'
import { modeIcon } from './components/modeIcons'
import { Palette, type PaletteKeys, type PaletteView } from './components/Palette'
import { type MenuEntry, PopoverMenu } from './components/PopoverMenu'
import { SignIn } from './components/SignIn'
import { TodoPanel } from './components/TodoPanel'
import { type QueuedCardRef, Transcript } from './components/Transcript'
import { diffTally } from './diffTally'
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
  workflowsOf,
} from './state/uiState'
import { isChildRunning } from './workflowDetails'
import type { QuoteIntent } from './components/QuoteMenu'

export interface AppProps {
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

/** What floats above the composer: a palette view, a menu, the History dialog or a modal. */
type Overlay =
  PaletteView | 'modes' | 'attach' | 'history' | 'board' | 'bestOfN' | 'usage' | 'agents' | 'review'

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
// What choosing `/review` leaves: the command, ready for what to review (M70).
const REVIEW_PROMPT_START = `/${REVIEW_SLASH_COMMAND} `
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
  return `${state.model.modelId} ${effort}`
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
    case 'startReview': {
      return REVIEW_PROMPT_START
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
}: AppProps) {
  // Callbacks read the store's current state when they run instead of
  // closing over it, so they keep their identity across renders and the
  // memoised transcript rows skip a keystroke or a delta elsewhere (M25).
  const [store] = useState(() => externalStore ?? createUiStore(initialUiState))
  const [isOwnStore] = useState(externalStore === undefined)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const { dispatch } = store
  const [chosenOverlay, setOverlay] = useState<Overlay | undefined>(undefined)
  // The review pane's changes go with their conversation (a clear, another
  // session), and the pane goes with them (M70).
  const overlay =
    chosenOverlay === 'review' && state.reviewPane === undefined ? undefined : chosenOverlay
  const [isInstallConfirmOpen, setIsInstallConfirmOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined)
  const canBypass = state.settings?.allowDangerouslySkipPermissions ?? false
  // The Auto reviewer on Muse Code (M90), as its setting says.
  const hasMuseCodeReviewer =
    state.settings?.museCodeAutoReviewer ?? SETTING_DEFAULTS.museCodeAutoReviewer

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
  const onSubmit = useCallback(() => {
    const current = store.getState()
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
  }, [store, dispatch, newLocalId, now, postMessage, onGoalCommand, onReview, onHandoff])
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
  // Both lock the card until the host settles the question (M25).
  const onAnswer = useCallback(
    (userInputId: string, answers: readonly QuestionAnswer[]) => {
      dispatch({ type: 'questionSubmitted', userInputId })
      postMessage({ type: 'answerQuestion', userInputId, answers: [...answers] })
    },
    [dispatch, postMessage],
  )
  const onCancelQuestion = useCallback(
    (userInputId: string) => {
      dispatch({ type: 'questionSubmitted', userInputId })
      postMessage({ type: 'cancelQuestion', userInputId })
    },
    [dispatch, postMessage],
  )
  const onClarifyQuestion = useCallback(
    (userInputId: string, text: string) => {
      dispatch({ type: 'questionSubmitted', userInputId })
      postMessage({ type: 'clarifyQuestion', userInputId, text })
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
        case 'openHistory': {
          openOverlay('history')
          break
        }
        case 'openUsage': {
          openOverlay('usage')
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
        case 'openLog': {
          postMessage({ type: 'hostAction', action: action.type })
          closeOverlay()
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
        case 'manageSkills':
        case 'importSkills':
        case 'importFromAgents':
        case 'showMcpServers':
        case 'showHooks':
        case 'showMemory':
        case 'newWorktree':
        case 'removeWorktree': {
          postMessage({ type: 'hostAction', action: action.type })
          closeOverlay()
          break
        }
        case 'exportConversation': {
          postMessage({ type: 'exportConversation', format: action.format })
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
      closeOverlay,
      openOverlay,
      onNewConversation,
      onReview,
      openReviewPane,
    ],
  )

  const paletteGroups = useMemo(
    () =>
      buildPalette({
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
  const onOpenUsage = useCallback(() => {
    openOverlay('usage')
  }, [openOverlay])
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
    if (store.getState().skills === undefined) {
      postMessage({ type: 'listSkills' })
    }
  }, [store, postMessage])
  const renderSlashPalette = useCallback(
    (slot: SlashPaletteSlot) => (
      <Palette
        view="actions"
        groups={paletteGroups}
        models={state.models}
        currentModelId={state.model?.modelId}
        onAction={onPromptAction}
        onSelectModel={onSelectModel}
        onBack={onPaletteBack}
        onClose={slot.onClose}
        isAttached
        keys={slashPaletteKeys}
        onActiveRowChange={slot.onActiveRowChange}
      />
    ),
    [paletteGroups, state.models, state.model, onPromptAction, onSelectModel, onPaletteBack],
  )
  const modeEntries = useMemo(
    (): readonly MenuEntry[] =>
      availablePermissionModes(canBypass).map((mode) => ({
        id: mode,
        label: UI_TEXT.permissionModes[mode],
        detail: permissionModeDetail(mode, state.auth.backend, hasMuseCodeReviewer),
        icon: modeIcon(mode),
        isChecked: mode === state.permissionMode,
      })),
    [canBypass, state.permissionMode, state.auth.backend, hasMuseCodeReviewer],
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
  const effortLevels = effortLevelsFor(state.model?.modelId)
  const onStepEffort = useCallback(
    (direction: -1 | 1) => {
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
          onInsert={state.isImported ? undefined : onInsert}
          onReadOutput={onReadOutput}
          onOpenOutput={onOpenOutput}
          onAnswer={onAnswer}
          onCancelQuestion={onCancelQuestion}
          onClarifyQuestion={onClarifyQuestion}
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
      />
    ) : null
  const history =
    overlay === 'history' ? (
      <HistoryDialog
        sessions={state.sessions}
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
        auth={state.auth}
        onInstallMuseCode={() => {
          postMessage({ type: 'installMuseCode' })
        }}
        onSetupSignIn={(method) => {
          closeOverlay()
          onSignIn(method)
        }}
        onForgetPaidUse={() => {
          postMessage({ type: 'forgetPaidUse' })
        }}
        report={state.usageReport}
        usage={state.usage}
        context={state.context}
        modelId={state.model?.modelId}
        paid={state.paid}
        now={now}
        onOpenExternal={onOpenExternal}
        onClose={closeOverlay}
      />
    ) : null
  // One modal at a time (M74): a brief that arrives while Usage, the Agent
  // map, review pane, a share file or the install confirmation is open waits for it to close, then
  // opens, so its Start is never reachable under a dialog that hides it.
  const isOtherModalOpen =
    overlay === 'usage' ||
    overlay === 'agents' ||
    reviewPane !== null ||
    isInstallConfirmOpen ||
    state.share !== undefined
  // The report dialog (M93) keeps the same policy: it waits for those, and a
  // brief that arrives while it is open waits for it in turn, so two modals
  // never share the panel and the open one keeps focus.
  const handoffDialog =
    isOtherModalOpen || state.report !== undefined || state.handoff === undefined ? null : (
      <HandoffDialog
        goal={state.handoff.goal}
        todos={state.handoff.todos}
        draft={state.handoff.draft}
        isConfirming={state.handoff.isConfirming}
        onChange={onHandoffChanged}
        onConfirm={onHandoffConfirm}
        onCancel={onHandoffCancel}
      />
    )
  // The report-a-problem preview (M93 lane W): the sealed draft the host
  // built, shown byte-identical, one modal at a time (above), and over the
  // crash screen too (main.tsx renders the same host there, so a render
  // failure keeps its way on). Keyed by the host's session: a new dialog
  // starts its own count of choices.
  const reportDialog =
    isOtherModalOpen || state.report === undefined ? null : (
      <ReportDialogHost
        key={state.report.session}
        report={state.report}
        postMessage={postMessage}
        onClose={onReportClosed}
      />
    )
  // Behind a modal nothing takes focus or clicks (M25): the modal traps Tab,
  // the rest of the panel is inert.
  const isModalOpen = isOtherModalOpen || state.handoff !== undefined || state.report !== undefined

  return (
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
          onRename={state.sessionId === undefined || !state.canEditSessions ? undefined : onRename}
          agentCount={agentCount}
          runningAgentCount={runningAgentCount}
          runningTaskCount={backgroundTasks.filter((task) => isRunningTask(task)).length}
          onOpenAgents={onOpenAgents}
          onOpenSideChat={canOpenSideChat ? onOpenSideChat : undefined}
        />
        {history}
        {board}
        {bestOfN}
      </div>
      {usageDialog}
      {handoffDialog}
      {reportDialog}
      {agentMap}
      {reviewPane}
      {state.share === undefined ? null : (
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
      {/* Review waits for M70's review pane (PR #69), which main does not have yet (D66). */}
      {/* Review opens M70's pane on the same edits (D66 item 10). */}
      <DiffTally counts={tally} onReview={openReviewPane} />
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
      <SchedulePanel
        jobs={state.schedules}
        nowMs={now()}
        isPaidOn={state.paid.features.includes('scheduledPrompts')}
        isInert={isModalOpen}
        onRun={onScheduleRun}
        onCancel={onScheduleCancel}
        onEnable={onScheduleEnable}
      />
      <TodoPanel items={state.todos} isInert={isModalOpen} onOpenInTab={onOpenTasksTab} />
      {isBodyGated ? null : (
        <ApprovalDock waiting={waiting} onDecide={onDecide} isInert={isModalOpen} />
      )}
      <div className="composer-area" inert={isModalOpen}>
        {floating}
        <Composer
          draft={state.draft}
          placeholder={state.composerPlaceholder}
          settings={state.settings}
          canSend={canSend(state)}
          isRunning={isRunning}
          modelLabel={modelLabelFor(state)}
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
          isMenuOpen={overlay !== undefined}
          renderSlashPalette={renderSlashPalette}
          slashPaletteKeys={slashPaletteKeys}
          onSlashCommand={onSlashCommand}
          onSlashMenuOpen={onSlashMenuOpen}
        />
      </div>
    </div>
  )
}
