import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  NODE_AUTH_RANDOM_BYTES,
  NODE_MAX_SESSIONS,
  NODE_MAX_CHALLENGES,
  NODE_PROTOCOL_VERSION,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
  NODE_STEP_UP_TTL_MS,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeClock } from '../../../shared/node'
import {
  nodeSessionSchema,
  nodeStepUpSchema,
  nodeTokenSchema,
  type NodeAuthentication,
  type NodeSession,
  type NodeStepUp,
} from '../../../shared/nodeAuth'
import type { NodeListenerVerifier } from '../listenerGuard'

interface SessionRecord {
  session: NodeSession
  tokenHash: string
  started: number
  touched: number
  controller: AbortController
  timer: ReturnType<typeof setTimeout> | undefined
}
interface ProofRecord {
  proof: NodeStepUp
  deadline: number
}
export interface NodeVerificationTime {
  time: number
  monotonicMs: number
}
export interface NodeSessionLifecycle {
  attached(session: NodeSession): void
  ended(sessionId: string): void
}
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** consumeStepUp rejects with session or proof failures; the proof is already failed closed. */
export function isFailedProof(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      UI_TEXT.nodeErrors.expired,
      UI_TEXT.nodeErrors.unauthenticated,
      UI_TEXT.nodeErrors.stepUpRequired,
    ].includes(error.message)
  )
}

/** Only memory holds capabilities. Session IDs are public metadata, never credentials. */
export class NodeMemorySessions implements NodeListenerVerifier {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly tokens = new Map<string, string>()
  private readonly proofs = new Map<string, ProofRecord>()
  constructor(
    private readonly clock: NodeClock,
    private readonly ownerId: string,
    private readonly lifecycle: NodeSessionLifecycle,
    private readonly report: (error: unknown) => void,
  ) {}

  private required(id: string): SessionRecord {
    const record = this.sessions.get(id)
    if (record === undefined) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    const now = this.clock.monotonicMs()
    if (
      now < record.touched ||
      now - record.touched >= NODE_SESSION_IDLE_MS ||
      now - record.started >= NODE_SESSION_MAX_MS
    ) {
      this.end(id)
      throw new Error(UI_TEXT.nodeErrors.expired)
    }
    return record
  }

  private schedule(record: SessionRecord): void {
    clearTimeout(record.timer)
    const now = this.clock.monotonicMs()
    record.timer = setTimeout(
      () => {
        try {
          this.required(record.session.id)
          this.schedule(record)
        } catch (error: unknown) {
          // required() already detached the expired session; lifecycle failures are reported.
          if (!isFailedProof(error)) this.report(error)
        }
      },
      Math.min(record.started + NODE_SESSION_MAX_MS, record.touched + NODE_SESSION_IDLE_MS) - now,
    )
    record.timer.unref()
  }

  private prune(): void {
    for (const id of this.sessions.keys()) {
      try {
        this.required(id)
      } catch (error: unknown) {
        // Missing or expired sessions are already detached; creation fails loudly otherwise.
        if (!isFailedProof(error)) throw error
      }
    }
    for (const [id, record] of this.proofs)
      if (record.deadline <= this.clock.monotonicMs()) this.proofs.delete(id)
  }

  create(): NodeAuthentication {
    this.prune()
    if (this.sessions.size >= NODE_MAX_SESSIONS) throw new Error(UI_TEXT.nodeErrors.rateLimited)
    const now = this.clock.now()
    const bearer = randomBytes(NODE_AUTH_RANDOM_BYTES).toString('base64url')
    const session = nodeSessionSchema.parse({
      v: NODE_PROTOCOL_VERSION,
      id: randomUUID(),
      ownerId: this.ownerId,
      surface: 'web',
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: now + NODE_SESSION_IDLE_MS,
      absoluteExpiresAt: now + NODE_SESSION_MAX_MS,
    })
    const record: SessionRecord = {
      session,
      tokenHash: tokenHash(bearer),
      started: this.clock.monotonicMs(),
      touched: this.clock.monotonicMs(),
      controller: new AbortController(),
      timer: undefined,
    }
    this.sessions.set(session.id, record)
    this.tokens.set(record.tokenHash, session.id)
    try {
      this.lifecycle.attached(structuredClone(session))
      this.schedule(record)
    } catch (error: unknown) {
      this.end(session.id)
      throw error
    }
    return { session: structuredClone(session), bearer }
  }

  verifyBearer(bearer: string, signal: AbortSignal): Promise<NodeSession> {
    signal.throwIfAborted()
    nodeTokenSchema.parse(bearer)
    const id = this.tokens.get(tokenHash(bearer))
    if (id === undefined) return Promise.reject(new Error(UI_TEXT.nodeErrors.unauthenticated))
    const record = this.required(id)
    record.touched = this.clock.monotonicMs()
    // Wall-clock jumps cannot stretch deadlines or invalidate monotonic session state.
    const displayed = record.session.createdAt + Math.floor(record.touched - record.started)
    const remaining = NODE_SESSION_MAX_MS - (record.touched - record.started)
    record.session = nodeSessionSchema.parse({
      ...record.session,
      lastSeenAt: Math.min(displayed, record.session.absoluteExpiresAt - 1),
      idleExpiresAt: Math.min(
        displayed + Math.min(NODE_SESSION_IDLE_MS, remaining),
        record.session.absoluteExpiresAt,
      ),
    })
    try {
      this.lifecycle.attached(structuredClone(record.session))
      this.schedule(record)
    } catch (error: unknown) {
      this.end(record.session.id)
      throw error
    }
    return Promise.resolve(structuredClone(record.session))
  }

  sessionSignal(sessionId: string): AbortSignal {
    return this.required(sessionId).controller.signal
  }

  issueProof(
    sessionId: string,
    action: NodeStepUp['action'],
    actionDigest: string,
    verification?: NodeVerificationTime,
  ): NodeStepUp {
    const verified = verification ?? {
      time: this.clock.now(),
      monotonicMs: this.clock.monotonicMs(),
    }
    this.required(sessionId)
    this.prune()
    if (this.proofs.size >= NODE_MAX_CHALLENGES) throw new Error(UI_TEXT.nodeErrors.rateLimited)
    const elapsed = this.clock.monotonicMs() - verified.monotonicMs
    if (elapsed < 0 || elapsed >= NODE_STEP_UP_TTL_MS) throw new Error(UI_TEXT.nodeErrors.expired)
    const now = verified.time
    const proof = nodeStepUpSchema.parse({
      id: randomUUID(),
      sessionId,
      action,
      actionDigest,
      verifiedAt: now,
      expiresAt: now + NODE_STEP_UP_TTL_MS,
    })
    this.proofs.set(proof.id, { proof, deadline: verified.monotonicMs + NODE_STEP_UP_TTL_MS })
    return structuredClone(proof)
  }

  consumeStepUp(
    binding: { sessionId: string; id: string; action: NodeStepUp['action']; actionDigest: string },
    signal: AbortSignal,
  ): Promise<NodeStepUp> {
    signal.throwIfAborted()
    this.required(binding.sessionId)
    const record = this.proofs.get(binding.id)
    // A mismatched attempt also burns the proof; no async gap can consume twice.
    this.proofs.delete(binding.id)
    return record === undefined ||
      record.deadline <= this.clock.monotonicMs() ||
      record.proof.sessionId !== binding.sessionId ||
      record.proof.action !== binding.action ||
      record.proof.actionDigest !== binding.actionDigest
      ? Promise.reject(new Error(UI_TEXT.nodeErrors.stepUpRequired))
      : Promise.resolve(structuredClone(record.proof))
  }

  end(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (record === undefined) return
    record.controller.abort()
    clearTimeout(record.timer)
    this.sessions.delete(sessionId)
    this.tokens.delete(record.tokenHash)
    for (const [id, entry] of this.proofs)
      if (entry.proof.sessionId === sessionId) this.proofs.delete(id)
    this.lifecycle.ended(sessionId)
  }

  endAll(): void {
    let isFailed = false
    for (const id of this.sessions.keys()) {
      try {
        this.end(id)
      } catch (error: unknown) {
        // Detach failures are reported per session; endAll still throws unavailable below.
        this.report(error)
        isFailed = true
      }
    }
    this.proofs.clear()
    if (isFailed) throw new Error(UI_TEXT.nodeErrors.unavailable)
  }
}
