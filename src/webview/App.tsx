import { useCallback, useEffect, useReducer } from 'react'
import { UI_TEXT } from '../shared/constants'
import {
  parseHostToWebviewMessage,
  type SignInMethod,
  type WebviewToHostMessage,
} from '../shared/protocol'
import { Composer } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { SignIn } from './components/SignIn'
import { Transcript } from './components/Transcript'
import { canSend, initialUiState, type UiState, uiReducer } from './state/uiState'

export interface AppProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
  /** Injected so tests get deterministic ids. */
  readonly newLocalId?: () => string
}

const GATED_STATUSES = new Set(['noCli', 'signedOut', 'signingIn', 'error'])
const TOKENS_PER_MILLION = 1_000_000
const TOKENS_PER_THOUSAND = 1000

function isGated(state: UiState): boolean {
  return GATED_STATUSES.has(state.auth.status) && state.transcript.length === 0
}

function modelLabelFor(state: UiState): string {
  if (state.auth.status !== 'signedIn') {
    return UI_TEXT.notSignedIn
  }
  if (state.model === undefined) {
    return UI_TEXT.hostStarting
  }
  const { modelId, contextLimit } = state.model
  if (contextLimit === undefined) {
    return modelId
  }
  const window =
    contextLimit >= TOKENS_PER_MILLION
      ? `${String(Math.round(contextLimit / TOKENS_PER_MILLION))}M`
      : `${String(Math.round(contextLimit / TOKENS_PER_THOUSAND))}K`
  return `${modelId} (${window})`
}

export function App({ postMessage, newLocalId = () => crypto.randomUUID() }: AppProps) {
  const [state, dispatch] = useReducer(uiReducer, initialUiState)

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
  const onNewConversation = useCallback(() => {
    postMessage({ type: 'openNewTab' })
  }, [postMessage])
  const onSubmit = useCallback(() => {
    const text = state.draft.trim()
    if (!canSend(state)) {
      return
    }
    const localId = newLocalId()
    dispatch({ type: 'submitted', localId, text })
    postMessage({ type: 'sendMessage', localId, text })
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
      <Composer
        draft={state.draft}
        placeholder={state.composerPlaceholder}
        settings={state.settings}
        canSend={canSend(state)}
        isRunning={state.activeTurnId !== undefined}
        modelLabel={modelLabelFor(state)}
        focusRequests={state.focusRequests}
        pendingInsert={state.pendingInsert}
        onDraftChange={onDraftChange}
        onInsertApplied={onInsertApplied}
        onSubmit={onSubmit}
        onStop={onStop}
        onFocusChange={onFocusChange}
      />
      <span className="version" aria-label="Extension version">
        v{state.extensionVersion}
      </span>
    </div>
  )
}
