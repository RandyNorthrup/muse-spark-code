// The panel's sign-in state (M104 lane B, D84, Rule 8): the backend's own
// readiness decides it, as it does for the ACP agent, and the person signs in
// where keys are entered, in their terminal: the editor opens a terminal on
// the trusted `auth set` or `login` command, and "Check again" asks the
// backend again. No key ever crosses MHP or this process.
import type { BackendKind } from '../../core/agent/agentBackend'
import type { AuthPort, AuthSnapshot } from '../../host/auth/authService'
import type { AcpBackend } from '../../acp/agent'
import { UI_TEXT } from '../../shared/constants'
import type { HostToWebviewMessage, SignInMethod } from '../../shared/protocol'

export interface RuntimeAuthDeps {
  readonly backend: Pick<AcpBackend, 'kind' | 'readiness'>
  /** Shows the state in every surface of the conversation. */
  readonly broadcast: (message: HostToWebviewMessage) => void
  /** The sign-in paths the gate offers for this backend. */
  readonly methods: readonly SignInMethod[]
  /** What the person types to install Muse Code. */
  readonly installCommand: string
  /** Opens the editor's terminal on the trusted command for `method`; it resolves once shown. */
  readonly startSignIn: (method: SignInMethod, signal: AbortSignal) => Promise<void>
}

export class RuntimeAuth implements AuthPort {
  private snapshot: AuthSnapshot
  private generation = 0
  private signIn_: AbortController | undefined

  public constructor(private readonly deps: RuntimeAuthDeps) {
    this.snapshot = {
      status: 'checking',
      detail: undefined,
      backend: deps.backend.kind,
      methods: deps.methods,
    }
  }

  private publish(status: AuthSnapshot['status'], detail: string | undefined): AuthSnapshot {
    this.snapshot = {
      status,
      detail,
      backend: this.deps.backend.kind,
      methods: this.deps.methods,
    }
    this.generation += 1
    this.deps.broadcast(this.toMessage())
    return this.snapshot
  }

  public get current(): AuthSnapshot {
    return this.snapshot
  }

  public get backend(): BackendKind {
    return this.deps.backend.kind
  }

  public get admissionGeneration(): number {
    return this.generation
  }

  public toMessage(): HostToWebviewMessage {
    return {
      type: 'authState',
      status: this.snapshot.status,
      ...(this.snapshot.detail !== undefined && { detail: this.snapshot.detail }),
      backend: this.deps.backend.kind,
      methods: [...this.deps.methods],
      installCommand: this.deps.installCommand,
    }
  }

  public async refresh(isAction = false): Promise<AuthSnapshot> {
    const readiness = await this.deps.backend.readiness(isAction)
    switch (readiness.state) {
      case 'ready': {
        return this.publish('signedIn', undefined)
      }
      case 'signedOut': {
        return this.publish('signedOut', readiness.message)
      }
      case 'unavailable': {
        return this.publish('error', readiness.message)
      }
    }
  }

  public checkAgain(): Promise<AuthSnapshot> {
    return this.refresh(true)
  }

  public async signIn(method: SignInMethod): Promise<AuthSnapshot> {
    this.signIn_?.abort()
    const flow = new AbortController()
    this.signIn_ = flow
    this.publish('signingIn', undefined)
    try {
      await this.deps.startSignIn(method, flow.signal)
    } catch (error: unknown) {
      // REPORTED: a sign-in that could not start leaves the gate as it was, with the reason.
      await this.refresh()
      throw error
    } finally {
      if (this.signIn_ === flow) this.signIn_ = undefined
    }
    // The key is typed in the terminal the editor opened; the person asks again when done.
    return this.publish('signedOut', undefined)
  }

  public cancelSignIn(): void {
    this.signIn_?.abort()
    this.generation += 1
  }

  public installMuseCode(): Promise<AuthSnapshot> {
    return Promise.reject(new Error(UI_TEXT.cliNotFound))
  }

  /** The key and the CLI's sign-in are kept where this process cannot end them for the person: said, with the commands. */
  public signOut(): Promise<AuthSnapshot> {
    return Promise.reject(new Error(UI_TEXT.signOutInTerminal))
  }

  public markAuthRequired(reason: string): AuthSnapshot {
    return this.publish('signedOut', reason)
  }

  public markBackendError(detail: string): AuthSnapshot {
    return this.publish('error', detail)
  }
}
