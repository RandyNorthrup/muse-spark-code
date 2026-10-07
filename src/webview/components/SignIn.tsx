// The gate shown until a credential exists: install instructions when the CLI
// is missing (with the Model API key as the other way in), the sign-in paths
// the backend selection offers otherwise, and error / waiting states.

import { MUSE_INSTALL_URL, UI_TEXT } from '../../shared/constants'
import type { AuthStatus, SignInMethod } from '../../shared/protocol'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from './Modal'

export interface SignInProps {
  readonly status: AuthStatus
  readonly detail: string | undefined
  /** The paths to offer; both when the host has not said (M7). */
  readonly methods?: readonly SignInMethod[] | undefined
  readonly verificationUrl?: string | undefined
  readonly userCode?: string | undefined
  readonly installCommand?: string | undefined
  readonly withTranscript?: boolean | undefined
  readonly onSignIn: (method: SignInMethod) => void
  readonly onInstall: () => void
  readonly onInstallConfirmationChange?: ((isOpen: boolean) => void) | undefined
  readonly onCancelSignIn: () => void
  readonly onRetry: () => void
  readonly onOpenExternal: (url: string) => void
}

const ALL_METHODS: readonly SignInMethod[] = ['browser', 'apiKey', 'byo']

export function SignIn({
  status,
  detail,
  methods = ALL_METHODS,
  verificationUrl,
  userCode,
  installCommand,
  withTranscript = false,
  onSignIn,
  onInstall,
  onInstallConfirmationChange,
  onCancelSignIn,
  onRetry,
  onOpenExternal,
}: SignInProps) {
  const [confirmInstall, setConfirmInstall] = useState(false)
  const installButton = useRef<HTMLButtonElement>(null)
  const confirmOpenRef = useRef(false)
  useEffect(() => {
    onInstallConfirmationChange?.(confirmInstall)
    if (!confirmInstall && status === 'noCli' && confirmOpenRef.current) {
      installButton.current?.focus()
    }
    confirmOpenRef.current = confirmInstall
    return () => {
      onInstallConfirmationChange?.(false)
    }
  }, [confirmInstall, onInstallConfirmationChange, status])
  const hasBrowser = methods.includes('browser')
  const hasApiKey = methods.includes('apiKey')
  const hasByo = methods.includes('byo')
  // With no backend set up the three choices rank equally: the same button
  // style, in a stack, with Muse not presumed (M95, PLAN.md D74).
  const isEqualChoice = hasBrowser && hasApiKey && hasByo
  const primaryClass = 'button-primary'
  const apiKeyButton = hasApiKey ? (
    <>
      <button
        type="button"
        className={isEqualChoice ? primaryClass : 'button-secondary'}
        onClick={() => {
          onSignIn('apiKey')
        }}
      >
        {UI_TEXT.signInApiKey}
      </button>
      <p className="gate-hint">{UI_TEXT.signInApiKeyDetail}</p>
    </>
  ) : null
  const byoButton = hasByo ? (
    <>
      <button
        type="button"
        className={isEqualChoice ? primaryClass : 'button-secondary'}
        onClick={() => {
          onSignIn('byo')
        }}
      >
        {UI_TEXT.startWithOwnModel}
      </button>
      <p className="gate-hint">{UI_TEXT.startWithOwnModelDetail}</p>
    </>
  ) : null

  if (status === 'noCli' || status === 'installing') {
    return (
      <section
        className={withTranscript ? 'gate gate-with-transcript' : 'gate'}
        aria-labelledby="gate-title"
      >
        <h2 id="gate-title" className="gate-title">
          {UI_TEXT.installTitle}
        </h2>
        <p className="gate-detail">
          {hasApiKey ? UI_TEXT.installOrKeyDetail : UI_TEXT.installDetail}
        </p>
        {status === 'installing' && (
          <p className="gate-detail" role="status">
            {UI_TEXT.installWaiting}
          </p>
        )}
        {status !== 'installing' && detail !== undefined && (
          <p className="gate-diagnostic">{detail}</p>
        )}
        {confirmInstall && installCommand !== undefined && status === 'noCli'
          ? createPortal(
              <Modal
                title={UI_TEXT.installStartAction}
                titleId="install-muse-code-title"
                onClose={() => {
                  setConfirmInstall(false)
                }}
              >
                <div className="gate-install-confirm">
                  <p>{UI_TEXT.installConfirmDetail}</p>
                  <code className="gate-install-command">{installCommand}</code>
                  <div className="gate-actions">
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => {
                        setConfirmInstall(false)
                        onInstall()
                      }}
                    >
                      {UI_TEXT.installConfirmAction}
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => {
                        setConfirmInstall(false)
                      }}
                    >
                      {UI_TEXT.installCancelAction}
                    </button>
                  </div>
                </div>
              </Modal>,
              document.body,
            )
          : null}
        <div className="gate-actions">
          {installCommand !== undefined && status === 'noCli' && !confirmInstall ? (
            <button
              ref={installButton}
              type="button"
              className="button-primary"
              onClick={() => {
                setConfirmInstall(true)
              }}
            >
              {UI_TEXT.installStartAction}
            </button>
          ) : null}
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onOpenExternal(MUSE_INSTALL_URL)
            }}
          >
            {UI_TEXT.installAction}
          </button>
          {status === 'noCli' ? (
            <button type="button" className="button-secondary" onClick={onRetry}>
              {UI_TEXT.retryAction}
            </button>
          ) : null}
          {status === 'noCli' ? apiKeyButton : null}
          {status === 'noCli' ? byoButton : null}
        </div>
      </section>
    )
  }

  if (status === 'signingIn') {
    return (
      <section className={withTranscript ? 'gate gate-with-transcript' : 'gate'} aria-live="polite">
        <p className="gate-detail">{detail ?? UI_TEXT.deviceCodeWaiting}</p>
        {verificationUrl !== undefined && userCode !== undefined ? (
          <>
            <p className="gate-detail">{UI_TEXT.deviceCodePrompt}</p>
            <code className="gate-device-code">{userCode}</code>
          </>
        ) : null}
        <div className="gate-actions">
          {verificationUrl === undefined || userCode === undefined ? null : (
            <button
              type="button"
              className="button-primary"
              onClick={() => {
                onOpenExternal(verificationUrl)
              }}
            >
              {UI_TEXT.deviceCodeOpenAction}
            </button>
          )}
          <button type="button" className="button-secondary" onClick={onCancelSignIn}>
            {UI_TEXT.deviceCodeCancelAction}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      className={withTranscript ? 'gate gate-with-transcript' : 'gate'}
      aria-labelledby="gate-title"
    >
      <h2 id="gate-title" className="gate-title">
        {UI_TEXT.signInTitle}
      </h2>
      {detail === undefined ? null : (
        <p className="gate-diagnostic" role={status === 'error' ? 'alert' : 'status'}>
          {detail}
        </p>
      )}
      <div className="gate-actions">
        {hasBrowser ? (
          <>
            <button
              type="button"
              className={isEqualChoice ? primaryClass : 'button-primary'}
              onClick={() => {
                onSignIn('browser')
              }}
            >
              {UI_TEXT.signInBrowser}
            </button>
            <p className="gate-hint">{UI_TEXT.signInBrowserDetail}</p>
          </>
        ) : null}
        {apiKeyButton}
        {byoButton}
        {status === 'error' ? (
          <button type="button" className="button-secondary" onClick={onRetry}>
            {UI_TEXT.retryAction}
          </button>
        ) : null}
      </div>
    </section>
  )
}
