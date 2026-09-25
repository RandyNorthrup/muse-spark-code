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
  type DictationAction,
  type EffortLevel,
  MUSE_DELEGATION_ENABLED,
  type SubagentAction,
  UI_TEXT,
} from '../shared/constants'
import { editorContextLabel } from '../shared/editorContext'
import { effortAt, effortIndex, effortLabel, effortLevelsFor } from '../shared/effort'
import { fill, formatPercent, templateParts } from '../shared/l10n/text'
import {
  availablePermissionModes,
  nextPermissionMode,
  permissionModeDetail,
} from '../shared/permissionModes'
import { buildPalette, formatTokenWindow, type PaletteAction } from '../shared/palette'
import { type SlashCommand, slashCommandsOf } from '../shared/slashCommands'
import type { LineRange, SignInMethod, WebviewToHostMessage } from '../shared/protocol'
import type { ApprovalDecisionInput } from './components/ApprovalCard'
import { AgentMap } from './components/AgentMap'
import { Composer, type ImageData, type SlashPaletteSlot } from './components/Composer'
import { EffortSlider } from './components/EffortSlider'
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { HistoryDialog } from './components/HistoryDialog'
import { UsageDialog } from './components/UsageDialog'
import { AddContextIcon, ExpandChevron, UploadIcon } from './components/icons'
import { modeIcon } from './components/modeIcons'
import { Palette, type PaletteKeys, type PaletteView } from './components/Palette'
import { type MenuEntry, PopoverMenu } from './components/PopoverMenu'
import { SignIn } from './components/SignIn'
import { TodoPanel } from './components/TodoPanel'
import { Transcript } from './components/Transcript'
import { type ErrorReporter, webviewErrorReport } from './errorReport'
import { createUiStore, listenToHost, type UiStore } from './state/store'
import {
  canSend,
  agentsOf,
  backgroundTasksOf,
  editsAfter,
  forkCutBefore,
  initialUiState,
  referenceLabel,
  type UiState,
  visibleEditorContext,
} from './state/uiState'
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

/** What floats above the composer: a palette view, a menu or the History dialog. */
type Overlay = PaletteView | 'modes' | 'attach' | 'history' | 'usage' | 'agents'

// The palette rows that leave it open (a value changes in place); run from
// the prompt's "/" palette they keep the `/` too, so it stays (M38).
const KEEPS_PALETTE_OPEN: ReadonlySet<PaletteAction['type']> = new Set([
  'setEffort',
  'toggleThinking',
  'toggleFocusView',
  'toggleCtrlEnterToSend',
  'none',
])

const GATED_STATUSES = new Set(['noCli', 'signedOut', 'signingIn', 'error'])
const ATTACH_UPLOAD = 'upload'
const ATTACH_CONTEXT = 'context'
const MENTION_TRIGGER = '@'
const WHITESPACE_END = /\s$/
const PERCENT = 100
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

/** "12% context" once the host has reported usage against a known window. */
export function contextLabelFor(state: UiState): string | undefined {
  const { context } = state
  if (context?.windowTokens === undefined || context.windowTokens === 0) {
    return undefined
  }
  const percent = Math.round((context.usedTokens / context.windowTokens) * PERCENT)
  return fill(UI_TEXT.contextPercent, { percent: formatPercent(percent) })
}

/** Tooltip detail for the context indicator, which compacts on click (M14). */
function contextTitleFor(state: UiState): string | undefined {
  const { context } = state
  if (context?.windowTokens === undefined) {
    return undefined
  }
  const detail = fill(UI_TEXT.contextDetail, {
    used: formatTokenWindow(context.usedTokens),
    window: formatTokenWindow(context.windowTokens),
    pressure: context.pressure,
  })
  return `${detail} · ${UI_TEXT.contextCompactTitle}`
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
  const [overlay, setOverlay] = useState<Overlay | undefined>(undefined)
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined)
  const canBypass = state.settings?.allowDangerouslySkipPermissions ?? false

  // The transcript follows new entries while the reader is at its end; once
  // they scroll up it holds still and offers a jump to the newest (M15).
  // `seenTranscript` is the transcript as of the reader's last scroll, so
  // "new below" means it changed since, while they were away from the end.
  const bodyRef = useRef<HTMLElement>(null)
  const [isPinnedToEnd, setIsPinnedToEnd] = useState(true)
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
    postMessage({ type: 'ready' })
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
    postMessage({ type: 'clearConversation' })
  }, [dispatch, postMessage])
  const onSubmit = useCallback(() => {
    const current = store.getState()
    if (!canSend(current)) {
      return
    }
    const text = current.draft.trim()
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
  }, [store, dispatch, newLocalId, postMessage])
  const onDismissEditorContext = useCallback(() => {
    dispatch({ type: 'editorContextDismissed' })
  }, [dispatch])
  // Replying to an output and quoting a highlighted passage (M17): both set
  // the composer's reference chip; the message carries it as context.
  const [quoteMenu, setQuoteMenu] = useState<
    { readonly entryId: string; readonly role: string; readonly text: string } | undefined
  >(undefined)
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
  const onTranscriptContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''
    const anchor = selection?.anchorNode ?? null
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    const row = element?.closest<HTMLElement>('[data-entry-id]') ?? null
    const entryId = row?.dataset['entryId']
    if (text === '' || row === null || entryId === undefined) {
      return
    }
    event.preventDefault()
    setQuoteMenu({ entryId, role: row.dataset['role'] ?? 'assistant', text })
  }, [])
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
      if (view === 'history') {
        // Always re-list: the rows change while the dialog is closed.
        postMessage({ type: 'listSessions' })
      } else if (view === 'usage') {
        postMessage({ type: 'readUsage' })
      }
      setOverlay(view)
    },
    [store, postMessage],
  )
  const closeOverlay = useCallback(() => {
    setOverlay(undefined)
    dispatch({ type: 'focusRequested' })
  }, [dispatch])
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
  const onOpenHistory = useCallback(() => {
    toggleOverlay('history')
  }, [toggleOverlay])
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
      postMessage({ type: 'resumeSession', sessionId })
      closeOverlay()
    },
    [postMessage, closeOverlay],
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
      postMessage({ type: 'forkSession', lastTurnId: cut.lastTurnId })
    },
    [store, onNewConversation, postMessage],
  )
  // "Rewind code to here": the host reverts the edits after that message,
  // newest first, and says so (or that there was nothing to revert).
  const onRewind = useCallback(
    (entryId: string) => {
      postMessage({ type: 'rewindCode', edits: [...editsAfter(store.getState(), entryId)] })
    },
    [store, postMessage],
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
      postMessage({ type: 'attachImageData', ...image })
    },
    [postMessage],
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
        case 'compact': {
          postMessage({ type: 'compact' })
          closeOverlay()
          break
        }
        case 'manageSkills':
        case 'importSkills':
        case 'showMcpServers':
        case 'showHooks':
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
        case 'openExternal': {
          postMessage({ type: 'openExternal', url: action.url })
          closeOverlay()
          break
        }
        case 'none': {
          break
        }
      }
    },
    [store, dispatch, postMessage, closeOverlay, openOverlay, onNewConversation],
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
      }),
    [
      state.model,
      state.models,
      state.effort,
      state.isThinkingEnabled,
      state.permissionMode,
      state.settings,
      state.usage,
      state.skills,
      state.auth.backend,
    ],
  )
  // The prompt's "/" menus (M38). A row chosen there takes the `/` with it,
  // unless it leaves the palette open; a skill becomes `/selector ` for its
  // arguments.
  const slashCommands = useMemo(() => slashCommandsOf(paletteGroups), [paletteGroups])
  const slashPaletteKeys = useRef<PaletteKeys>(null)
  const onPromptAction = useCallback(
    (action: PaletteAction) => {
      if (action.type === 'insertSkill') {
        dispatch({ type: 'draftChanged', draft: `/${action.selector} ` })
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
        detail: permissionModeDetail(mode, state.auth.backend),
        icon: modeIcon(mode),
        isChecked: mode === state.permissionMode,
      })),
    [canBypass, state.permissionMode, state.auth.backend],
  )
  const agents = agentsOf(state)
  const effortLevels = effortLevelsFor(state.model?.modelId)
  const onStepEffort = useCallback(
    (direction: -1 | 1) => {
      onSelectEffort(effortAt(effortLevels, effortIndex(effortLevels, state.effort) + direction))
      return true
    },
    [onSelectEffort, effortLevels, state.effort],
  )

  const isShellReady = state.settings !== undefined && state.pendingRestore === undefined
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

  const title = state.title ?? UI_TEXT.untitledConversation

  if (state.settings === undefined || state.pendingRestore !== undefined) {
    // A restored panel waits for the host to confirm its conversation (M25).
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
  let body
  if (isBodyGated) {
    body = (
      <SignIn
        status={state.auth.status}
        detail={state.auth.detail}
        methods={state.auth.methods}
        onSignIn={onSignIn}
        onRetry={onRetry}
        onOpenExternal={onOpenExternal}
      />
    )
  } else if (hasTranscript) {
    body = (
      <Transcript
        entries={state.transcript}
        isRunning={isRunning}
        isFocusView={state.settings.focusView}
        outputPages={state.outputPages}
        onOpenLink={onOpenExternal}
        onCopy={onCopy}
        onInsert={onInsert}
        onReadOutput={onReadOutput}
        onOpenOutput={onOpenOutput}
        onDecide={onDecide}
        onAnswer={onAnswer}
        onCancelQuestion={onCancelQuestion}
        onApply={onApply}
        onOpenEditDiff={onOpenEditDiff}
        onOpenFile={onOpenFile}
        onRefuseLink={onRefuseLink}
        onFork={state.sessionId === undefined || !state.canEditSessions ? undefined : onFork}
        onRewind={state.sessionId === undefined ? undefined : onRewind}
        onReply={onReply}
        quoteMenuEntryId={quoteMenu?.entryId}
        onQuote={onQuote}
        onCopyQuote={onCopyQuote}
        onCloseQuoteMenu={onCloseQuoteMenu}
      />
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
    case undefined: {
      // History hangs from the header; usage and the Agent map are modals.
      floating = null
      break
    }
  }
  const agentMap =
    overlay === 'agents' ? (
      <AgentMap
        title={title}
        modelId={state.model?.modelId}
        contextUsedTokens={state.context?.usedTokens}
        agents={agents}
        backgroundTasks={backgroundTasksOf(state)}
        delegationMode={state.usageReport?.account?.delegationMode}
        isDelegationEnabled={state.usageReport?.account?.delegationMode === MUSE_DELEGATION_ENABLED}
        childTranscripts={state.childTranscripts}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onReadChild={onReadChild}
        onControl={onControlAgent}
        onMessage={onMessageAgent}
        onOpenMuseSettings={onOpenMuseSettings}
        onClose={closeOverlay}
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
  const usageDialog =
    overlay === 'usage' ? (
      <UsageDialog
        report={state.usageReport}
        usage={state.usage}
        context={state.context}
        modelId={state.model?.modelId}
        now={now}
        onOpenExternal={onOpenExternal}
        onClose={closeOverlay}
      />
    ) : null
  // Behind a modal nothing takes focus or clicks (M25): the modal traps Tab,
  // the rest of the panel is inert.
  const isModalOpen = overlay === 'usage' || overlay === 'agents'

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
          onNewConversation={onNewConversation}
          onOpenHistory={onOpenHistory}
          onRename={state.sessionId === undefined || !state.canEditSessions ? undefined : onRename}
          agentCount={agents.length}
          runningAgentCount={agents.filter((agent) => agent.status === 'inProgress').length}
          onOpenAgents={onOpenAgents}
        />
        {history}
      </div>
      {usageDialog}
      {agentMap}
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
      <TodoPanel items={state.todos} isInert={isModalOpen} />
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
          contextLabel={contextLabelFor(state)}
          contextTitle={contextTitleFor(state)}
          focusRequests={state.focusRequests}
          pendingInsert={state.pendingInsert}
          attachments={state.attachments}
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
          onCyclePermissionMode={onCyclePermissionMode}
          onOpenModeMenu={onOpenModeMenu}
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
