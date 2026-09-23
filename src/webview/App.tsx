import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { QuestionAnswer } from '../shared/agentEvents'
import {
  type DictationAction,
  type EffortLevel,
  MUSE_DELEGATION_ENABLED,
  PERMISSION_MODE_DETAILS,
  PERMISSION_MODE_LABELS,
  UI_TEXT,
} from '../shared/constants'
import { editorContextLabel } from '../shared/editorContext'
import { effortAt, effortIndex, effortLabel, effortLevelsFor } from '../shared/effort'
import { availablePermissionModes, nextPermissionMode } from '../shared/permissionModes'
import { buildPalette, formatTokenWindow, type PaletteAction } from '../shared/palette'
import {
  type LineRange,
  parseHostToWebviewMessage,
  type PersistedState,
  type SignInMethod,
  type WebviewToHostMessage,
} from '../shared/protocol'
import type { ApprovalDecisionInput } from './components/ApprovalCard'
import { AgentMap } from './components/AgentMap'
import { Composer, type ImageData } from './components/Composer'
import { EffortSlider } from './components/EffortSlider'
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { HistoryDialog } from './components/HistoryDialog'
import { UsageDialog } from './components/UsageDialog'
import { AddContextIcon, ExpandChevron, UploadIcon } from './components/icons'
import { modeIcon } from './components/modeIcons'
import { Palette, type PaletteView } from './components/Palette'
import { type MenuEntry, PopoverMenu } from './components/PopoverMenu'
import { SignIn } from './components/SignIn'
import { TodoPanel } from './components/TodoPanel'
import { Transcript } from './components/Transcript'
import {
  canSend,
  agentsOf,
  backgroundTasksOf,
  editsAfter,
  forkCutBefore,
  initialUiState,
  type UiState,
  uiReducer,
  visibleEditorContext,
} from './state/uiState'

export interface AppProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
  /** Injected so tests get deterministic ids. */
  readonly newLocalId?: () => string
  /** Injected so tests get deterministic timestamps. */
  readonly now?: () => number
  /** Keeps the shown session in the webview state, for the reload serializer (D15). */
  readonly persistState?: (state: PersistedState) => void
}

/** What floats above the composer: a palette view, a menu or the History dialog. */
type Overlay = PaletteView | 'modes' | 'attach' | 'history' | 'usage' | 'agents'

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
  return `${String(percent)}% ${UI_TEXT.contextLabel}`
}

/** Tooltip detail for the context indicator, which compacts on click (M14). */
function contextTitleFor(state: UiState): string | undefined {
  const { context } = state
  return context?.windowTokens === undefined
    ? undefined
    : `${formatTokenWindow(context.usedTokens)} of ${formatTokenWindow(context.windowTokens)} tokens · ${UI_TEXT.contextPressure} ${context.pressure} · ${UI_TEXT.contextCompactTitle}`
}

const ATTACH_ENTRIES: readonly MenuEntry[] = [
  { id: ATTACH_UPLOAD, label: UI_TEXT.uploadFromComputer, icon: <UploadIcon /> },
  { id: ATTACH_CONTEXT, label: UI_TEXT.addContext, icon: <AddContextIcon /> },
]

// Stable defaults: a fresh function per render would re-run the message
// effect (and re-post `ready`) on every render.
const defaultLocalId = () => crypto.randomUUID()
const defaultNow = () => Date.now()

export function App({
  postMessage,
  newLocalId = defaultLocalId,
  now = defaultNow,
  persistState,
}: AppProps) {
  const [state, dispatch] = useReducer(uiReducer, initialUiState)
  const [overlay, setOverlay] = useState<Overlay | undefined>(undefined)
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined)
  const canBypass = state.settings?.allowDangerouslySkipPermissions ?? false

  // The transcript follows new entries while the reader is at its end; once
  // they scroll up it holds still and offers a jump to the newest (M15).
  // `seenTranscript` is the transcript as of the reader's last scroll, so
  // "new below" means it changed since, while they were away from the end.
  const bodyRef = useRef<HTMLElement>(null)
  const [isPinnedToEnd, setIsPinnedToEnd] = useState(true)
  const [seenTranscript, setSeenTranscript] = useState(state.transcript)
  const hasNewBelow =
    !isPinnedToEnd && state.transcript !== seenTranscript && state.transcript.length > 0
  const scrollToEnd = useCallback(() => {
    const body = bodyRef.current
    if (body !== null) {
      body.scrollTop = body.scrollHeight
    }
    setIsPinnedToEnd(true)
    setSeenTranscript(state.transcript)
  }, [state.transcript])
  const onBodyScroll = useCallback(() => {
    const body = bodyRef.current
    if (body === null) {
      return
    }
    const isAtEnd = body.scrollHeight - body.scrollTop - body.clientHeight <= SCROLL_END_SLACK_PX
    setIsPinnedToEnd(isAtEnd)
    setSeenTranscript(state.transcript)
  }, [state.transcript])
  useEffect(() => {
    const body = bodyRef.current
    if (isPinnedToEnd && body !== null) {
      body.scrollTop = body.scrollHeight
    }
  }, [state.transcript, isPinnedToEnd])

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseHostToWebviewMessage(event.data)
      if (!parsed.ok) {
        console.warn(`Dropped malformed host message: ${parsed.error}`)
        return
      }
      dispatch({ type: 'hostMessage', message: parsed.message, at: now() })
    }
    window.addEventListener('message', onMessage)
    postMessage({ type: 'ready' })
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [postMessage, now])

  useEffect(() => {
    persistState?.(state.sessionId === undefined ? {} : { sessionId: state.sessionId })
  }, [persistState, state.sessionId])

  const onDraftChange = useCallback((draft: string) => {
    dispatch({ type: 'draftChanged', draft })
  }, [])
  const onInsertApplied = useCallback(() => {
    dispatch({ type: 'insertApplied' })
  }, [])
  const onFocusChange = useCallback(
    (isFocused: boolean) => {
      postMessage({ type: 'inputFocusChanged', focused: isFocused })
    },
    [postMessage],
  )
  // The header button starts a new conversation in this surface, as in
  // Claude Code; a new editor tab is Ctrl+Shift+Esc or the view-title `+`.
  const onNewConversation = useCallback(() => {
    dispatch({ type: 'conversationCleared' })
    postMessage({ type: 'clearConversation' })
  }, [postMessage])
  const onSubmit = useCallback(() => {
    const text = state.draft.trim()
    if (!canSend(state)) {
      return
    }
    const localId = newLocalId()
    const attachmentIds = state.attachments.map((attachment) => attachment.id)
    // The open-file chip travels with the message: the host adds the context.
    const editorContext = visibleEditorContext(state)
    dispatch({
      type: 'submitted',
      localId,
      text,
      attachments: state.attachments,
      contextLabel: editorContext === undefined ? undefined : editorContextLabel(editorContext),
    })
    postMessage({
      type: 'sendMessage',
      localId,
      text,
      attachmentIds,
      includeEditorContext: editorContext !== undefined,
    })
    // The reader's own message always lands in view (M15).
    setIsPinnedToEnd(true)
  }, [state, newLocalId, postMessage])
  const onDismissEditorContext = useCallback(() => {
    dispatch({ type: 'editorContextDismissed' })
  }, [])
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
    [postMessage],
  )
  const onAnswer = useCallback(
    (userInputId: string, answers: readonly QuestionAnswer[]) => {
      postMessage({ type: 'answerQuestion', userInputId, answers: [...answers] })
    },
    [postMessage],
  )
  const onCancelQuestion = useCallback(
    (userInputId: string) => {
      postMessage({ type: 'cancelQuestion', userInputId })
    },
    [postMessage],
  )
  const onCyclePermissionMode = useCallback(() => {
    postMessage({
      type: 'setPermissionMode',
      mode: nextPermissionMode(state.permissionMode, canBypass),
    })
  }, [postMessage, state.permissionMode, canBypass])
  const openOverlay = useCallback(
    (view: Overlay) => {
      if ((view === 'actions' || view === 'models') && state.skills === undefined) {
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
    [postMessage, state.skills],
  )
  const closeOverlay = useCallback(() => {
    setOverlay(undefined)
    dispatch({ type: 'focusRequested' })
  }, [])
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
  const onOpenMuseSettings = useCallback(() => {
    postMessage({ type: 'hostAction', action: 'openMuseSettings' })
  }, [postMessage])
  const onCompact = useCallback(() => {
    postMessage({ type: 'compact' })
  }, [postMessage])
  const onDismissBanner = useCallback(() => {
    dispatch({ type: 'bannerDismissed' })
  }, [])
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
      const cut = forkCutBefore(state.transcript, entryId)
      if (cut === undefined) {
        return
      }
      if (cut.type === 'fresh') {
        onNewConversation()
        return
      }
      postMessage({ type: 'forkSession', lastTurnId: cut.lastTurnId })
    },
    [state.transcript, onNewConversation, postMessage],
  )
  // "Rewind code to here": the host reverts the edits after that message,
  // newest first, and says so (or that there was nothing to revert).
  const onRewind = useCallback(
    (entryId: string) => {
      postMessage({ type: 'rewindCode', edits: [...editsAfter(state.transcript, entryId)] })
    },
    [state.transcript, postMessage],
  )
  const onRemoveAttachment = useCallback(
    (id: string) => {
      dispatch({ type: 'attachmentRemoved', id })
      postMessage({ type: 'removeAttachment', id })
    },
    [postMessage],
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
      const isSpaceNeeded = state.draft !== '' && !WHITESPACE_END.test(state.draft)
      dispatch({
        type: 'insertRequested',
        text: `${isSpaceNeeded ? ' ' : ''}${MENTION_TRIGGER}`,
      })
      setOverlay(undefined)
    },
    [postMessage, state.draft],
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
          dispatch({ type: 'conversationCleared' })
          postMessage({ type: 'clearConversation' })
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
          postMessage({ type: 'setThinking', enabled: !state.isThinkingEnabled })
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
    [postMessage, closeOverlay, openOverlay, state.isThinkingEnabled],
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
  const modeEntries = useMemo(
    (): readonly MenuEntry[] =>
      availablePermissionModes(canBypass).map((mode) => ({
        id: mode,
        label: PERMISSION_MODE_LABELS[mode],
        detail: PERMISSION_MODE_DETAILS[mode],
        icon: modeIcon(mode),
        isChecked: mode === state.permissionMode,
      })),
    [canBypass, state.permissionMode],
  )
  const effortLevels = effortLevelsFor(state.model?.modelId)
  const onStepEffort = useCallback(
    (direction: -1 | 1) => {
      onSelectEffort(effortAt(effortLevels, effortIndex(effortLevels, state.effort) + direction))
      return true
    },
    [onSelectEffort, effortLevels, state.effort],
  )

  const title = state.title ?? UI_TEXT.untitledConversation

  if (state.settings === undefined) {
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
  if (isGated(state)) {
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
  } else if (state.transcript.length === 0) {
    body = (
      <EmptyState
        hint={state.emptyStateHint}
        isOnboardingShown={!state.settings.hideOnboarding}
        onHideOnboarding={onHideOnboarding}
      />
    )
  } else {
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
        onFork={state.sessionId === undefined ? undefined : onFork}
        onRewind={state.sessionId === undefined ? undefined : onRewind}
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
          hint={
            <span className="popover-hint">
              <kbd>{UI_TEXT.modesHintKeys}</kbd> {UI_TEXT.modesHint}
            </span>
          }
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
          entries={ATTACH_ENTRIES}
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
  const agents = agentsOf(state)
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

  return (
    <div className="app">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {state.announcement === undefined ? null : (
          <span key={state.announcement.sequence}>{state.announcement.text}</span>
        )}
      </div>
      <div className="header-area">
        <Header
          title={title}
          isFocusView={state.settings.focusView}
          onNewConversation={onNewConversation}
          onOpenHistory={onOpenHistory}
          onRename={state.sessionId === undefined ? undefined : onRename}
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
        className={state.transcript.length === 0 ? 'body' : 'body body-transcript'}
        onScroll={onBodyScroll}
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
      <TodoPanel items={state.todos} />
      <div className="composer-area">
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
          onDroppedUris={onDroppedUris}
          onCompact={onCompact}
          banner={state.banner}
          onDismissBanner={onDismissBanner}
        />
      </div>
    </div>
  )
}
