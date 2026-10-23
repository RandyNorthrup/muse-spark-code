import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import * as z from 'zod/mini'
import {
  NODE_CHALLENGE_NONCE_BYTES,
  NODE_CHALLENGE_KEY_BYTES,
  NODE_CHALLENGE_TTL_MS,
  NODE_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../../shared/constants'
import type { NodeClock } from '../../../shared/node'
import {
  nodeAuthChallengeSchema,
  nodeChallengeTokenSchema,
  nodeDigestSchema,
  nodeTokenSchema,
  type NodeAuthChallenge,
} from '../../../shared/nodeAuth'

const payloadSchema = z.strictObject({
  challenge: nodeAuthChallengeSchema,
  issuedMono: z.number().check(z.nonnegative()),
  epoch: nodeTokenSchema,
  setupHash: z.nullable(nodeDigestSchema),
})
type VerifiedChallenge = z.infer<typeof payloadSchema> & { deadline: number; nonce: string }

/** Unproved challenges retain nothing. Only successful proofs enter the expiry set. */
export class NodeChallenges {
  private readonly consumed = new Map<string, number>()
  private epoch = randomBytes(NODE_CHALLENGE_KEY_BYTES).toString('base64url')
  private readonly key: Buffer
  constructor(
    private readonly clock: NodeClock,
    private readonly rpId: string,
    private readonly origin: string,
    key: Uint8Array,
  ) {
    if (key.byteLength !== NODE_CHALLENGE_KEY_BYTES) throw new Error(UI_TEXT.nodeErrors.unavailable)
    this.key = Buffer.from(key)
  }

  private prune(): void {
    for (const [nonce, deadline] of this.consumed)
      if (deadline <= this.clock.monotonicMs()) this.consumed.delete(nonce)
  }

  private issueFields(raw: unknown, setupHash: string | null): NodeAuthChallenge {
    this.prune()
    const challenge = nodeAuthChallengeSchema.parse(raw)
    const payload = Buffer.from(
      JSON.stringify(
        payloadSchema.parse({
          challenge,
          issuedMono: this.clock.monotonicMs(),
          epoch: this.epoch,
          setupHash,
        }),
      ),
    )
    const mac = createHmac('sha256', this.key).update(payload).digest()
    const token = nodeChallengeTokenSchema.parse(
      Buffer.concat([payload, mac]).toString('base64url'),
    )
    // WebAuthn signs the complete authenticated token, including its purpose
    // and bindings. The browser echoes it through the existing opaque id.
    return { ...challenge, id: token, challenge: token }
  }

  private fields() {
    const issuedAt = this.clock.now()
    const nonce = randomBytes(NODE_CHALLENGE_NONCE_BYTES).toString('base64url')
    return {
      v: NODE_PROTOCOL_VERSION,
      id: nonce,
      challenge: nonce,
      rpId: this.rpId,
      origin: this.origin,
      issuedAt,
      expiresAt: issuedAt + NODE_CHALLENGE_TTL_MS,
    }
  }

  issue(purpose: 'enroll' | 'signin', setupHash: string | null = null): NodeAuthChallenge {
    return this.issueFields({ ...this.fields(), purpose }, setupHash)
  }

  stepUp(
    sessionId: string,
    action: Extract<NodeAuthChallenge, { purpose: 'stepUp' }>['action'],
    actionDigest: string,
  ): NodeAuthChallenge {
    return this.issueFields(
      { ...this.fields(), purpose: 'stepUp', sessionId, action, actionDigest },
      null,
    )
  }

  verify(id: string, purpose: NodeAuthChallenge['purpose']): VerifiedChallenge {
    this.prune()
    const bytes = Buffer.from(nodeChallengeTokenSchema.parse(id), 'base64url')
    const payload = bytes.subarray(0, -NODE_CHALLENGE_KEY_BYTES)
    const mac = bytes.subarray(-NODE_CHALLENGE_KEY_BYTES)
    const expected = createHmac('sha256', this.key).update(payload).digest()
    if (mac.length !== expected.length || !timingSafeEqual(mac, expected))
      throw new Error(UI_TEXT.nodeErrors.unauthenticated)
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    const record = payloadSchema.parse(raw)
    const challenge = record.challenge
    const deadline = record.issuedMono + NODE_CHALLENGE_TTL_MS
    if (
      record.epoch !== this.epoch ||
      challenge.purpose !== purpose ||
      challenge.rpId !== this.rpId ||
      challenge.origin !== this.origin ||
      challenge.expiresAt - challenge.issuedAt !== NODE_CHALLENGE_TTL_MS ||
      challenge.issuedAt > this.clock.now() ||
      challenge.expiresAt <= this.clock.now() ||
      record.issuedMono > this.clock.monotonicMs() ||
      deadline <= this.clock.monotonicMs() ||
      this.consumed.has(challenge.id)
    )
      throw new Error(UI_TEXT.nodeErrors.expired)
    return {
      ...record,
      deadline,
      nonce: challenge.id,
      challenge: { ...challenge, id, challenge: id },
    }
  }

  consume(record: VerifiedChallenge): void {
    // Revalidate after asynchronous proof work, then retain only the nonce.
    const verified = this.verify(record.challenge.id, record.challenge.purpose)
    this.consumed.set(verified.nonce, verified.deadline)
  }

  clear(): void {
    this.epoch = randomBytes(NODE_CHALLENGE_KEY_BYTES).toString('base64url')
    this.consumed.clear()
  }
}
