import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import type { CoreLogger } from '../../core/logging'

/** Identity of the newest request, retained while an older release drains. */
export interface ControllerClaim {
  readonly sessionId: string
}

/** Views adapt protocols; the registry alone owns their session lifetimes. */
export interface SessionController {
  readonly sessionId: string
  readonly host: AgentHost
  readonly isReleased: boolean
  release(): Promise<void>
  hostExited(description: string): void
}

export class ControllerRegistry<C extends SessionController> {
  private isClosed = false
  private readonly sessions = new Map<string, C>()
  private readonly adopting = new Map<string, C>()
  private readonly claims = new Map<string, ControllerClaim>()
  private readonly releasing = new Map<string, Promise<unknown>>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
  private readonly exitedHosts = new WeakSet<AgentHost>()

  public constructor(
    private readonly log: CoreLogger,
    private readonly missing: (sessionId: string) => Error = () =>
      new Error('MHP_SESSION_NOT_FOUND'),
  ) {}

  /** Remove immediately; a shared barrier prevents a new view racing the old stop. */
  private async releaseAll(sessionId: string): Promise<boolean> {
    const found = [this.sessions.get(sessionId), this.adopting.get(sessionId)].filter(
      (controller) => controller !== undefined,
    )
    this.sessions.delete(sessionId)
    this.adopting.delete(sessionId)
    const previous = this.releasing.get(sessionId)
    if (previous === undefined && found.length === 0) return false
    const released = Promise.all([previous, ...found.map((controller) => controller.release())])
    this.releasing.set(sessionId, released)
    try {
      await released
    } finally {
      if (this.releasing.get(sessionId) === released) this.releasing.delete(sessionId)
    }
    return true
  }

  public claimSession(sessionId: string): ControllerClaim {
    if (this.isClosed) throw this.missing(sessionId)
    const claim = { sessionId }
    this.claims.set(sessionId, claim)
    return claim
  }

  public ensureClaim(claim: ControllerClaim, host: AgentHost): void {
    if (this.claims.get(claim.sessionId) !== claim || this.exitedHosts.has(host))
      throw this.missing(claim.sessionId)
  }

  public abandonClaim(claim: ControllerClaim): void {
    if (this.claims.get(claim.sessionId) === claim) this.claims.delete(claim.sessionId)
  }

  /** Publish only a prepared controller; failed or superseded requests keep no session. */
  public async adopt(
    host: AgentHost,
    session: AgentSession,
    claim: ControllerClaim,
    create: () => C,
    prepare: (controller: C) => Promise<void>,
  ): Promise<C> {
    const { sessionId } = session
    let controller: C | undefined
    let isControllerBound = false
    try {
      if (claim.sessionId !== sessionId) throw this.missing(claim.sessionId)
      this.ensureClaim(claim, host)
      await this.releaseAll(sessionId)
      this.ensureClaim(claim, host)
      controller = create()
      if (controller.sessionId !== sessionId || controller.host !== host)
        throw this.missing(sessionId)
      isControllerBound = true
      this.adopting.set(sessionId, controller)
      await prepare(controller)
      this.ensureClaim(claim, host)
      if (controller.isReleased) throw this.missing(sessionId)
    } catch (error: unknown) {
      if (controller === undefined || !isControllerBound) session.dispose()
      if (controller !== undefined) await controller.release()
      this.abandonClaim(claim)
      throw error
    } finally {
      if (this.adopting.get(sessionId) === controller) this.adopting.delete(sessionId)
    }
    this.sessions.set(sessionId, controller)
    return controller
  }

  public controllers(): Iterable<C> {
    return this.sessions.values()
  }

  /** Transfer ownership without mutating any existing carrier binding. */
  public rebind(previousId: string, sessionId: string, controller: C): void {
    if (
      this.isClosed ||
      this.exitedHosts.has(controller.host) ||
      this.sessions.get(previousId) !== controller ||
      controller.isReleased ||
      controller.sessionId !== sessionId ||
      this.sessions.has(sessionId) ||
      this.adopting.has(sessionId) ||
      this.releasing.has(sessionId)
    )
      throw this.missing(sessionId)
    this.sessions.delete(previousId)
    this.claims.delete(previousId)
    this.claims.set(sessionId, { sessionId })
    this.sessions.set(sessionId, controller)
  }

  public async close(): Promise<void> {
    this.isClosed = true
    this.claims.clear()
    const ids = new Set([
      ...this.sessions.keys(),
      ...this.adopting.keys(),
      ...this.releasing.keys(),
    ])
    const errors: unknown[] = []
    for (const id of ids) {
      try {
        await this.releaseAll(id)
      } catch (error: unknown) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'MHP_REGISTRY_RELEASE_FAILED')
  }

  public held(sessionId: string): C | undefined {
    return this.sessions.get(sessionId)
  }

  public async closeSession(sessionId: string): Promise<void> {
    const wasClaimed = this.claims.delete(sessionId)
    const wasReleased = await this.releaseAll(sessionId)
    if (!wasClaimed && !wasReleased) throw this.missing(sessionId)
  }

  public watch(host: AgentHost): void {
    if (this.watchedHosts.has(host)) return
    this.watchedHosts.add(host)
    host.onExit((exit) => {
      this.exitedHosts.add(host)
      this.log.warn(`MHP_BACKEND_STOPPED ${host.info.kind}`)
      for (const [sessionId, controller] of [...this.sessions, ...this.adopting]) {
        if (controller.host !== host) continue
        controller.hostExited(exit.description)
        this.claims.delete(sessionId)
        void this.releaseAll(sessionId).catch(() => {
          this.log.error('MHP_REGISTRY_RELEASE_FAILED')
        })
      }
    })
  }
}
