// One owner-only store discipline for the device storage lanes: provision,
// private checks, atomic replace and the ordered queue. Reads stay in
// protectedJson. Callers supply their typed refusal; the checks, syncs and
// orderings below are identical for every store.
import { randomBytes } from 'node:crypto'
import { mkdir, open, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import { handleIdentity, lstatIdentity, sameFile, type FileIdentity } from './fileIdentity'
import type { DeviceStorageProtection } from '../devices/storageProtection'
import { DEVICE_LIMITS, WORKSPACE_IDENTITY_ZERO } from '../../shared/constants'

export interface ProtectedStoreStorage {
  readonly protection: DeviceStorageProtection | undefined
  readonly platform: NodeJS.Platform
}

export async function checkPrivatePath(
  file: string,
  isDirectory: boolean,
  storage: ProtectedStoreStorage,
  refuse: () => Error,
) {
  const { protection, platform } = storage
  const sample = await lstatIdentity(file)
  if (
    sample.isSymbolicLink() ||
    (isDirectory ? !sample.isDirectory() : !sample.isFile()) ||
    (!isDirectory && sample.nlink.toString() !== '1')
  )
    throw refuse()
  if (platform === 'win32') {
    if (protection === undefined) throw refuse()
  } else if (
    sample.uid !== BigInt(typeof process.getuid === 'function' ? process.getuid() : -1) ||
    Boolean(sample.mode & BigInt(Number('0o077')))
  ) {
    throw refuse()
  }
  if (isDirectory) {
    const resolved = await realpath(file)
    if (resolved.replaceAll('\\', '/') !== path.resolve(file).replaceAll('\\', '/')) throw refuse()
    let ancestor = path.dirname(file)
    let isRoot = false
    while (!isRoot) {
      const parent = await lstatIdentity(ancestor)
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw refuse()
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
        throw refuse()
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

export async function syncStoreDirectory(
  directory: string,
  storage: ProtectedStoreStorage,
  refuse: () => Error,
): Promise<void> {
  if (storage.protection !== undefined) {
    await storage.protection.syncDirectory(directory)
    return
  }
  if (storage.platform === 'win32') throw refuse()
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Marker, directory and checks; the caller writes its initial files after. */
export async function provisionStoreDirectory(
  directory: string,
  storage: ProtectedStoreStorage,
  refuse: () => Error,
): Promise<void> {
  await checkPrivatePath(path.dirname(directory), true, storage, refuse)
  const markerFile = path.join(path.dirname(directory), `.${path.basename(directory)}.initialized`)
  const marker = await open(markerFile, 'wx', Number('0o600'))
  try {
    await storage.protection?.secureFresh(markerFile, false)
    await marker.writeFile(String(DEVICE_LIMITS.protocolVersion))
    await marker.sync()
  } finally {
    await marker.close()
  }
  await syncStoreDirectory(path.dirname(directory), storage, refuse)
  await mkdir(directory, { mode: Number('0o700') })
  await storage.protection?.secureFresh(directory, true)
  await checkPrivatePath(directory, true, storage, refuse)
}

export async function replaceStoreFile(args: {
  readonly directory: string
  readonly name: string
  readonly bytes: Buffer
  readonly storage: ProtectedStoreStorage
  readonly known?: FileIdentity | undefined
  readonly refuse: () => Error
  reassert(): Promise<void>
}): Promise<FileIdentity> {
  const { directory, name, bytes, storage, known } = args
  const target = path.join(directory, name)
  const stage = path.join(
    directory,
    `.${randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex')}.stage`,
  )
  const handle = await open(stage, 'wx', Number('0o600'))
  try {
    const { protection } = storage
    await protection?.secureFresh(stage, false)
    const stageIdentity = await checkPrivatePath(stage, false, storage, args.refuse)
    if (!sameFile(stageIdentity, await handleIdentity(handle))) throw args.refuse()
    await handle.writeFile(bytes)
    await handle.sync()
    await args.reassert()
    if (!sameFile(stageIdentity, await checkPrivatePath(stage, false, storage, args.refuse)))
      throw args.refuse()
    // A first write has no known target: rename creates or atomically
    // replaces a crash leftover. A known target must still be itself.
    if (
      known !== undefined &&
      !sameFile(known, await checkPrivatePath(target, false, storage, args.refuse))
    )
      throw args.refuse()
    if (protection === undefined) await rename(stage, target)
    else await protection.replace(stage, target)
    await syncStoreDirectory(directory, storage, args.refuse)
    return await handleIdentity(handle)
  } finally {
    await handle.close()
  }
}

/**
One ordered lane per store: operations run in call order, and the lane
stays usable after the store's own typed failures. Anything else poisons
the lane so later work fails loudly instead of building on unknown state.
*/
export function createStoreQueue(
  isOwnError: (error: unknown) => boolean,
): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<void> = Promise.resolve()
  return async function ordered<T>(work: () => Promise<T>): Promise<T> {
    const before = queue
    const operation = (async () => {
      await before
      return await work()
    })()
    queue = (async () => {
      try {
        await operation
      } catch (error) {
        // The store's own typed failure is already recorded for the awaiting
        // caller; anything else poisons the queue so later work fails loudly
        // instead of building on unknown state.
        if (isOwnError(error)) return
        throw error
      }
    })()
    return await operation
  }
}
