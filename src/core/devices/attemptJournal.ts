// Durable replay evidence lives outside runtime folders and pairing/logout state.
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, realpath, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { handleIdentity, lstatIdentity, sameFile, type FileIdentity } from '../fs/fileIdentity'
import type { DeviceStorageProtection } from './storageProtection'
import { DEVICE_LIMITS, WORKSPACE_IDENTITY_ZERO } from '../../shared/constants'
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
interface JournalStorage {
  readonly protection: AttemptJournalProtection | undefined
  readonly platform: NodeJS.Platform
}
export class DeviceJournalError extends Error {
  public constructor(
    public readonly reason: 'storage' | 'capacity' | 'payload-changed' | 'uncertain',
  ) {
    super(reason)
    this.name = 'DeviceJournalError'
  }
}
const stateSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  records: z.array(deviceJournalRecordSchema).check(z.maxLength(DEVICE_LIMITS.tombstones)),
  cancellations: z.optional(
    z.array(deviceAttemptIdentitySchema).check(z.maxLength(DEVICE_LIMITS.tombstones)),
  ),
  acknowledgements: z
    .array(
      z.strictObject({
        attemptId: z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/)),
        recordedAt: z.int().check(z.gte(0)),
      }),
    )
    .check(z.maxLength(DEVICE_LIMITS.terminalRecords)),
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
    ) ||
    state.records.filter((row) => !isTerminal(row)).length > DEVICE_LIMITS.unresolvedAttempts ||
    state.records.filter((row) => row.kind === 'receiver-record' && isTerminal(row)).length >
      DEVICE_LIMITS.terminalRecords
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
    const storage: JournalStorage = { protection, platform }
    try {
      await owner.assertOwner()
      await checkPrivate(path.dirname(directory), true, storage)
      const markerFile = path.join(
        path.dirname(directory),
        `.${path.basename(directory)}.initialized`,
      )
      const marker = await open(markerFile, 'wx', Number('0o600'))
      try {
        await protection?.secureFresh(markerFile, false)
        await marker.writeFile(String(DEVICE_LIMITS.protocolVersion))
        await marker.sync()
      } finally {
        await marker.close()
      }
      await syncDirectory(path.dirname(directory), storage)
      await mkdir(directory, { mode: Number('0o700') })
      await protection?.secureFresh(directory, true)
      await checkPrivate(directory, true, storage)
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
        await syncDirectory(directory, storage)
      } finally {
        await handle.close()
      }
      await syncDirectory(path.dirname(directory), storage)
      return await this.open(directory, owner, protection, platform)
    } catch {
      throw new DeviceJournalError('storage')
    }
  }
  public static async open(
    directory: string,
    owner: AttemptJournalOwner,
    protection?: AttemptJournalProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<AttemptJournal> {
    const storage: JournalStorage = { protection, platform }
    try {
      await owner.assertOwner()
      const directoryIdentity = await checkPrivate(directory, true, storage)
      const fileIdentity = await checkPrivate(path.join(directory, 'attempts.json'), false, storage)
      const journal = new AttemptJournal(directory, owner, directoryIdentity, fileIdentity, storage)
      const names = await readdir(directory)
      if (names.some((name) => name.endsWith('.stage'))) throw new DeviceJournalError('storage')
      await journal.readNow()
      return journal
    } catch {
      throw new DeviceJournalError('storage')
    }
  }
  private queue: Promise<void> = Promise.resolve()
  private hasFailed = false
  private constructor(
    private readonly directory: string,
    private readonly owner: AttemptJournalOwner,
    private readonly directoryIdentity: FileIdentity,
    private fileIdentity: FileIdentity,
    private readonly storage: JournalStorage,
  ) {}
  private async assertStorage(): Promise<void> {
    if (this.hasFailed) throw new DeviceJournalError('storage')
    await this.owner.assertOwner()
    if (!sameFile(this.directoryIdentity, await checkPrivate(this.directory, true, this.storage)))
      throw new DeviceJournalError('storage')
  }
  private async readNow(): Promise<JournalState> {
    try {
      await this.assertStorage()
      const file = path.join(this.directory, 'attempts.json')
      const sample = await checkPrivate(file, false, this.storage)
      if (!sameFile(this.fileIdentity, sample) || sample.size > BigInt(DEVICE_LIMITS.journalBytes))
        throw new DeviceJournalError('storage')
      const handle = await open(file, 'r')
      try {
        if (!sameFile(sample, await handleIdentity(handle))) throw new DeviceJournalError('storage')
        const bytes = await handle.readFile()
        if (bytes.length > DEVICE_LIMITS.journalBytes) throw new DeviceJournalError('storage')
        const raw: unknown = JSON.parse(bytes.toString('utf8'))
        const state = stateSchema.parse(raw)
        if (JSON.stringify(state) !== bytes.toString('utf8'))
          throw new DeviceJournalError('storage')
        validateState(state)
        return state
      } finally {
        await handle.close()
      }
    } catch {
      this.hasFailed = true
      throw new DeviceJournalError('storage')
    }
  }
  private async writeNow(state: JournalState): Promise<void> {
    try {
      const parsed = stateSchema.parse(state)
      validateState(parsed)
      const bytes = Buffer.from(JSON.stringify(parsed))
      if (bytes.length > DEVICE_LIMITS.journalBytes) throw new DeviceJournalError('storage')
      await this.assertStorage()
      const stage = path.join(
        this.directory,
        `.${randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')}.stage`,
      )
      const handle = await open(stage, 'wx', Number('0o600'))
      try {
        const { protection } = this.storage
        await protection?.secureFresh(stage, false)
        const stageIdentity = await checkPrivate(stage, false, this.storage)
        if (!sameFile(stageIdentity, await handleIdentity(handle)))
          throw new DeviceJournalError('storage')
        await handle.writeFile(bytes)
        await handle.sync()
        await this.assertStorage()
        const target = path.join(this.directory, 'attempts.json')
        if (
          !sameFile(stageIdentity, await checkPrivate(stage, false, this.storage)) ||
          !sameFile(this.fileIdentity, await checkPrivate(target, false, this.storage))
        )
          throw new DeviceJournalError('storage')
        if (protection === undefined) await rename(stage, target)
        else await protection.replace(stage, target)
        await syncDirectory(this.directory, this.storage)
        this.fileIdentity = await handleIdentity(handle)
      } finally {
        await handle.close()
      }
    } catch {
      this.hasFailed = true
      throw new DeviceJournalError('storage')
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
      if (
        state.records.filter((row) => !isTerminal(row)).length >=
          DEVICE_LIMITS.unresolvedAttempts ||
        state.records.length >= DEVICE_LIMITS.tombstones ||
        state.records.filter((row) => row.kind === 'receiver-record' && isTerminal(row)).length >=
          DEVICE_LIMITS.terminalRecords
      )
        throw new DeviceJournalError('capacity')
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
      if (cancellations.length >= DEVICE_LIMITS.tombstones) throw new DeviceJournalError('capacity')
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
            next.usage.retainedLiabilityUsd < row.outcome.usage.retainedLiabilityUsd)) ||
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

async function checkPrivate(file: string, isDirectory: boolean, storage: JournalStorage) {
  const { protection, platform } = storage
  const sample = await lstatIdentity(file)
  if (
    sample.isSymbolicLink() ||
    (isDirectory ? !sample.isDirectory() : !sample.isFile()) ||
    (!isDirectory && sample.nlink.toString() !== '1')
  )
    throw new DeviceJournalError('storage')
  if (platform === 'win32') {
    if (protection === undefined) throw new DeviceJournalError('storage')
  } else if (
    sample.uid !== BigInt(typeof process.getuid === 'function' ? process.getuid() : -1) ||
    Boolean(sample.mode & BigInt(Number('0o077')))
  ) {
    throw new DeviceJournalError('storage')
  }
  if (isDirectory) {
    const resolved = await realpath(file)
    if (resolved.replaceAll('\\', '/') !== path.resolve(file).replaceAll('\\', '/'))
      throw new DeviceJournalError('storage')
    let ancestor = path.dirname(file)
    let isRoot = false
    while (!isRoot) {
      const parent = await lstatIdentity(ancestor)
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new DeviceJournalError('storage')
      if (
        platform !== 'win32' &&
        ((parent.uid !== WORKSPACE_IDENTITY_ZERO &&
          parent.uid !== BigInt(typeof process.getuid === 'function' ? process.getuid() : -1)) ||
          (Boolean(parent.mode & BigInt(Number('0o022'))) &&
            !(
              parent.uid === WORKSPACE_IDENTITY_ZERO &&
              Boolean(parent.mode & BigInt(Number('0o1000')))
            )))
      )
        throw new DeviceJournalError('storage')
      const next = path.dirname(ancestor)
      isRoot = next === ancestor
      ancestor = next
    }
    // One binding call reads the whole chain's DACLs (Windows has no mode bits).
    await protection?.assertSafeAncestor(path.dirname(file))
  }
  await protection?.assertPrivate(file, isDirectory)
  return sample
}
async function syncDirectory(directory: string, storage: JournalStorage): Promise<void> {
  if (storage.protection !== undefined) {
    await storage.protection.syncDirectory(directory)
    return
  }
  if (storage.platform === 'win32') throw new DeviceJournalError('storage')
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function settleDeviceOperation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch {
    return
  }
}
