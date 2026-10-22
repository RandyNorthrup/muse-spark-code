// Owner-only nonsync pairing metadata, separate from E's permanent attempt journal.
// Missing/corrupt storage and abandoned locks never become an empty success.
import { randomBytes } from 'node:crypto'
import { mkdir, open, realpath, readdir, rename, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import { DevicePairingError, validateDevicePair } from '../../core/devices/pairing'
import { deviceGrantSchema } from '../../core/devices/grants'
import type { DeviceStorageProtection } from '../../core/devices/storageProtection'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceEndpointSchema,
  deviceInvitationSchema,
  devicePairingConfirmationSchema,
} from '../../shared/devices'

const id = z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/))
const pairSchema = z.strictObject({
  pairId: id,
  pair: z.strictObject({
    local: deviceInvitationSchema,
    peer: deviceInvitationSchema,
    localConfirmation: devicePairingConfirmationSchema,
    peerConfirmation: devicePairingConfirmationSchema,
  }),
  endpoint: deviceEndpointSchema,
  completedAt: z.int().check(z.gte(0)),
  paused: z.boolean(),
  grants: z.array(deviceGrantSchema),
})
const label = z.string().check(z.minLength(1))
const pendingSchema = z.strictObject({
  listenerApplication: label,
  interfaceLabel: label,
  local: deviceInvitationSchema,
  peer: z.optional(deviceInvitationSchema),
  confirmation: z.optional(devicePairingConfirmationSchema),
})
const stateSchema = z.strictObject({
  version: z.literal(DEVICE_LIMITS.protocolVersion),
  deviceId: id,
  // Lane D: the persisted discovery-switch choice. Optional so state written
  // before the switch existed still opens; an absent choice reads as off.
  discoveryEnabled: z.optional(z.boolean()),
  pending: z.array(pendingSchema),
  pairs: z.array(pairSchema),
  usedInvitationIds: z.array(id),
  revokedPairIds: z.array(id),
  revokedKeys: z.array(z.strictObject({ pairId: id, invitationId: id })),
})
export type DeviceStoreState = z.infer<typeof stateSchema>

export type { DeviceStorageProtection } from '../../core/devices/storageProtection'
/** The binding and the platform whose rules apply; Windows has no fallback. */
interface Storage {
  readonly protection: DeviceStorageProtection | undefined
  readonly platform: NodeJS.Platform
}
export class DeviceStore {
  public static async open(
    directory: string,
    protection?: DeviceStorageProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<DeviceStore> {
    let lock: FileHandle | undefined
    const storage: Storage = { protection, platform }
    try {
      await checkDirectory(directory, storage)
      lock = await open(path.join(directory, '.pairing.lock'), 'wx', Number('0o600'))
      const store = new DeviceStore(directory, lock, storage)
      await secureFresh(path.join(directory, '.pairing.lock'), false, storage)
      await store.checkPrivate(path.join(directory, '.pairing.lock'), false)
      await lock.sync()
      await store.syncDirectory()
      const names = await readdir(directory)
      if (names.some((name) => name.endsWith('.stage'))) throw new DevicePairingError('storage')
      await store.read()
      return store
    } catch (error) {
      await lock?.close()
      throw new DevicePairingError('storage', { cause: error })
    }
  }
  /** Explicit first setup only; refuses an existing directory, including damaged state. */
  public static async create(
    directory: string,
    deviceId: string,
    protection?: DeviceStorageProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<DeviceStore> {
    const storage: Storage = { protection, platform }
    try {
      id.parse(deviceId)
      await mkdir(directory, { mode: Number('0o700') })
      await secureFresh(directory, true, storage)
      await checkDirectory(directory, storage)
      const handle = await open(path.join(directory, 'pairs.json'), 'wx', Number('0o600'))
      try {
        await secureFresh(path.join(directory, 'pairs.json'), false, storage)
        await checkFile(path.join(directory, 'pairs.json'), false, storage)
        await handle.writeFile(
          JSON.stringify({
            version: DEVICE_LIMITS.protocolVersion,
            deviceId,
            discoveryEnabled: false,
            pending: [],
            pairs: [],
            usedInvitationIds: [],
            revokedPairIds: [],
            revokedKeys: [],
          }),
        )
        await handle.sync()
      } finally {
        await handle.close()
      }
      await syncDirectory(directory, storage)
      await syncDirectory(path.dirname(directory), storage)
      return await this.open(directory, protection, platform)
    } catch (error) {
      throw new DevicePairingError('storage', { cause: error })
    }
  }
  private queue = Promise.resolve()
  private hasFailed = false
  private isClosed = false
  private constructor(
    private readonly directory: string,
    private readonly lock: FileHandle,
    private readonly storage: Storage,
  ) {}
  private async readNow(): Promise<DeviceStoreState> {
    this.assertUsable()
    try {
      await checkDirectory(this.directory, this.storage)
      if (
        !sameFile(
          await handleIdentity(this.lock),
          await lstatIdentity(path.join(this.directory, '.pairing.lock')),
        )
      )
        throw new DevicePairingError('storage')
      const file = path.join(this.directory, 'pairs.json')
      const sample = await this.checkPrivate(file, false)
      const handle = await open(file, 'r')
      try {
        if (!sameFile(sample, await handleIdentity(handle))) throw new DevicePairingError('storage')
        const bytes = await handle.readFile()
        const raw: unknown = JSON.parse(bytes.toString('utf8'))
        const state = stateSchema.parse(raw)
        if (JSON.stringify(state) !== bytes.toString('utf8'))
          throw new DevicePairingError('storage')
        validateState(state)
        return state
      } finally {
        await handle.close()
      }
    } catch (error) {
      this.hasFailed = true
      throw new DevicePairingError('storage', { cause: error })
    }
  }
  private async ordered<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue
    const operation = (async () => {
      await previous
      return await work()
    })()
    this.queue = settled(operation)
    return await operation
  }
  private assertUsable(): void {
    if (this.hasFailed || this.isClosed) throw new DevicePairingError('storage')
  }
  private async checkPrivate(file: string, isDirectory: boolean) {
    return await checkFile(file, isDirectory, this.storage)
  }
  private async syncDirectory(): Promise<void> {
    await syncDirectory(this.directory, this.storage)
  }
  public async read(): Promise<DeviceStoreState> {
    return await this.ordered(async () => await this.readNow())
  }
  public async update(change: (state: DeviceStoreState) => DeviceStoreState): Promise<void> {
    await this.ordered(async () => {
      const before = await this.readNow()
      let candidate: DeviceStoreState
      try {
        candidate = change(structuredClone(before))
      } catch (error) {
        // Only typed pre-write policy refusals leave the storage lane usable.
        if (
          error instanceof DevicePairingError &&
          ['revoked', 'unpaired', 'grant'].includes(error.reason)
        )
          throw error
        this.hasFailed = true
        throw new DevicePairingError('storage', { cause: error })
      }
      try {
        const after = stateSchema.parse(candidate)
        validateState(after)
        if (
          after.deviceId !== before.deviceId ||
          before.usedInvitationIds.some((value) => !after.usedInvitationIds.includes(value)) ||
          before.revokedPairIds.some((value) => !after.revokedPairIds.includes(value))
        )
          throw new DevicePairingError('storage')
        const bytes = Buffer.from(JSON.stringify(after))
        const stage = path.join(
          this.directory,
          `.${randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')}.stage`,
        )
        const handle = await open(stage, 'wx', Number('0o600'))
        try {
          await secureFresh(stage, false, this.storage)
          await this.checkPrivate(stage, false)
          await handle.writeFile(bytes)
          await handle.sync()
          await checkDirectory(this.directory, this.storage)
          const target = path.join(this.directory, 'pairs.json')
          if (this.storage.protection === undefined) await rename(stage, target)
          else await this.storage.protection.replace(stage, target)
          await this.syncDirectory()
        } finally {
          await handle.close()
        }
      } catch (error) {
        this.hasFailed = true
        throw new DevicePairingError('storage', { cause: error })
      }
    })
  }
  public async close(): Promise<void> {
    await this.queue
    if (this.isClosed) return
    this.isClosed = true
    try {
      const file = path.join(this.directory, '.pairing.lock')
      if (!sameFile(await handleIdentity(this.lock), await lstatIdentity(file)))
        throw new DevicePairingError('storage')
      await unlink(file)
      await this.syncDirectory()
    } finally {
      await this.lock.close()
    }
  }
}
function validateState(state: DeviceStoreState): void {
  const pairIds = state.pairs.map((row) => row.pairId)
  const pendingIds = state.pending.map((row) => row.local.invitationId)
  if (
    !isUnique(pairIds) ||
    !isUnique(pendingIds) ||
    !isUnique(state.usedInvitationIds) ||
    !isUnique(state.revokedPairIds)
  )
    throw new DevicePairingError('storage')
  if (
    !isUnique(state.revokedKeys.map((row) => row.pairId)) ||
    state.revokedKeys.some(
      (row) =>
        !state.revokedPairIds.includes(row.pairId) ||
        !state.usedInvitationIds.includes(row.invitationId),
    )
  )
    throw new DevicePairingError('storage')
  for (const row of state.pending) {
    if (
      row.local.deviceId !== state.deviceId ||
      state.usedInvitationIds.includes(row.local.invitationId) ||
      (row.peer !== undefined && state.usedInvitationIds.includes(row.peer.invitationId)) ||
      (row.confirmation !== undefined && row.peer === undefined)
    )
      throw new DevicePairingError('storage')
  }
  for (const row of state.pairs) {
    if (
      row.pair.local.deviceId !== state.deviceId ||
      state.revokedPairIds.includes(row.pairId) ||
      !state.usedInvitationIds.includes(row.pair.local.invitationId) ||
      !state.usedInvitationIds.includes(row.pair.peer.invitationId) ||
      validateDevicePair(row.pair, row.completedAt, true) !== row.pairId ||
      row.grants.some(
        (grant) => grant.pairId !== row.pairId || grant.offer.deviceId !== state.deviceId,
      ) ||
      !isUnique(row.grants.map((grant) => grant.offer.grantId)) ||
      !isUnique(row.grants.map((grant) => grant.offer.repositoryId))
    )
      throw new DevicePairingError('storage')
  }
}
async function checkFile(file: string, isDirectory: boolean, storage: Storage) {
  const sample = await lstatIdentity(file)
  if (
    sample.isSymbolicLink() ||
    (isDirectory ? !sample.isDirectory() : !sample.isFile() || sample.nlink.toString() !== '1')
  )
    throw new DevicePairingError('storage')
  if (storage.platform === 'win32') {
    if (storage.protection === undefined) throw new DevicePairingError('storage')
  } else if (
    sample.uid !== BigInt(typeof process.getuid === 'function' ? process.getuid() : -1) ||
    Boolean(sample.mode & BigInt(Number('0o077')))
  ) {
    throw new DevicePairingError('storage')
  }
  await storage.protection?.assertPrivate(file, isDirectory)
  return sample
}
async function checkDirectory(directory: string, storage: Storage): Promise<void> {
  await checkFile(directory, true, storage)
  if ((await realpath(directory)) !== path.resolve(directory))
    throw new DevicePairingError('storage')
  const parent = await lstatIdentity(path.dirname(directory))
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (storage.platform !== 'win32' && Boolean(parent.mode & BigInt(Number('0o022'))))
  )
    throw new DevicePairingError('storage')
  // Windows has no mode bits: the binding reads every ancestor's DACL instead
  // (checkFile already refused a missing binding there).
  await storage.protection?.assertSafeAncestor(path.dirname(directory))
}
/** Only for a path this process has just created exclusively (`mkdir`, `wx`). */
async function secureFresh(file: string, isDirectory: boolean, storage: Storage): Promise<void> {
  await storage.protection?.secureFresh(file, isDirectory)
}
async function syncDirectory(directory: string, storage: Storage): Promise<void> {
  if (storage.protection === undefined) {
    if (storage.platform === 'win32') throw new DevicePairingError('storage')
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } else {
    await storage.protection.syncDirectory(directory)
  }
}

function isUnique(values: string[]): boolean {
  return new Set(values).size === values.length
}
async function settled(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (error) {
    // The store's own typed failure is already recorded for the awaiting
    // caller; anything else poisons the queue so later work fails loudly
    // instead of building on unknown state.
    if (error instanceof DevicePairingError) return
    throw error
  }
}
