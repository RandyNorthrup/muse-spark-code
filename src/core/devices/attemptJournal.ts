// Durable replay evidence lives outside runtime folders and pairing/logout state.
import { createHash } from 'node:crypto'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { sameFile, type FileIdentity } from '../fs/fileIdentity'
import { readProtectedJson } from '../fs/protectedJson'
import {
  checkPrivatePath,
  provisionStoreDirectory,
  replaceStoreFile,
  syncStoreDirectory,
  type ProtectedStoreStorage,
} from '../fs/protectedStore'
import { compareUsdAmounts } from '../../shared/usd'
import type { DeviceStorageProtection } from './storageProtection'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceDispatchSchema,
  deviceAttemptIdentitySchema,
  deviceJournalRecordSchema,
  type DeviceAttemptIdentity,
  type DeviceDispatch,
  type DeviceFrame,
  type DeviceJournalRecord,
} from '../../shared/devices'

export type DeviceOutcome = Extract<DeviceFrame['body'], { kind: 'outcome' }>['outcome']
type Tombstone = Extract<DeviceJournalRecord, { kind: 'tombstone' }>

/** M96 must hold an exclusive local lifetime lease, never a reachability/PID guess. */
export interface AttemptJournalOwner {
  assertOwner(): Promise<void>
}
/** Windows requires an owner-only ACL and durable replacement binding; no fallback. */
export type AttemptJournalProtection = DeviceStorageProtection

function refuseJournal(): DeviceJournalError {
  return new DeviceJournalError('storage')
}
export class DeviceJournalError extends Error {
  public constructor(
    public readonly reason: 'storage' | 'capacity' | 'payload-changed' | 'uncertain',
    options?: { cause?: unknown },
  ) {
    super(reason, options)
    this.name = 'DeviceJournalError'
  }
}
const stateSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  records: z.array(deviceJournalRecordSchema),
  cancellations: z.optional(z.array(deviceAttemptIdentitySchema)),
  acknowledgements: z.array(
    z.strictObject({
      attemptId: z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/)),
      recordedAt: z.int().check(z.gte(0)),
    }),
  ),
})
type JournalState = z.infer<typeof stateSchema>

/** Canonical hashing is independent of property insertion order on either host. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonical(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
export function deviceDispatchDigest(input: DeviceDispatch): string {
  const { payloadDigest: _digest, ...request } = deviceDispatchSchema.parse(input)
  return digest(request)
}
export function deviceRecordPayload(record: DeviceJournalRecord): string {
  if (record.kind === 'source-intent') return record.dispatch.payloadDigest
  return record.kind === 'receiver-record' ? record.outcome.payloadDigest : record.payloadDigest
}
function identityOf(record: DeviceJournalRecord): DeviceAttemptIdentity {
  if (record.kind === 'source-intent') return record.dispatch.identity
  return record.kind === 'receiver-record' ? record.outcome.identity : record.identity
}
function isTerminal(record: DeviceJournalRecord): boolean {
  return (
    record.kind === 'tombstone' ||
    (record.kind === 'receiver-record' && ['retired', 'refused'].includes(record.outcome.state))
  )
}
function validateState(state: JournalState): void {
  const identities = state.records.map((row) => identityOf(row))
  const ids = identities.map((identity) => identity.attemptId)
  const byId = new Map(identities.map((identity) => [identity.attemptId, identity]))
  const settlements = state.records
    .filter(
      (row): row is Extract<DeviceJournalRecord, { kind: 'receiver-record' | 'tombstone' }> =>
        row.kind !== 'source-intent',
    )
    .map((row) =>
      row.kind === 'receiver-record' ? row.outcome.usage.settlementId : row.usage.settlementId,
    )
  const cancellations = state.cancellations ?? []
  if (
    new Set(cancellations.map((identity) => identity.attemptId)).size !== cancellations.length ||
    cancellations.some((identity) => {
      const known = byId.get(identity.attemptId)
      return known !== undefined && canonical(known) !== canonical(identity)
    }) ||
    new Set(ids).size !== ids.length ||
    new Set(settlements).size !== settlements.length ||
    state.records.some(
      (row) =>
        row.kind === 'source-intent' &&
        deviceDispatchDigest(row.dispatch) !== row.dispatch.payloadDigest,
    ) ||
    new Set(state.acknowledgements.map((ack) => ack.attemptId)).size !==
      state.acknowledgements.length ||
    state.acknowledgements.some((ack) =>
      state.records.every((row) => identityOf(row).attemptId !== ack.attemptId || !isTerminal(row)),
    )
  )
    throw new DeviceJournalError('storage')
}

export class AttemptJournal {
  /** Explicit first provisioning only. The sibling marker prevents folder-loss reset. */
  public static async create(
    directory: string,
    owner: AttemptJournalOwner,
    protection?: AttemptJournalProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<AttemptJournal> {
    const storage: ProtectedStoreStorage = { protection, platform }
    try {
      await owner.assertOwner()
      await provisionStoreDirectory(directory, storage, refuseJournal)
      const file = path.join(directory, 'attempts.json')
      const handle = await open(file, 'wx', Number('0o600'))
      try {
        await protection?.secureFresh(file, false)
        await handle.writeFile(
          JSON.stringify({
            version: DEVICE_LIMITS.protocolVersion,
            records: [],
            acknowledgements: [],
          }),
        )
        await handle.sync()
        await syncStoreDirectory(directory, storage, refuseJournal)
      } finally {
        await handle.close()
      }
      await syncStoreDirectory(path.dirname(directory), storage, refuseJournal)
      return await this.open(directory, owner, protection, platform)
    } catch (error) {
      throw new DeviceJournalError('storage', { cause: error })
    }
  }
  public static async open(
    directory: string,
    owner: AttemptJournalOwner,
    protection?: AttemptJournalProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<AttemptJournal> {
    const storage: ProtectedStoreStorage = { protection, platform }
    try {
      await owner.assertOwner()
      const directoryIdentity = await checkPrivatePath(directory, true, storage, refuseJournal)
      const fileIdentity = await checkPrivatePath(
        path.join(directory, 'attempts.json'),
        false,
        storage,
        refuseJournal,
      )
      const journal = new AttemptJournal(directory, owner, directoryIdentity, fileIdentity, storage)
      const names = await readdir(directory)
      if (names.some((name) => name.endsWith('.stage'))) throw new DeviceJournalError('storage')
      await journal.readNow()
      return journal
    } catch (error) {
      throw new DeviceJournalError('storage', { cause: error })
    }
  }
  private queue: Promise<void> = Promise.resolve()
  private hasFailed = false
  private constructor(
    private readonly directory: string,
    private readonly owner: AttemptJournalOwner,
    private readonly directoryIdentity: FileIdentity,
    private fileIdentity: FileIdentity,
    private readonly storage: ProtectedStoreStorage,
  ) {}
  private async assertStorage(): Promise<void> {
    if (this.hasFailed) throw new DeviceJournalError('storage')
    await this.owner.assertOwner()
    if (
      !sameFile(
        this.directoryIdentity,
        await checkPrivatePath(this.directory, true, this.storage, refuseJournal),
      )
    )
      throw new DeviceJournalError('storage')
  }
  private async readNow(): Promise<JournalState> {
    try {
      await this.assertStorage()
      const file = path.join(this.directory, 'attempts.json')
      const sample = await checkPrivatePath(file, false, this.storage, refuseJournal)
      if (!sameFile(this.fileIdentity, sample)) throw new DeviceJournalError('storage')
      return await readProtectedJson({
        file,
        sample,
        parse: (raw: unknown) => stateSchema.parse(raw),
        validate: validateState,
        refuse: refuseJournal,
      })
    } catch (error) {
      this.hasFailed = true
      throw new DeviceJournalError('storage', { cause: error })
    }
  }
  private async writeNow(state: JournalState): Promise<void> {
    try {
      const parsed = stateSchema.parse(state)
      validateState(parsed)
      const bytes = Buffer.from(JSON.stringify(parsed))
      await this.assertStorage()
      this.fileIdentity = await replaceStoreFile({
        directory: this.directory,
        name: 'attempts.json',
        bytes,
        storage: this.storage,
        known: this.fileIdentity,
        refuse: refuseJournal,
        reassert: () => this.assertStorage(),
      })
    } catch (error) {
      this.hasFailed = true
      throw new DeviceJournalError('storage', { cause: error })
    }
  }
  private async ordered<T>(work: () => Promise<T>): Promise<T> {
    const before = this.queue
    const operation = (async () => {
      await before
      return await work()
    })()
    this.queue = settleDeviceOperation(operation)
    return await operation
  }
  private find(
    state: JournalState,
    identity: DeviceAttemptIdentity,
  ): DeviceJournalRecord | undefined {
    const row = state.records.find((record) => identityOf(record).attemptId === identity.attemptId)
    if (row !== undefined && canonical(identityOf(row)) !== canonical(identity))
      throw new DeviceJournalError('payload-changed')
    return row
  }
  private async insert(record: DeviceJournalRecord): Promise<DeviceJournalRecord> {
    return await this.ordered(async () => {
      const state = await this.readNow()
      const prior = this.find(state, identityOf(record))
      if (prior !== undefined) {
        const payload = deviceRecordPayload(prior)
        const incoming = deviceRecordPayload(record)
        if (payload !== incoming) throw new DeviceJournalError('payload-changed')
        return prior
      }
      state.records.push(deviceJournalRecordSchema.parse(record))
      await this.writeNow(state)
      return record
    })
  }
  public async records(): Promise<readonly DeviceJournalRecord[]> {
    return await this.ordered(async () => {
      const state = await this.readNow()
      return state.records
    })
  }
  public async lookup(identity: DeviceAttemptIdentity): Promise<DeviceJournalRecord | undefined> {
    return await this.ordered(async () => this.find(await this.readNow(), identity))
  }
  /** M100-E-CANCEL-RETENTION: permanent identity evidence, including before admission. */
  public async cancellations(): Promise<readonly DeviceAttemptIdentity[]> {
    return await this.ordered(async () => {
      const state = await this.readNow()
      return state.cancellations ?? []
    })
  }
  public async recordCancellation(input: DeviceAttemptIdentity): Promise<void> {
    const identity = deviceAttemptIdentitySchema.parse(input)
    await this.ordered(async () => {
      const state = await this.readNow()
      const known = this.find(state, identity)
      const cancelledIdentity = known === undefined ? identity : identityOf(known)
      const cancellations = state.cancellations ?? []
      const prior = cancellations.find((row) => row.attemptId === identity.attemptId)
      if (prior !== undefined) {
        if (canonical(prior) !== canonical(identity))
          throw new DeviceJournalError('payload-changed')
        return
      }
      state.cancellations = [...cancellations, cancelledIdentity]
      await this.writeNow(state)
    })
  }
  public async sourceIntent(request: DeviceDispatch, now: number): Promise<DeviceJournalRecord> {
    if (deviceDispatchDigest(request) !== request.payloadDigest)
      throw new DeviceJournalError('payload-changed')
    return await this.insert({ kind: 'source-intent', dispatch: request, recordedAt: now })
  }
  public async admit(
    request: DeviceDispatch,
    usage: DeviceOutcome['usage'],
    now: number,
  ): Promise<DeviceJournalRecord> {
    if (deviceDispatchDigest(request) !== request.payloadDigest)
      throw new DeviceJournalError('payload-changed')
    return await this.insert({
      kind: 'receiver-record',
      recordedAt: now,
      outcome: {
        identity: request.identity,
        payloadDigest: request.payloadDigest,
        revision: 1,
        state: 'admitted',
        occupied: request.caps,
        usage,
      },
    })
  }
  /** Called only by the local execution owner; never accepts peer outcomes. */
  public async advance(
    identity: DeviceAttemptIdentity,
    change: (previous: DeviceOutcome) => DeviceOutcome,
    now: number,
  ): Promise<DeviceOutcome> {
    return await this.ordered(async () => {
      const state = await this.readNow()
      const row = this.find(state, identity)
      if (row?.kind !== 'receiver-record' || isTerminal(row))
        throw new DeviceJournalError('uncertain')
      const candidate = deviceJournalRecordSchema.parse({
        kind: 'receiver-record',
        outcome: change(structuredClone(row.outcome)),
        recordedAt: now,
      })
      if (candidate.kind !== 'receiver-record') throw new DeviceJournalError('storage')
      const next = candidate.outcome
      if (
        canonical(next.identity) !== canonical(identity) ||
        next.payloadDigest !== row.outcome.payloadDigest ||
        next.revision !== row.outcome.revision + 1 ||
        next.usage.settlementId !== row.outcome.usage.settlementId ||
        next.state === 'admitted' ||
        (!['retired', 'refused'].includes(next.state) &&
          (canonical(next.occupied) !== canonical(row.outcome.occupied) ||
            compareUsdAmounts(
              next.usage.retainedLiabilityUsd,
              row.outcome.usage.retainedLiabilityUsd,
            ) < 0)) ||
        (next.state === 'launch-intent' && row.outcome.state !== 'admitted') ||
        (next.state === 'running' && row.outcome.state !== 'launch-intent')
      )
        throw new DeviceJournalError('uncertain')
      state.records[state.records.indexOf(row)] = candidate
      await this.writeNow(state)
      return next
    })
  }
  /** Source bookkeeping only, after authenticated reconciliation. Never retires a local receiver record. */
  public async settleSource(outcome: DeviceOutcome, now: number): Promise<DeviceJournalRecord> {
    const candidate = deviceJournalRecordSchema.parse({
      kind: 'receiver-record',
      outcome,
      recordedAt: now,
    })
    if (candidate.kind !== 'receiver-record' || !isTerminal(candidate))
      throw new DeviceJournalError('uncertain')
    const settledOutcome = candidate.outcome
    return await this.ordered(async () => {
      const state = await this.readNow()
      const prior = this.find(state, settledOutcome.identity)
      if (prior === undefined || deviceRecordPayload(prior) !== settledOutcome.payloadDigest)
        throw new DeviceJournalError('payload-changed')
      if (prior.kind !== 'source-intent') {
        const previousDigest =
          prior.kind === 'tombstone' ? prior.outcomeDigest : digest(prior.outcome)
        if (!isTerminal(prior) || previousDigest !== digest(settledOutcome))
          throw new DeviceJournalError('uncertain')
        return prior
      }
      state.records[state.records.indexOf(prior)] = candidate
      await this.writeNow(state)
      return candidate
    })
  }
  public async acknowledge(
    identity: DeviceAttemptIdentity,
    payloadDigest: string,
    settlementId: string,
  ): Promise<void> {
    await this.ordered(async () => {
      const state = await this.readNow()
      const row = this.find(state, identity)
      if (row === undefined || !isTerminal(row)) throw new DeviceJournalError('uncertain')
      const terminal = row.kind === 'receiver-record' ? row.outcome : row
      if ('kind' in terminal && terminal.kind === 'source-intent')
        throw new DeviceJournalError('uncertain')
      if (terminal.payloadDigest !== payloadDigest || terminal.usage.settlementId !== settlementId)
        throw new DeviceJournalError('payload-changed')
      if (
        row.kind === 'tombstone' ||
        state.acknowledgements.some((ack) => ack.attemptId === identity.attemptId)
      )
        return
      state.acknowledgements.push({ attemptId: identity.attemptId, recordedAt: Date.now() })
      await this.writeNow(state)
    })
  }
  public async compact(now: number): Promise<void> {
    await this.ordered(async () => {
      const state = await this.readNow()
      for (const [index, row] of state.records.entries()) {
        if (
          row.kind !== 'receiver-record' ||
          !isTerminal(row) ||
          state.acknowledgements.every(
            (ack) =>
              ack.attemptId !== row.outcome.identity.attemptId ||
              now - ack.recordedAt < DEVICE_LIMITS.terminalRetentionMs,
          )
        )
          continue
        const { identity, payloadDigest, revision, state: terminal, usage, failure } = row.outcome
        if (terminal !== 'retired' && terminal !== 'refused')
          throw new DeviceJournalError('storage')
        const tombstone: Tombstone = {
          kind: 'tombstone',
          identity,
          payloadDigest,
          revision,
          state: terminal,
          usage,
          ...(failure !== undefined && { failure }),
          outcomeDigest: digest(row.outcome),
          recordedAt: now,
        }
        state.records[index] = tombstone
        state.acknowledgements = state.acknowledgements.filter(
          (ack) => ack.attemptId !== identity.attemptId,
        )
      }
      // The atomic replacement includes the permanent tombstone before discarding full data.
      await this.writeNow(state)
    })
  }
}

export async function settleDeviceOperation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (error) {
    // The journal's own typed failure is already recorded for the awaiting
    // caller; anything else poisons the queue so later work fails loudly
    // instead of building on unknown state.
    if (error instanceof DeviceJournalError) return
    throw error
  }
}
