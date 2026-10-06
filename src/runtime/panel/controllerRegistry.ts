import { RequestError } from '@agentclientprotocol/sdk'
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
  private readonly sessions = new Map<string, C>()
  private readonly adopting = new Map<string, C>()
  private readonly claims = new Map<string, ControllerClaim>()
  private readonly releasing = new Map<string, Promise<unknown>>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
  private readonly exitedHosts = new WeakSet<AgentHost>()

  public constructor(private readonly log: CoreLogger) {}

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
    const claim = { sessionId }
    this.claims.set(sessionId, claim)
    return claim
  }

  public ensureClaim(claim: ControllerClaim, host: AgentHost): void {
    if (this.claims.get(claim.sessionId) !== claim || this.exitedHosts.has(host))
      throw RequestError.resourceNotFound(claim.sessionId)
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
    try {
      this.ensureClaim(claim, host)
      await this.releaseAll(sessionId)
      this.ensureClaim(claim, host)
      controller = create()
      this.adopting.set(sessionId, controller)
      await prepare(controller)
      this.ensureClaim(claim, host)
      if (controller.isReleased) throw RequestError.resourceNotFound(sessionId)
    } catch (error: unknown) {
      if (controller === undefined) session.dispose()
      else await controller.release()
      this.abandonClaim(claim)
      throw error
    } finally {
      if (this.adopting.get(sessionId) === controller) this.adopting.delete(sessionId)
    }
    this.sessions.set(sessionId, controller)
    return controller
  }

  public held(sessionId: string): C | undefined {
    return this.sessions.get(sessionId)
  }

  public async closeSession(sessionId: string): Promise<void> {
    const wasClaimed = this.claims.delete(sessionId)
    const wasReleased = await this.releaseAll(sessionId)
    if (!wasClaimed && !wasReleased) throw RequestError.resourceNotFound(sessionId)
  }

  public watch(host: AgentHost): void {
    if (this.watchedHosts.has(host)) return
    this.watchedHosts.add(host)
    host.onExit((exit) => {
      this.exitedHosts.add(host)
      this.log.warn(`The ${host.info.kind} backend stopped: ${exit.description}`)
      for (const [sessionId, controller] of [...this.sessions, ...this.adopting]) {
        if (controller.host !== host) continue
        controller.hostExited(exit.description)
        this.claims.delete(sessionId)
        void this.releaseAll(sessionId)
      }
    })
  }
}
