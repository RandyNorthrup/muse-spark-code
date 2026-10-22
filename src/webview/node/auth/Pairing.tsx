import { useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { nodeDigestSchema, nodeDomainSchema } from '../../../shared/nodeAuth'
import { NodeBrowserAuthError, type NodeBrowserAuth } from './client'
import './pairing.css'

export interface NodePairingProps {
  fingerprint: string
  name: string
  certificateUrl: string
  auth: NodeBrowserAuth
  signedIn: (auth: NodeBrowserAuth) => void
}

/** Certificate URL is an inert same-origin public asset. No page sees the private key. */
export function NodePairing(props: NodePairingProps) {
  nodeDigestSchema.parse(props.fingerprint)
  nodeDomainSchema.parse(props.name)
  const fingerprint = props.fingerprint.replaceAll(/(..)(?=.)/gu, '$1:').toUpperCase()
  const certificate = new URL(props.certificateUrl, window.location.origin)
  if (
    certificate.origin !== window.location.origin ||
    certificate.search !== '' ||
    certificate.hash !== ''
  )
    throw new Error(UI_TEXT.nodeErrors.forbidden)
  const [hasCompared, setCompared] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(isEnrollment: boolean): Promise<void> {
    if (!hasCompared || busy) return
    setBusy(true)
    setError('')
    try {
      if (isEnrollment) {
        const input = code
        setCode('')
        await props.auth.enroll(input)
      } else await props.auth.signIn()
      props.signedIn(props.auth)
    } catch (error: unknown) {
      // Pairing fails with Errors only: protocol (brand), transport (TypeError),
      // payload (SyntaxError or ZodError) or the client's own refusals (Error).
      if (error instanceof NodeBrowserAuthError) {
        setError(UI_TEXT.nodeErrors[error.code])
        return
      }
      if (error instanceof TypeError) {
        setError(UI_TEXT.nodeAuth.trustRequired)
        return
      }
      if (error instanceof SyntaxError) {
        setError(UI_TEXT.nodeAuth.trustRequired)
        return
      }
      if (error instanceof Error && error.name === 'ZodError') {
        setError(UI_TEXT.nodeAuth.trustRequired)
        return
      }
      if (error instanceof Error && error.name === 'Error') {
        setError(UI_TEXT.nodeAuth.trustRequired)
        return
      }
      throw error
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="node-pairing">
      <h1>{UI_TEXT.nodeLabels.title}</h1>
      <h2>{UI_TEXT.nodeLabels.pairBrowser}</h2>
      <p>{fill(UI_TEXT.nodeMessages.nameRequired, { name: props.name })}</p>
      <p>{fill(UI_TEXT.nodeMessages.trustCertificate, { fingerprint })}</p>
      <p>
        <a href={certificate.href} download>
          {UI_TEXT.nodeAuth.download}
        </a>
      </p>
      <ol>
        <li>{UI_TEXT.nodeAuth.windows}</li>
        <li>{UI_TEXT.nodeAuth.macos}</li>
        <li>{UI_TEXT.nodeAuth.linux}</li>
        <li>{UI_TEXT.nodeAuth.firefox}</li>
      </ol>
      <p>{UI_TEXT.nodeAuth.trustRequired}</p>
      <label>
        <input
          type="checkbox"
          checked={hasCompared}
          onChange={(event) => {
            setCompared(event.target.checked)
          }}
        />
        {UI_TEXT.nodeAuth.verified}
      </label>
      <p>{UI_TEXT.nodeMessages.reloadSignsIn}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit(true)
        }}
      >
        <label htmlFor="node-setup-code">{UI_TEXT.nodeLabels.setupCode}</label>
        <input
          id="node-setup-code"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
          }}
          disabled={busy}
        />
        <button type="submit" disabled={!hasCompared || busy || code === ''}>
          {UI_TEXT.nodeLabels.enroll}
        </button>
      </form>
      <button
        type="button"
        disabled={!hasCompared || busy}
        onClick={() => {
          void submit(false)
        }}
      >
        {UI_TEXT.nodeLabels.signin}
      </button>
      <p role="alert">{error}</p>
      <p>{UI_TEXT.nodeMessages.unofficial}</p>
    </main>
  )
}
