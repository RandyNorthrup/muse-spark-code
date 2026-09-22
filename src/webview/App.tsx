import { useEffect, useState } from 'react'
import { PRODUCT_NAME, UI_TEXT } from '../shared/constants'
import {
  type HostToWebviewMessage,
  parseHostToWebviewMessage,
  type WebviewToHostMessage,
} from '../shared/protocol'

export interface AppProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
}

export function App({ postMessage }: AppProps) {
  const [init, setInit] = useState<HostToWebviewMessage | undefined>()

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseHostToWebviewMessage(event.data)
      if (!parsed.ok) {
        console.warn(`Dropped malformed host message: ${parsed.error}`)
        return
      }
      // `init` is the only host message type today; a `switch` on
      // `parsed.message.type` replaces this line when a second type lands.
      setInit(parsed.message)
    }
    window.addEventListener('message', onMessage)
    postMessage({ type: 'ready' })
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [postMessage])

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title">{UI_TEXT.untitledConversation}</h1>
        {init === undefined ? null : (
          <span className="header-version" aria-label="Extension version">
            v{init.extensionVersion}
          </span>
        )}
      </header>
      <main className="body">
        <div className="brand">{PRODUCT_NAME}</div>
        {init === undefined ? (
          <p className="hint" role="status">
            {UI_TEXT.connecting}
          </p>
        ) : (
          <p className="hint">{init.emptyStateHint}</p>
        )}
      </main>
      <footer className="composer">
        <textarea
          className="composer-input"
          aria-label={UI_TEXT.composerLabel}
          placeholder={init?.composerPlaceholder}
          rows={1}
          disabled
        />
      </footer>
    </div>
  )
}
