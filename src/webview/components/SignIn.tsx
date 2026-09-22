// The gate shown until a credential exists: install instructions when the CLI
// is missing, the two sign-in paths otherwise, and error / waiting states.

import { MUSE_INSTALL_URL, UI_TEXT } from '../../shared/constants'
import type { AuthStatus, SignInMethod } from '../../shared/protocol'

export interface SignInProps {
  readonly status: AuthStatus
  readonly detail: string | undefined
  readonly onSignIn: (method: SignInMethod) => void
  readonly onRetry: () => void
  readonly onOpenExternal: (url: string) => void
}

export function SignIn({ status, detail, onSignIn, onRetry, onOpenExternal }: SignInProps) {
  if (status === 'noCli') {
    return (
      <section className="gate" aria-labelledby="gate-title">
        <h2 id="gate-title" className="gate-title">
          {UI_TEXT.installTitle}
        </h2>
        <p className="gate-detail">{UI_TEXT.installDetail}</p>
        {detail === undefined ? null : <p className="gate-diagnostic">{detail}</p>}
        <div className="gate-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              onOpenExternal(MUSE_INSTALL_URL)
            }}
          >
            {UI_TEXT.installAction}
          </button>
          <button type="button" className="button-secondary" onClick={onRetry}>
            {UI_TEXT.retryAction}
          </button>
        </div>
      </section>
    )
  }

  if (status === 'signingIn') {
    return (
      <section className="gate" aria-live="polite">
        <p className="gate-detail">{detail ?? UI_TEXT.signInWaiting}</p>
      </section>
    )
  }

  return (
    <section className="gate" aria-labelledby="gate-title">
      <h2 id="gate-title" className="gate-title">
        {UI_TEXT.signInTitle}
      </h2>
      {detail === undefined ? null : (
        <p className="gate-diagnostic" role={status === 'error' ? 'alert' : undefined}>
          {detail}
        </p>
      )}
      <div className="gate-actions">
        <button
          type="button"
          className="button-primary"
          onClick={() => {
            onSignIn('browser')
          }}
        >
          {UI_TEXT.signInBrowser}
        </button>
        <p className="gate-hint">{UI_TEXT.signInBrowserDetail}</p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            onSignIn('apiKey')
          }}
        >
          {UI_TEXT.signInApiKey}
        </button>
        <p className="gate-hint">{UI_TEXT.signInApiKeyDetail}</p>
        {status === 'error' ? (
          <button type="button" className="button-secondary" onClick={onRetry}>
            {UI_TEXT.retryAction}
          </button>
        ) : null}
      </div>
    </section>
  )
}
