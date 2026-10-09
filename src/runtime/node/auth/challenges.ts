import { randomBytes, randomUUID } from 'node:crypto'
import {
  NODE_AUTH_RANDOM_BYTES,
  NODE_CHALLENGE_TTL_MS,
  NODE_SOURCE_CHALLENGES,
  NODE_SIGNIN_CHALLENGES,
  NODE_STEP_UP_CHALLENGES,
  NODE_CHALLENGE_BACKOFF_MS,
  NODE_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeClock } from '../../../shared/node'
import { nodeAuthChallengeSchema, type NodeAuthChallenge } from '../../../shared/nodeAuth'
import { NodeListenerError } from '../listenerGuard'

interface Pending {
  challenge: NodeAuthChallenge
  deadline: number
  setupHash: string | null
  source: string
}
export class NodeChallenges {
  private readonly pending = new Map<string, Pending>()
  private readonly retryAt = { signin: 0, stepUp: 0 }
  constructor(
    private readonly clock: NodeClock,
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  private fields() {
    const issuedAt = this.clock.now()
    return {
      v: NODE_PROTOCOL_VERSION,
      id: randomUUID(),
      challenge: randomBytes(NODE_AUTH_RANDOM_BYTES).toString('base64url'),
      rpId: this.rpId,
      origin: this.origin,
      issuedAt,
      expiresAt: issuedAt + NODE_CHALLENGE_TTL_MS,
    }
  }

  private save(raw: unknown, setupHash: string | null, source: string): NodeAuthChallenge {
    const now = this.clock.monotonicMs()
    for (const [id, record] of this.pending) if (record.deadline <= now) this.pending.delete(id)
    const challenge = nodeAuthChallengeSchema.parse(raw)
    const purpose = challenge.purpose
    let count = 0
    let sourceCount = 0
    for (const record of this.pending.values()) {
      if (record.challenge.purpose !== purpose) continue
      count += 1
      if (record.source === source) sourceCount += 1
    }
    const limit = {
      signin: NODE_SIGNIN_CHALLENGES,
      stepUp: NODE_STEP_UP_CHALLENGES,
      enroll: NODE_SOURCE_CHALLENGES,
    }[purpose]
    if (
      count >= limit ||
      sourceCount >= NODE_SOURCE_CHALLENGES ||
      (purpose !== 'enroll' && now < this.retryAt[purpose])
    )
      throw new NodeListenerError('rateLimited')
    // Enrollment has already proved the console code. Its reserved slots and
    // separate budget cannot be consumed by sign-in or authenticated step-up.
    if (purpose !== 'enroll') this.retryAt[purpose] = now + NODE_CHALLENGE_BACKOFF_MS
    this.pending.set(challenge.id, {
      challenge,
      deadline: now + NODE_CHALLENGE_TTL_MS,
      setupHash,
      source,
    })
    return structuredClone(challenge)
  }

  issue(
    purpose: 'enroll' | 'signin',
    source: string,
    setupHash: string | null = null,
  ): NodeAuthChallenge {
    return this.save({ ...this.fields(), purpose }, setupHash, source)
  }

  stepUp(
    sessionId: string,
    action: Extract<NodeAuthChallenge, { purpose: 'stepUp' }>['action'],
    actionDigest: string,
    source: string,
  ): NodeAuthChallenge {
    return this.save(
      { ...this.fields(), purpose: 'stepUp', sessionId, action, actionDigest },
      null,
      source,
    )
  }

  take(id: string, purpose: NodeAuthChallenge['purpose']): Pending {
    const record = this.pending.get(id)
    this.pending.delete(id)
    if (
      record === undefined ||
      record.deadline <= this.clock.monotonicMs() ||
      record.challenge.purpose !== purpose
    )
      throw new Error(UI_TEXT.nodeErrors.expired)
    return record
  }

  clear(): void {
    this.pending.clear()
  }
  end(sessionId: string): void {
    for (const [id, record] of this.pending)
      if (record.challenge.purpose === 'stepUp' && record.challenge.sessionId === sessionId)
        this.pending.delete(id)
  }
}
