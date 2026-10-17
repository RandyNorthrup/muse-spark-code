// What went wrong when a request never reached the server (M56, PLAN.md
// D43). Node's `fetch` throws "fetch failed" and keeps the reason in the
// error's causes: a TLS verification code for a certificate it does not
// trust, a socket code for a connection it could not make, or undici's
// "Proxy response (407) !== 200 when HTTP Tunneling" from a proxy. Those are
// the facts a user behind a corporate network needs, so the message names
// the likely fix (which VS Code setting, which store) and keeps the
// technical detail beside it. Pure; no `vscode` import. The shapes are the
// ones Node 24 throws (captured 2026-09-25, docs/certification/m56.md).
//
// The ACP agent (PLAN.md D62, Q66) runs outside VS Code, where its
// settings do not reach: there the same failure names the variables the
// agent's own environment takes instead. The host says which it is.

import {
  CONNECTION_ERROR_CODES,
  ERROR_CAUSE_MAX_DEPTH,
  HTTP_PROXY_AUTHENTICATION_REQUIRED,
  PROXY_TUNNEL_STATUS,
  TLS_TRUST_ERROR_CODES,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { redactSecrets } from './redact'

export type NetworkFailureKind =
  'certificate' | 'proxyCredentials' | 'proxyRefused' | 'unreachable' | 'other'

/**
 * Whose settings the advice names: VS Code's `http.*` settings in the
 * extension, the agent's environment variables in the ACP agent.
 */
export type NetworkAdvice = 'vscode' | 'agent'

export interface NetworkFailure {
  readonly kind: NetworkFailureKind
  /** The error and its causes, "fetch failed: connect ECONNREFUSED … (ECONNREFUSED)". */
  readonly detail: string
  /** The status a proxy answered the tunnel with, for the proxy kinds. */
  readonly proxyStatus: number | undefined
}

interface Link {
  readonly message: string
  /** A string code (`ECONNREFUSED`); a DOMException's numeric code is not one. */
  readonly code: string | undefined
}

/** A cause that is not an Error: its text when it is one, else only its type. */
function plainLink(cause: unknown): Link {
  const message =
    typeof cause === 'string' || typeof cause === 'number' ? String(cause) : typeof cause
  return { message, code: undefined }
}

/** The error, then each `cause` under it, as far as ERROR_CAUSE_MAX_DEPTH. */
function chainOf(error: unknown): readonly Link[] {
  const links: Link[] = []
  let current: unknown = error
  while (current !== undefined && current !== null) {
    if (links.length >= ERROR_CAUSE_MAX_DEPTH) {
      break
    }
    if (!(current instanceof Error)) {
      links.push(plainLink(current))
      break
    }
    const code = 'code' in current && typeof current.code === 'string' ? current.code : undefined
    links.push({ message: current.message, code })
    current = current.cause
  }
  return links
}

function describeLink(link: Link): string {
  return link.code === undefined || link.message.includes(link.code)
    ? link.message
    : `${link.message} (${link.code})`
}

function proxyStatusIn(links: readonly Link[]): number | undefined {
  for (const link of links) {
    const status = PROXY_TUNNEL_STATUS.exec(link.message)?.[1]
    if (status !== undefined) {
      return Number(status)
    }
  }
  return undefined
}

function kindOf(links: readonly Link[], proxyStatus: number | undefined): NetworkFailureKind {
  if (proxyStatus !== undefined) {
    return proxyStatus === HTTP_PROXY_AUTHENTICATION_REQUIRED ? 'proxyCredentials' : 'proxyRefused'
  }
  const codes = links.flatMap((link) => (link.code === undefined ? [] : [link.code]))
  if (codes.some((code) => TLS_TRUST_ERROR_CODES.has(code))) {
    return 'certificate'
  }
  return codes.some((code) => CONNECTION_ERROR_CODES.has(code)) ? 'unreachable' : 'other'
}

export function describeNetworkFailure(error: unknown): NetworkFailure {
  const links = chainOf(error)
  const proxyStatus = proxyStatusIn(links)
  return {
    kind: kindOf(links, proxyStatus),
    detail: redactSecrets(links.map((link) => describeLink(link)).join(': ')),
    proxyStatus,
  }
}

/**
 * The error and its causes by their codes (`ERR_TLS_CERT_ALTNAME_INVALID`),
 * a cause's message only where it has no code (M69). A code is Node's own
 * word; a message can carry what a server sent, such as the names on its
 * certificate.
 */
export function networkFailureCodes(error: unknown): string {
  return redactSecrets(
    chainOf(error)
      .map((link) => link.code ?? link.message)
      .join(': '),
  )
}

/** The advice for a kind, read when shown (PLAN.md D33); none for an unrecognised failure. */
function adviceFor(failure: NetworkFailure, advice: NetworkAdvice): string | undefined {
  const isAgent = advice === 'agent'
  switch (failure.kind) {
    case 'certificate': {
      return isAgent ? UI_TEXT.acpNetworkUntrustedCertificate : UI_TEXT.networkUntrustedCertificate
    }
    case 'proxyCredentials': {
      return isAgent ? UI_TEXT.acpNetworkProxyCredentials : UI_TEXT.networkProxyCredentials
    }
    case 'proxyRefused': {
      // A status code, not a quantity: never grouped or localised.
      return fill(UI_TEXT.networkProxyRefused, { status: String(failure.proxyStatus) })
    }
    case 'unreachable': {
      return isAgent ? UI_TEXT.acpNetworkUnreachable : UI_TEXT.networkUnreachable
    }
    case 'other': {
      return undefined
    }
  }
}

/**
 * The advice, with the technical detail in parentheses; the detail alone
 * when there is none. A proxy's refusal names no setting, so both hosts
 * share it.
 */
export function networkFailureMessage(error: unknown, advice: NetworkAdvice = 'vscode'): string {
  const failure = describeNetworkFailure(error)
  const text = adviceFor(failure, advice)
  return text === undefined ? failure.detail : `${text} (${failure.detail})`
}
