// Credential state for the Muse Code backend, shared by every surface.
//
// `status` is the presence-based estimate (authState.ts); the host's own
// `authRequired` turn error overrides it through `markAuthRequired`. All VS
// Code interactions (terminals, input boxes) are injected so the flow is
// unit-tested end to end.

import {
  CREDENTIAL_POLL_INTERVAL_MS,
  CREDENTIAL_POLL_TIMEOUT_MS,
  MUSE_LOGIN_ARGS,
  MUSE_LOGOUT_ARGS,
  UI_TEXT,
} from '../../shared/constants'
import type { AuthStatus, HostToWebviewMessage, SignInMethod } from '../../shared/protocol'
import type { Logger } from '../logger'
import { deriveAuthStatus } from './authState'
import { signInWithBrowser } from './browserSignIn'
import type { CredentialStore } from './credentialStore'

export interface AuthBackendFacts {
  /** The CLI path to run for `login` / `logout`, or the reason it is absent. */
  readonly resolveCli: () =>
    | { readonly ok: true; readonly cliPath: string }
    | { readonly ok: false; readonly reason: string }
  readonly credentialFileExists: () => boolean
  readonly hasEnvironmentKey: () => boolean
  /** Stop the running host so the next turn spawns it with fresh credentials. */
  readonly restartBackend: () => Promise<void>
}

export interface AuthServiceDeps {
  readonly backend: AuthBackendFacts
  readonly credentials: CredentialStore
  readonly runInTerminal: (cliPath: string, args: readonly string[]) => void
  /** Returns the pasted key, or undefined when the user dismissed the box. */
  readonly promptForApiKey: () => Promise<string | undefined>
  readonly broadcast: (message: HostToWebviewMessage) => void
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly log: Logger
}

export interface AuthSnapshot {
  readonly status: AuthStatus
  readonly detail: string | undefined
}

export class AuthService {
  private snapshot: AuthSnapshot = { status: 'checking', detail: undefined }

  public constructor(private readonly deps: AuthServiceDeps) {}

  private set(status: AuthStatus, detail: string | undefined): AuthSnapshot {
    this.snapshot = { status, detail }
    this.deps.broadcast(this.toMessage())
    return this.snapshot
  }

  public get current(): AuthSnapshot {
    return this.snapshot
  }

  public toMessage(): HostToWebviewMessage {
    return {
      type: 'authState',
      status: this.snapshot.status,
      ...(this.snapshot.detail !== undefined && { detail: this.snapshot.detail }),
    }
  }

  /** Re-derive the status from the CLI and credential facts, then broadcast. */
  public async refresh(): Promise<AuthSnapshot> {
    const cli = this.deps.backend.resolveCli()
    if (!cli.ok) {
      return this.set('noCli', cli.reason)
    }
    const status = deriveAuthStatus({
      hasStoredKey: (await this.deps.credentials.getApiKey()) !== undefined,
      hasEnvironmentKey: this.deps.backend.hasEnvironmentKey(),
      credentialFileExists: this.deps.backend.credentialFileExists(),
    })
    return this.set(status, undefined)
  }

  public async signIn(method: SignInMethod): Promise<AuthSnapshot> {
    const cli = this.deps.backend.resolveCli()
    if (!cli.ok) {
      return this.set('noCli', cli.reason)
    }
    if (method === 'apiKey') {
      const key = await this.deps.promptForApiKey()
      if (key === undefined) {
        return this.snapshot
      }
      await this.deps.credentials.setApiKey(key)
      await this.deps.backend.restartBackend()
      return this.set('signedIn', undefined)
    }
    this.set('signingIn', UI_TEXT.signInWaiting)
    const outcome = await signInWithBrowser({
      runLogin: () => {
        this.deps.runInTerminal(cli.cliPath, MUSE_LOGIN_ARGS)
      },
      credentialFileExists: () => Promise.resolve(this.deps.backend.credentialFileExists()),
      sleep: this.deps.sleep,
      now: this.deps.now,
      pollIntervalMs: CREDENTIAL_POLL_INTERVAL_MS,
      timeoutMs: CREDENTIAL_POLL_TIMEOUT_MS,
    })
    if (outcome === 'timedOut') {
      return this.set('signedOut', UI_TEXT.signInTimedOut)
    }
    await this.deps.backend.restartBackend()
    return this.set('signedIn', undefined)
  }

  public async signOut(): Promise<AuthSnapshot> {
    await this.deps.credentials.clearApiKey()
    const cli = this.deps.backend.resolveCli()
    if (cli.ok && this.deps.backend.credentialFileExists()) {
      this.deps.runInTerminal(cli.cliPath, MUSE_LOGOUT_ARGS)
    }
    await this.deps.backend.restartBackend()
    return this.set('signedOut', undefined)
  }

  /** The host answered a turn with `authRequired`: the estimate was wrong. */
  public markAuthRequired(reason: string): AuthSnapshot {
    this.deps.log.warn(`Muse Code reported authRequired: ${reason}`)
    return this.set('signedOut', reason)
  }

  public markBackendError(detail: string): AuthSnapshot {
    return this.set('error', detail)
  }
}
