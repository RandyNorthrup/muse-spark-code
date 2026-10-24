// Who holds each live session in one runtime process (M104 lane B, D84): the
// ACP agent's sessions and the runtime panel's conversations both go through
// this one registry class, so a session has one owner, a newer load replaces
// an older one only after the old one stopped, and a backend that exits
// retires every session on it. It was the ACP agent's own bookkeeping
// (AgentState's maps), moved here unchanged; each view keeps its own turns.
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'

/** Identity of the latest load or resume; kept while earlier releases finish. */
export interface ControllerClaim {
  readonly sessionId: string
}

/** What the registry needs of a view: its host, and a way to let it go. */
export interface SessionController {
  readonly host: AgentHost
  readonly isReleased: boolean
  release(): Promise<unknown>
  /** The backend went away: the view ends what it runs with the reason. */
  hostExited(description: string): void
}

export interface ControllerRegistryOptions {
  /** The error a request for a session no one holds (or may hold) answers. */
  readonly missing: (sessionId: string) => Error
  /** A watched backend stopped, before its sessions are retired. */
  readonly hostStopped: (host: AgentHost, description: string) => void
  /** A session left the registry: the view's own per-session state goes with it. */
  readonly released?: (sessionId: string) => void
}

export class ControllerRegistry<C extends SessionController> {
  private readonly sessions = new Map<string, C>()
  /** Sessions being set up (`adopt`), by id: a newer load or a close lets them go too. */
  private readonly adopting = new Map<string, C>()
  private readonly claims = new Map<string, ControllerClaim>()
  /** Remains visible even when the session is no longer available for requests. */
  private readonly releasing = new Map<string, Promise<unknown>>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
  private readonly exitedHosts = new WeakSet<AgentHost>()

  public constructor(private readonly options: ControllerRegistryOptions) {}

  /** Claimed before backend I/O: a slow older load cannot replace a newer request. */
  public claim(sessionId: string): ControllerClaim {
    const claim = { sessionId }
    this.claims.set(sessionId, claim)
    return claim
  }

  public ensureClaim(claim: ControllerClaim, host: AgentHost): void {
    if (this.claims.get(claim.sessionId) !== claim || this.exitedHosts.has(host)) {
      throw this.options.missing(claim.sessionId)
    }
  }

  /** Lets a failed request's claim go, unless a newer request holds the id. */
  public abandon(claim: ControllerClaim): void {
    if (this.claims.get(claim.sessionId) === claim) {
      this.claims.delete(claim.sessionId)
    }
  }

  /**
  A backend session the view now owns, held only once `prepare` has set what
  the client is shown: until then no request finds it, and if anything fails
  the backend session is let go and the request fails, so no session
  outlives a request that returned no id. A session loaded again replaces
  the one held, and one still being set up by an earlier load: both stop
  following it (`release`) before anything runs on the new one.
  */
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
      // One shared barrier survives removal from the request maps. The
      // latest request alone can attach after the old turn is stopped.
      await this.releaseAll(sessionId)
      this.ensureClaim(claim, host)
      controller = create()
      this.adopting.set(sessionId, controller)
      await prepare(controller)
      this.ensureClaim(claim, host)
      if (controller.isReleased) {
        // A newer load of this session, or a close, let it go meanwhile.
        throw this.options.missing(sessionId)
      }
    } catch (error: unknown) {
      if (controller === undefined) {
        session.dispose()
      } else {
        await controller.release()
      }
      this.abandon(claim)
      throw error
    } finally {
      if (this.adopting.get(sessionId) === controller) {
        this.adopting.delete(sessionId)
      }
    }
    this.sessions.set(sessionId, controller)
    return controller
  }

  /** Whether `controller` is the one held, or being set up, under its id. */
  public isCurrent(sessionId: string, controller: C): boolean {
    return (
      this.sessions.get(sessionId) === controller || this.adopting.get(sessionId) === controller
    )
  }

  /** The session held under this id, if any (none while it is being set up). */
  public held(sessionId: string): C | undefined {
    return this.sessions.get(sessionId)
  }

  /** The session held under this id, or one being set up. */
  public heldOrAdopting(sessionId: string): C | undefined {
    return this.sessions.get(sessionId) ?? this.adopting.get(sessionId)
  }

  /** Every session held now. */
  public controllers(): Iterable<C> {
    return this.sessions.values()
  }

  /**
  Lets go of the session held for `sessionId` and one being set up, so no
  request finds either; resolves once each has stopped its turn and let
  its backend session go. False when there was neither.
  */
  public async releaseAll(sessionId: string): Promise<boolean> {
    const found = [this.sessions.get(sessionId), this.adopting.get(sessionId)].filter(
      (controller) => controller !== undefined,
    )
    this.sessions.delete(sessionId)
    this.adopting.delete(sessionId)
    this.options.released?.(sessionId)
    const previous = this.releasing.get(sessionId)
    if (previous === undefined && found.length === 0) {
      return false
    }
    const released = Promise.all([previous, ...found.map((controller) => controller.release())])
    this.releasing.set(sessionId, released)
    try {
      await released
    } finally {
      if (this.releasing.get(sessionId) === released) {
        this.releasing.delete(sessionId)
      }
    }
    return true
  }

  /** A client closes a session: the one held, or one still being set up. False when neither. */
  public async closeSession(sessionId: string): Promise<boolean> {
    const wasClaimed = this.claims.delete(sessionId)
    const wasReleased = await this.releaseAll(sessionId)
    return wasClaimed || wasReleased
  }

  /** Every session goes (a sign-out, or the process ending). */
  public async releaseEvery(): Promise<void> {
    this.claims.clear()
    for (const sessionId of [...this.sessions.keys(), ...this.adopting.keys()]) {
      await this.releaseAll(sessionId)
    }
  }

  /** Retires every session on `host` when it exits; once per host. */
  public watch(host: AgentHost): void {
    if (this.watchedHosts.has(host)) {
      return
    }
    this.watchedHosts.add(host)
    host.onExit((exit) => {
      this.exitedHosts.add(host)
      this.options.hostStopped(host, exit.description)
      for (const [sessionId, controller] of [...this.sessions, ...this.adopting]) {
        if (controller.host !== host) {
          continue
        }
        controller.hostExited(exit.description)
        this.claims.delete(sessionId)
        void this.releaseAll(sessionId)
      }
    })
  }
}
