import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { PERMISSION_MODE_LABELS, UI_TEXT } from '../shared/constants'
import { effortLabel } from '../shared/effort'
import { nextPermissionMode } from '../shared/permissionModes'
import { buildPalette, formatTokenWindow, type PaletteAction } from '../shared/palette'
import {
  parseHostToWebviewMessage,
  type SignInMethod,
  type WebviewToHostMessage,
} from '../shared/protocol'
import { Composer, type ImageData } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { Palette, type PaletteView } from './components/Palette'
import { SignIn } from './components/SignIn'
import { Transcript } from './components/Transcript'
import { canSend, initialUiState, type UiState, uiReducer } from './state/uiState'

export interface AppProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
  /** Injected so tests get deterministic ids. */
  readonly newLocalId?: () => string
}

const GATED_STATUSES = new Set(['noCli', 'signedOut', 'signingIn', 'error'])
const THINKING_OFF_LABEL = 'No thinking'

function isGated(state: UiState): boolean {
  return GATED_STATUSES.has(state.auth.status) && state.transcript.length === 0
}

export function modelLabelFor(state: UiState): string {
  if (state.auth.status !== 'signedIn') {
    return UI_TEXT.notSignedIn
  }
  if (state.model === undefined) {
    return UI_TEXT.hostStarting
  }
  const { modelId, contextLimit } = state.model
  const window = contextLimit === undefined ? '' : ` (${formatTokenWindow(contextLimit)})`
  const effort = state.isThinkingEnabled ? effortLabel(state.effort) : THINKING_OFF_LABEL
  return `${modelId}${window} ${effort}`
}

export function App({ postMessage, newLocalId = () => crypto.randomUUID() }: AppProps) {
  const [state, dispatch] = useReducer(uiReducer, initialUiState)
  const [palette, setPalette] = useState<PaletteView | undefined>(undefined)

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseHostToWebviewMessage(event.data)
      if (!parsed.ok) {
        console.warn(`Dropped malformed host message: ${parsed.error}`)
        return
      }
      dispatch({ type: 'hostMessage', message: parsed.message })
    }
    window.addEventListener('message', onMessage)
    postMessage({ type: 'ready' })
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [postMessage])

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
    dispatch({ type: 'submitted', localId, text })
    postMessage({ type: 'sendMessage', localId, text, attachmentIds })
  }, [state, newLocalId, postMessage])
  const onStop = useCallback(() => {
    postMessage({ type: 'cancelTurn' })
  }, [postMessage])
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
  const onCyclePermissionMode = useCallback(() => {
    postMessage({ type: 'setPermissionMode', mode: nextPermissionMode(state.permissionMode) })
  }, [postMessage, state.permissionMode])
  const openPalette = useCallback(
    (view: PaletteView) => {
      if (state.skills === undefined) {
        postMessage({ type: 'listSkills' })
      }
      setPalette(view)
    },
    [postMessage, state.skills],
  )
  const closePalette = useCallback(() => {
    setPalette(undefined)
    dispatch({ type: 'focusRequested' })
  }, [])
  // The slash button and the pill toggle their view: a second click closes.
  const togglePalette = useCallback(
    (view: PaletteView) => {
      if (palette === view) {
        closePalette()
      } else {
        openPalette(view)
      }
    },
    [palette, closePalette, openPalette],
  )
  const onOpenPalette = useCallback(() => {
    togglePalette('actions')
  }, [togglePalette])
  const onOpenModelPicker = useCallback(() => {
    togglePalette('models')
  }, [togglePalette])
  const onPaletteBack = useCallback(() => {
    setPalette('actions')
  }, [])
  const onPickFile = useCallback(() => {
    postMessage({ type: 'pickFile' })
  }, [postMessage])
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
      closePalette()
    },
    [postMessage, closePalette],
  )
  const onPaletteAction = useCallback(
    (action: PaletteAction) => {
      switch (action.type) {
        case 'attachFile': {
          postMessage({ type: 'pickFile' })
          closePalette()
          break
        }
        case 'mentionFile': {
          postMessage({ type: 'pickMentionFile' })
          closePalette()
          break
        }
        case 'clearConversation': {
          dispatch({ type: 'conversationCleared' })
          postMessage({ type: 'clearConversation' })
          closePalette()
          break
        }
        case 'openModelPicker': {
          setPalette('models')
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
        case 'cyclePermissionMode': {
          onCyclePermissionMode()
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
          closePalette()
          break
        }
        case 'signOut': {
          postMessage({ type: 'signOut' })
          closePalette()
          break
        }
        case 'insertSkill': {
          dispatch({ type: 'insertRequested', text: `/${action.selector} ` })
          setPalette(undefined)
          break
        }
        case 'compact': {
          postMessage({ type: 'compact' })
          closePalette()
          break
        }
        case 'openExternal': {
          postMessage({ type: 'openExternal', url: action.url })
          closePalette()
          break
        }
        case 'none': {
          break
        }
      }
    },
    [postMessage, closePalette, onCyclePermissionMode, state.isThinkingEnabled],
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
    ],
  )

  if (state.settings === undefined) {
    return (
      <div className="app">
        <Header
          title={UI_TEXT.untitledConversation}
          isFocusView={false}
          onNewConversation={onNewConversation}
        />
        <main className="body">
          <p className="hint" role="status">
            {UI_TEXT.connecting}
          </p>
        </main>
      </div>
    )
  }

  let body
  if (isGated(state)) {
    body = (
      <SignIn
        status={state.auth.status}
        detail={state.auth.detail}
        onSignIn={onSignIn}
        onRetry={onRetry}
        onOpenExternal={onOpenExternal}
      />
    )
  } else if (state.transcript.length === 0) {
    body = <EmptyState hint={state.emptyStateHint} />
  } else {
    body = <Transcript entries={state.transcript} />
  }

  return (
    <div className="app">
      <Header
        title={UI_TEXT.untitledConversation}
        isFocusView={state.settings.focusView}
        onNewConversation={onNewConversation}
      />
      <main className={state.transcript.length === 0 ? 'body' : 'body body-transcript'}>
        {body}
      </main>
      <div className="composer-area">
        {palette === undefined ? null : (
          <Palette
            key={palette}
            view={palette}
            groups={paletteGroups}
            models={state.models}
            currentModelId={state.model?.modelId}
            onAction={onPaletteAction}
            onSelectModel={onSelectModel}
            onBack={onPaletteBack}
            onClose={closePalette}
          />
        )}
        <Composer
          draft={state.draft}
          placeholder={state.composerPlaceholder}
          settings={state.settings}
          canSend={canSend(state)}
          isRunning={state.activeTurnId !== undefined}
          modelLabel={modelLabelFor(state)}
          modeLabel={PERMISSION_MODE_LABELS[state.permissionMode]}
          focusRequests={state.focusRequests}
          pendingInsert={state.pendingInsert}
          attachments={state.attachments}
          mentionResults={state.mentionResults}
          onDraftChange={onDraftChange}
          onInsertApplied={onInsertApplied}
          onSubmit={onSubmit}
          onStop={onStop}
          onFocusChange={onFocusChange}
          onOpenPalette={onOpenPalette}
          onOpenModelPicker={onOpenModelPicker}
          onCyclePermissionMode={onCyclePermissionMode}
          onPickFile={onPickFile}
          onRemoveAttachment={onRemoveAttachment}
          onSearchMentions={onSearchMentions}
          onAttachImage={onAttachImage}
          onDroppedUris={onDroppedUris}
        />
      </div>
    </div>
  )
}
