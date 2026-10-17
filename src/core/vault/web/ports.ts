import { type CdpConnection } from '../../browser/cdpPipe'
import { type VaultUseLifetime } from '../broker/ports'
import { type VaultItem, type VaultTicket, type VaultUse } from '../../../shared/vault'
import { type VaultApprovalResult } from '../../../shared/vaultProtocol'

export type WebFillUse = Extract<VaultUse, { kind: 'fill' }>
export type WebSessionUse = Extract<VaultUse, { kind: 'session' }>

/** Trusted M81 facts, derived from captured CDP frames, never from tool arguments. */
export interface WebTargetFacts {
  readonly topUrl: string
  readonly frameUrl: string
  readonly frameId: string
  readonly certificateValid: boolean
  readonly input: null | {
    readonly tag: string
    readonly type: string
    readonly autocomplete: string
    readonly disabled: boolean
    readonly readOnly: boolean
  }
}

export interface WebTargetLease {
  readonly facts: WebTargetFacts
  readonly sessionId: string
  readonly isolatedContextId: number
  readonly cdp: Pick<CdpConnection, 'send'>
  /** Synchronous barrier: throws after any navigation, certificate/focus/element change or close. */
  assertCurrent(): void
  /** Normalized private records; the M81 adapter validates the captured CDP cookie shape. */
  readCookies(origin: string): Promise<readonly WebCookie[]>
  /** Host-only, secure cookies, addressed with this exact origin's URL, on this private context only. */
  restoreCookies(origin: string, cookies: readonly WebCookie[]): Promise<void>
}

/** Required integration binding M109-L-M81. No system browser or third-party MCP implements this. */
export interface WebBrowserOwnerPort {
  readonly browserId: string
  readonly runtime: {
    readonly product: 'chrome' | 'headless-shell'
    readonly version: string
    readonly manifestDigest: string
    readonly executableDigest: string
    readonly headed: boolean
    readonly virtualAuthenticator: boolean
  }
  /**
   * One serialized owner for the browser. It inspects in an isolated world, without reading
   * any input value, and pins navigation and focus through the callback's Input.insertText
   * dispatch. All other browser actions share this queue. Failure to pin refuses the lease.
   * The explicit origin host must be added to the check's frozen scope before opening it.
   */
  withTarget<T>(
    origin: string,
    field: WebFillUse['field'] | null,
    run: (target: WebTargetLease) => Promise<T>,
  ): Promise<T>
  /** Ends the owned browser tree on broker lock/revoke or cancellation. */
  close(): Promise<void>
}

/** B binds these methods to its authenticated requester and registration incarnation. */
export interface WebUseBrokerPort {
  redeem(
    ticket: VaultTicket,
    use: VaultUse,
    lifetime: VaultUseLifetime,
  ): Promise<VaultApprovalResult>
  withApprovedMaterial(
    ticketId: string,
    use: VaultUse,
    run: (item: VaultItem) => Promise<void>,
  ): Promise<void>
  finish(ticketId: string, hasSucceeded: boolean): Promise<void>
}

/** Internal broker representation, deliberately distinct from the vendor's CDP wire shape. */
export interface WebCookie {
  readonly origin: string
  readonly name: string
  readonly value: Uint8Array
  readonly path: string
  readonly secure: true
  readonly hostOnly: true
  readonly httpOnly: boolean
  readonly sameSite: 'Strict' | 'Lax' | 'None'
  readonly expiresAt: number | null
}

/** Required integration binding M109-L-HEADED: consent + verified full Chrome pin, not the shell. */
export interface HeadedWebBrowserPort {
  open(request: {
    origin: string
    explicitHosts: readonly string[]
    signal: AbortSignal
  }): Promise<WebBrowserOwnerPort>
  /** Keeps the private CDP context alive until run completes, when the user closes the window. */
  captureOnUserClose(
    browser: WebBrowserOwnerPort,
    signal: AbortSignal,
    run: () => Promise<void>,
  ): Promise<void>
}
