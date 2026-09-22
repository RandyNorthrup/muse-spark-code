// Credential state for both backends, shared by every surface (PLAN.md D1,
// M7). The backend selection decides which credential counts: the Muse
// Code CLI's own sign-in (subscription) for the CLI backend, the pasted
// Model API key for the Model API backend; they are never mixed. `status`
// is the presence-based estimate; a backend's own `authRequired` turn error
// overrides it through `markAuthRequired`. All VS Code interactions
// (terminals, input boxes) are injected so the flow is unit-tested end to end.

import { selectBackend } from '../../core/backendSelection'
import type { BackendKind } from '../../core/agent/agentBackend'
import {
  type BackendMode,
  CREDENTIAL_POLL_INTERVAL_MS,
  CREDENTIAL_POLL_TIMEOUT_MS,
  MUSE_LOGIN_ARGS,
  MUSE_LOGOUT_ARGS,
  UI_TEXT,
} from '../../shared/constants'
import type { AuthStatus, HostToWebviewMessage, SignInMethod } from '../../shared/protocol'
import type { Logger } from '../logger'
import { signInWithBrowser } from './browserSignIn'
import type { CredentialStore } from './credentialStore'

export interface AuthBackendFacts {
  /** The CLI path to run for `login` / `logout`, or the reason it is absent. */
  readonly resolveCli: () =>
    | { readonly ok: true; readonly cliPath: string }
    | { readonly ok: false; readonly reason: string }
  readonly credentialFileExists: () => boolean
  readonly hasEnvironmentKey: () => boolean
  /** `museSpark.backend`. */
  readonly getBackendMode: () => BackendMode
  /** Stop the running hosts so the next turn spawns the right one afresh. */
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
  /** The backend the window uses (known once the facts are in). */
  readonly backend?: BackendKind | undefined
  /** The sign-in paths the gate offers. */
  readonly methods?: readonly SignInMethod[] | undefined
}

export class AuthService {
  private snapshot: AuthSnapshot = { status: 'checking', detail: undefined }

  public constructor(private readonly deps: AuthServiceDeps) {}

  private set(snapshot: AuthSnapshot): AuthSnapshot {
    this.snapshot = snapshot
    this.deps.broadcast(this.toMessage())
    return this.snapshot
  }

  /** The backend selection from the current facts. */
  private async choose() {
    const cli = this.deps.backend.resolveCli()
    return {
      cli,
      choice: selectBackend({
        setting: this.deps.backend.getBackendMode(),
        hasCli: cli.ok,
        hasCliSession:
          this.deps.backend.credentialFileExists() || this.deps.backend.hasEnvironmentKey(),
        hasStoredKey: (await this.deps.credentials.getApiKey()) !== undefined,
      }),
    }
  }

  public get current(): AuthSnapshot {
    return this.snapshot
  }

  /** The backend the next conversation runs on; undefined without any credential. */
  public get backend(): BackendKind | undefined {
    return this.snapshot.backend
  }

  public toMessage(): HostToWebviewMessage {
    return {
      type: 'authState',
      status: this.snapshot.status,
      ...(this.snapshot.detail !== undefined && { detail: this.snapshot.detail }),
      ...(this.snapshot.backend !== undefined && { backend: this.snapshot.backend }),
      ...(this.snapshot.methods !== undefined && { methods: [...this.snapshot.methods] }),
    }
  }

  /** Re-derive the status from the CLI, credential and setting facts, then broadcast. */
  public async refresh(): Promise<AuthSnapshot> {
    const { cli, choice } = await this.choose()
    if (choice.kind === undefined) {
      return this.set({
        status: 'noCli',
        detail: cli.ok ? undefined : cli.reason,
        backend: undefined,
        methods: choice.methods,
      })
    }
    return this.set({
      status: choice.status,
      detail: undefined,
      backend: choice.kind,
      methods: choice.methods,
    })
  }

  public async signIn(method: SignInMethod): Promise<AuthSnapshot> {
    if (method === 'apiKey') {
      const key = await this.deps.promptForApiKey()
      if (key === undefined) {
        return this.snapshot
      }
      await this.deps.credentials.setApiKey(key)
      await this.deps.backend.restartBackend()
      return await this.refresh()
    }
    const cli = this.deps.backend.resolveCli()
    if (!cli.ok) {
      return this.set({ ...this.snapshot, status: 'noCli', detail: cli.reason })
    }
    this.set({ ...this.snapshot, status: 'signingIn', detail: UI_TEXT.signInWaiting })
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
      return this.set({ ...this.snapshot, status: 'signedOut', detail: UI_TEXT.signInTimedOut })
    }
    await this.deps.backend.restartBackend()
    return await this.refresh()
  }

  public async signOut(): Promise<AuthSnapshot> {
    await this.deps.credentials.clearApiKey()
    const cli = this.deps.backend.resolveCli()
    if (cli.ok && this.deps.backend.credentialFileExists()) {
      this.deps.runInTerminal(cli.cliPath, MUSE_LOGOUT_ARGS)
    }
    await this.deps.backend.restartBackend()
    return this.set({ ...this.snapshot, status: 'signedOut', detail: undefined })
  }

  /** The backend answered a turn with `authRequired`: the estimate was wrong. */
  public markAuthRequired(reason: string): AuthSnapshot {
    this.deps.log.warn(`The backend reported authRequired: ${reason}`)
    return this.set({ ...this.snapshot, status: 'signedOut', detail: reason })
  }

  public markBackendError(detail: string): AuthSnapshot {
    return this.set({ ...this.snapshot, status: 'error', detail })
  }
}
