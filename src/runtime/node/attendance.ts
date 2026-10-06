import {
  NODE_APPROVAL_TTL_MS,
  NODE_MAX_CHALLENGES,
  NODE_MAX_SESSIONS,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
  UI_TEXT,
} from '../../shared/constants'
import type { NodeClock } from '../../shared/node'
import { nodeSessionSchema, type NodeSession } from '../../shared/nodeAuth'

export interface NodeRunPolicy {
  readonly mode: 'plan' | 'acceptEdits' | 'bypass'
  readonly paid: boolean
  readonly budgetUsd: number | undefined
  readonly protectedPath: boolean
  readonly requiresAsking: boolean
  readonly makerAction: 'offline' | 'observe' | 'connect' | 'program' | 'actuate'
}

/** A1 calls attach only after authentication; public session data is not a proof. */
export class NodeAttendance {
  private readonly attached = new Map<
    string,
    { session: NodeSession; verifiedAt: number; lastActivityAt: number }
  >()
  private readonly asks = new Map<
    string,
    {
      digest: string
      finish: (isAllowed: boolean) => void
      timer: ReturnType<typeof setTimeout>
      signal: AbortSignal
      abort: () => void
      deadline: number
    }
  >()

  constructor(
    private readonly clock: NodeClock,
    private readonly ownerId: string,
  ) {}

  private finish(id: string, isAllowed: boolean): void {
    const ask = this.asks.get(id)
    if (ask === undefined) return
    this.asks.delete(id)
    clearTimeout(ask.timer)
    ask.signal.removeEventListener('abort', ask.abort)
    ask.finish(isAllowed)
  }

  private remaining(item: { verifiedAt: number; lastActivityAt: number }, now: number): number {
    return Math.min(
      NODE_SESSION_IDLE_MS,
      NODE_SESSION_MAX_MS,
      NODE_SESSION_IDLE_MS - (now - item.lastActivityAt),
      NODE_SESSION_MAX_MS - (now - item.verifiedAt),
    )
  }

  sessions(): NodeSession[] {
    const now = this.clock.monotonicMs()
    // A1 detaches expired identities. Retain anchors until then so a repeated
    // verification cannot restart the absolute limit after sessions() is read.
    const sessions: NodeSession[] = []
    for (const item of this.attached.values()) {
      if (this.remaining(item, now) > 0) sessions.push(structuredClone(item.session))
    }
    return sessions
  }

  attach(input: NodeSession): void {
    const session = nodeSessionSchema.parse(input)
    const wallNow = this.clock.now()
    if (
      session.ownerId !== this.ownerId ||
      session.createdAt > wallNow ||
      session.lastSeenAt > wallNow ||
      session.idleExpiresAt <= wallNow ||
      session.absoluteExpiresAt <= wallNow
    )
      throw new Error(UI_TEXT.nodeErrors.expired)
    if (!this.attached.has(session.id) && this.attached.size >= NODE_MAX_SESSIONS) {
      throw new Error(UI_TEXT.nodeErrors.tooLarge)
    }
    const current = this.attached.get(session.id)
    if (current !== undefined && current.session.createdAt !== session.createdAt) {
      throw new Error(UI_TEXT.nodeErrors.conflict)
    }
    const now = this.clock.monotonicMs()
    if (current !== undefined && this.remaining(current, now) <= 0)
      throw new Error(UI_TEXT.nodeErrors.expired)
    this.attached.set(session.id, {
      session,
      verifiedAt: current?.verifiedAt ?? now,
      lastActivityAt: now,
    })
  }

  detach(id: string): void {
    this.attached.delete(id)
  }

  endAll(): void {
    this.attached.clear()
    for (const id of this.asks.keys()) this.finish(id, false)
  }

  assertRunAllowed(policy: NodeRunPolicy): void {
    if (this.sessions().length > 0) return
    if (
      policy.mode === 'bypass' ||
      policy.protectedPath ||
      policy.requiresAsking ||
      !['offline', 'observe'].includes(policy.makerAction) ||
      (policy.paid &&
        (policy.budgetUsd === undefined ||
          !Number.isFinite(policy.budgetUsd) ||
          policy.budgetUsd <= 0))
    )
      throw new Error(UI_TEXT.nodeErrors.forbidden)
  }

  /** No attachment does not answer an ask: only an exact human reply can allow it. */
  ask(id: string, digest: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    if (this.asks.has(id) || this.asks.size >= NODE_MAX_CHALLENGES) {
      throw new Error(UI_TEXT.nodeErrors.tooLarge)
    }
    return new Promise((resolve) => {
      const abort = () => {
        this.finish(id, false)
      }
      const timer = setTimeout(() => {
        this.finish(id, false)
      }, NODE_APPROVAL_TTL_MS)
      this.asks.set(id, {
        digest,
        finish: resolve,
        timer,
        signal,
        abort,
        deadline: this.clock.monotonicMs() + NODE_APPROVAL_TTL_MS,
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  answer(sessionId: string, id: string, digest: string, isAllowed: boolean): void {
    if (this.sessions().every((session) => session.id !== sessionId)) {
      throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    }
    const ask = this.asks.get(id)
    if (ask?.digest !== digest) throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    if (this.clock.monotonicMs() >= ask.deadline) {
      this.finish(id, false)
      throw new Error(UI_TEXT.nodeErrors.expired)
    }
    this.finish(id, isAllowed)
  }
}
