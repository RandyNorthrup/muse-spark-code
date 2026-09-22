import { useCallback, useEffect, useReducer } from 'react'
import { UI_TEXT } from '../shared/constants'
import { parseHostToWebviewMessage, type WebviewToHostMessage } from '../shared/protocol'
import { Composer } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import { Header } from './components/Header'
import { initialUiState, uiReducer } from './state/uiState'

export interface AppProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
}

export function App({ postMessage }: AppProps) {
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
    // Sending arrives with the first backend (M2); the button stays disabled.
  }, [])

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

  return (
    <div className="app">
      <Header
        title={UI_TEXT.untitledConversation}
        isFocusView={state.settings.focusView}
        onNewConversation={onNewConversation}
      />
      <main className="body">
        <EmptyState hint={state.emptyStateHint} />
      </main>
      <Composer
        draft={state.draft}
        placeholder={state.composerPlaceholder}
        settings={state.settings}
        canSend={false}
        focusRequests={state.focusRequests}
        pendingInsert={state.pendingInsert}
        onDraftChange={onDraftChange}
        onInsertApplied={onInsertApplied}
        onSubmit={onSubmit}
        onFocusChange={onFocusChange}
      />
      <span className="version" aria-label="Extension version">
        v{state.extensionVersion}
      </span>
    </div>
  )
}
