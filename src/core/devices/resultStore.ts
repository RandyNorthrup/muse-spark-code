// M100 phase 2 lane R (G27): the durable file store behind ResultChannel.
// One owner holds this store for a pair; each attempt's receipts live as
// <directory>/<attemptId>.json, written atomically and synced before save
// resolves. Attempt ids are 32 lowercase hex; anything else refuses before
// any file is touched. A missing record file means a new attempt; a missing
// or damaged directory refuses.
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { sameFile, type FileIdentity } from '../fs/fileIdentity'
import { isErrno } from '../fs/errno'
import { readProtectedJson } from '../fs/protectedJson'
import {
  checkPrivatePath,
  createStoreQueue,
  provisionStoreDirectory,
  replaceStoreFile,
  syncStoreDirectory,
  type ProtectedStoreStorage,
} from '../fs/protectedStore'
import type { DeviceStorageProtection } from './storageProtection'
import {
  DeviceResultError,
  deviceResultRecordSchema,
  type DeviceResultRecord,
  type DeviceResultStore,
} from './resultChannel'

const ATTEMPT_ID = /^[a-f0-9]{32}$(?![\s\S])/

function recordFile(directory: string, attemptId: string): string {
  if (!ATTEMPT_ID.test(attemptId)) throw new DeviceResultError('storage')
  return path.join(directory, `${attemptId}.json`)
}

function refuseResult(): DeviceResultError {
  return new DeviceResultError('storage')
}

function isResultError(error: unknown): boolean {
  return error instanceof DeviceResultError
}

export class FileResultStore implements DeviceResultStore {
  /** Explicit first provisioning only. The sibling marker prevents folder-loss reset. */
  public static async create(
    directory: string,
    protection?: DeviceStorageProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<FileResultStore> {
    const storage: ProtectedStoreStorage = { protection, platform }
    try {
      await provisionStoreDirectory(directory, storage, refuseResult)
      await syncStoreDirectory(path.dirname(directory), storage, refuseResult)
      return await this.open(directory, protection, platform)
    } catch (error) {
      throw new DeviceResultError('storage', { cause: error })
    }
  }

  public static async open(
    directory: string,
    protection?: DeviceStorageProtection,
    platform: NodeJS.Platform = process.platform,
  ): Promise<FileResultStore> {
    const storage: ProtectedStoreStorage = { protection, platform }
    try {
      const directoryIdentity = await checkPrivatePath(directory, true, storage, refuseResult)
      const store = new FileResultStore(directory, directoryIdentity, storage)
      const names = await readdir(directory)
      if (names.some((name) => name.endsWith('.stage'))) throw new DeviceResultError('storage')
      return store
    } catch (error) {
      throw new DeviceResultError('storage', { cause: error })
    }
  }

  private readonly ordered = createStoreQueue(isResultError)
  private hasFailed = false
  private readonly records = new Map<string, FileIdentity>()
  private constructor(
    private readonly directory: string,
    private readonly directoryIdentity: FileIdentity,
    private readonly storage: ProtectedStoreStorage,
  ) {}

  private async assertStorage(): Promise<void> {
    if (this.hasFailed) throw new DeviceResultError('storage')
    if (
      !sameFile(
        this.directoryIdentity,
        await checkPrivatePath(this.directory, true, this.storage, refuseResult),
      )
    )
      throw new DeviceResultError('storage')
  }

  public async load(attemptId: string): Promise<unknown> {
    return await this.ordered(async () => {
      const file = recordFile(this.directory, attemptId)
      try {
        await this.assertStorage()
      } catch (error) {
        this.hasFailed = true
        throw new DeviceResultError('storage', { cause: error })
      }
      let sample: FileIdentity
      try {
        sample = await checkPrivatePath(file, false, this.storage, refuseResult)
      } catch (error) {
        // A missing record file means a new attempt; anything else refuses.
        // A directory deleted in this window surfaces as storage on the
        // next call, before any acknowledgement is persisted.
        if (isErrno(error) && error.code === 'ENOENT') return
        this.hasFailed = true
        throw new DeviceResultError('storage', { cause: error })
      }
      try {
        const known = this.records.get(attemptId)
        if (known !== undefined && !sameFile(known, sample)) throw new DeviceResultError('storage')
        const raw: unknown = await readProtectedJson({
          file,
          sample,
          parse: (value: unknown) => value,
          refuse: refuseResult,
        })
        this.records.set(attemptId, sample)
        return raw
      } catch (error) {
        this.hasFailed = true
        throw new DeviceResultError('storage', { cause: error })
      }
    })
  }

  public async save(record: DeviceResultRecord): Promise<void> {
    await this.ordered(async () => {
      try {
        const parsed = deviceResultRecordSchema.parse(record)
        const bytes = Buffer.from(JSON.stringify(parsed))
        await this.assertStorage()
        const identity = await replaceStoreFile({
          directory: this.directory,
          name: `${parsed.identity.attemptId}.json`,
          bytes,
          storage: this.storage,
          known: this.records.get(parsed.identity.attemptId),
          refuse: refuseResult,
          reassert: () => this.assertStorage(),
        })
        this.records.set(parsed.identity.attemptId, identity)
      } catch (error) {
        this.hasFailed = true
        throw new DeviceResultError('storage', { cause: error })
      }
    })
  }
}
