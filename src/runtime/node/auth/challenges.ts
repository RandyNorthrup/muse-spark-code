import { randomBytes, randomUUID } from 'node:crypto'
import {
  NODE_AUTH_RANDOM_BYTES,
  NODE_CHALLENGE_TTL_MS,
  NODE_MAX_CHALLENGES,
  NODE_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeClock } from '../../../shared/node'
import { nodeAuthChallengeSchema, type NodeAuthChallenge } from '../../../shared/nodeAuth'

interface Pending {
  challenge: NodeAuthChallenge
  deadline: number
  setupHash: string | null
}
export class NodeChallenges {
  private readonly pending = new Map<string, Pending>()
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

  private save(raw: unknown, setupHash: string | null): NodeAuthChallenge {
    const now = this.clock.monotonicMs()
    for (const [id, record] of this.pending) if (record.deadline <= now) this.pending.delete(id)
    if (this.pending.size >= NODE_MAX_CHALLENGES) throw new Error(UI_TEXT.nodeErrors.rateLimited)
    const challenge = nodeAuthChallengeSchema.parse(raw)
    this.pending.set(challenge.id, { challenge, deadline: now + NODE_CHALLENGE_TTL_MS, setupHash })
    return structuredClone(challenge)
  }

  issue(purpose: 'enroll' | 'signin', setupHash: string | null = null): NodeAuthChallenge {
    return this.save({ ...this.fields(), purpose }, setupHash)
  }

  stepUp(
    sessionId: string,
    action: Extract<NodeAuthChallenge, { purpose: 'stepUp' }>['action'],
    actionDigest: string,
  ): NodeAuthChallenge {
    return this.save({ ...this.fields(), purpose: 'stepUp', sessionId, action, actionDigest }, null)
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
