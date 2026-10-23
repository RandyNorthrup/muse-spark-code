// M100 phase 2 lane R (G27): content-addressed results with durable receipts.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  canQueueResultAck,
  deviceAttemptIdentitySchema,
  deviceResultAckSchema,
  deviceResultEnvelopeSchema,
  isAckForEnvelope,
  isSameAttempt,
  type DeviceAttemptIdentity,
  type DeviceResultAck,
  type DeviceResultEnvelope,
  type DeviceResultPort,
} from '../../shared/devices'
import { deviceEpochSchema, type DeviceEpochState } from './epochs'

export type DeviceResultRefusal = 'capacity' | 'payload-changed' | 'storage' | 'uncertain'

async function settleResultOperation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (error) {
    // The channel's own typed failure is already recorded for the awaiting
    // caller; anything else poisons the queue so later work fails loudly
    // instead of building on unknown state.
    if (error instanceof DeviceResultError) return
    throw error
  }
}

export class DeviceResultError extends Error {
  public constructor(
    public readonly reason: DeviceResultRefusal,
    options?: { cause?: unknown },
  ) {
    super(reason, options)
    this.name = 'DeviceResultError'
  }
}

const receiptSchema = z.strictObject({
  envelope: deviceResultEnvelopeSchema,
  ack: deviceResultAckSchema,
})

/** Permanent receipts prevent reacceptance or timestamp drift after reconnect. */
export const deviceResultRecordSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    identity: deviceAttemptIdentitySchema,
    receipts: z.array(receiptSchema).check(z.minLength(1)),
  })
  .check(
    z.refine((record) => {
      const epochs = record.receipts.map((receipt) => receipt.envelope.epoch)
      return (
        new Set(epochs).size === epochs.length &&
        record.receipts.every(
          ({ envelope, ack }) =>
            isSameAttempt(record.identity, envelope.identity) &&
            isAckForEnvelope(ack, envelope) &&
            ack.disposition !== 'duplicate' &&
            ack.settlementId === settlementFor(envelope.epoch, envelope.resultDigest),
        )
      )
    }),
  )
export type DeviceResultRecord = z.infer<typeof deviceResultRecordSchema>

/**
One owner holds this store and channel for a pair. Saves must be atomic and
durable before resolving; missing initialized storage must reject, rather
than return undefined. Undefined means only that this attempt is new.
*/
export interface DeviceResultStore {
  load(attemptId: string): Promise<unknown>
  save(record: DeviceResultRecord): Promise<void>
}

/** Deterministic settlement per (epoch, digest), as bound by lane 0's ack. */
export function settlementFor(epoch: number, resultDigest: string): string {
  const input = `${String(epoch)}:${resultDigest}`
  return createHash('sha256').update(input).digest('hex').slice(0, DEVICE_LIMITS.idChars)
}

function waitKey(envelope: DeviceResultEnvelope): string {
  return `${JSON.stringify(envelope.identity)}:${String(envelope.epoch)}:${envelope.resultDigest}`
}

export class ResultChannel implements DeviceResultPort {
  private readonly waits = new Map<string, DeviceResultEnvelope>()
  private queue: Promise<void> = Promise.resolve()
  private queuedPublishes = 0
  private hasFailed = false

  public constructor(
    private readonly store: DeviceResultStore,
    // The reconciled receiver lease is the authority, never the incoming epoch
    // or the highest result seen. Lane W binds this to its durable lease owner.
    private readonly leaseOf: (identity: DeviceAttemptIdentity) => DeviceEpochState | undefined,
    private readonly clock: () => number = Date.now,
  ) {}

  private async publishNow(result: DeviceResultEnvelope): Promise<DeviceResultAck> {
    if (this.hasFailed) throw new DeviceResultError('storage')
    let stored: DeviceResultRecord | undefined
    try {
      const raw = await this.store.load(result.identity.attemptId)
      stored = raw === undefined ? undefined : deviceResultRecordSchema.parse(raw)
    } catch (error) {
      this.hasFailed = true
      throw new DeviceResultError('storage', { cause: error })
    }
    if (stored !== undefined && !isSameAttempt(stored.identity, result.identity))
      throw new DeviceResultError('payload-changed')
    const prior = stored?.receipts.find(({ envelope }) => envelope.epoch === result.epoch)
    if (prior !== undefined) {
      if (JSON.stringify(prior.envelope) !== JSON.stringify(result))
        throw new DeviceResultError('payload-changed')
      return deviceResultAckSchema.parse({
        ...prior.ack,
        disposition: prior.ack.disposition === 'accepted' ? 'duplicate' : 'quarantined',
      })
    }
    const rawLease = this.leaseOf(result.identity)
    if (rawLease === undefined) throw new DeviceResultError('uncertain')
    const lease = deviceEpochSchema.parse(rawLease)
    if (!isSameAttempt(lease.identity, result.identity) || result.epoch > lease.epoch)
      throw new DeviceResultError('uncertain')
    const now = this.clock()
    if (!Number.isSafeInteger(now) || now < 0 || now > DEVICE_LIMITS.observationMaxMs)
      throw new DeviceResultError('uncertain')
    const isLate =
      result.epoch < lease.epoch || lease.status === 'expired' || now >= lease.leaseExpiresAt
    if (!isLate && result.checkpoint !== lease.checkpoint)
      throw new DeviceResultError('payload-changed')
    const ack = deviceResultAckSchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      identity: result.identity,
      epoch: result.epoch,
      resultDigest: result.resultDigest,
      settlementId: settlementFor(result.epoch, result.resultDigest),
      disposition: isLate ? 'quarantined' : 'accepted',
      acknowledgedAt: now,
    })
    const record = deviceResultRecordSchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      identity: result.identity,
      receipts: [...(stored?.receipts ?? []), { envelope: result, ack }],
    })
    try {
      await this.store.save(record)
    } catch (error) {
      this.hasFailed = true
      throw new DeviceResultError('storage', { cause: error })
    }
    return ack
  }

  public get pendingWaits(): number {
    return this.waits.size
  }

  public async publish(envelope: unknown): Promise<DeviceResultAck> {
    if (!canQueueResultAck(this.queuedPublishes)) throw new DeviceResultError('capacity')
    const result = deviceResultEnvelopeSchema.parse(envelope)
    this.queuedPublishes += 1
    const before = this.queue
    const operation = (async () => {
      await before
      try {
        return await this.publishNow(result)
      } finally {
        this.queuedPublishes -= 1
      }
    })()
    this.queue = settleResultOperation(operation)
    return await operation
  }

  /** Duplicate waits remain idempotent even at the pendingResultAcks cap. */
  public queueResultWait(envelope: DeviceResultEnvelope): string {
    const result = deviceResultEnvelopeSchema.parse(envelope)
    const key = waitKey(result)
    const known = this.waits.get(key)
    if (known !== undefined) {
      if (JSON.stringify(known) !== JSON.stringify(result))
        throw new DeviceResultError('payload-changed')
      return key
    }
    if (!canQueueResultAck(this.waits.size)) throw new DeviceResultError('capacity')
    this.waits.set(key, result)
    return key
  }

  /** An old-epoch ack never settles the wait for a new epoch. */
  public ingestAck(ack: unknown): DeviceResultEnvelope | undefined {
    const parsed = deviceResultAckSchema.parse(ack)
    for (const [key, envelope] of this.waits) {
      if (isAckForEnvelope(parsed, envelope)) {
        this.waits.delete(key)
        return structuredClone(envelope)
      }
    }
    return undefined
  }
}
