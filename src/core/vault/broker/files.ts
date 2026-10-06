import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises'
import pathModule from 'node:path'
import { randomBytes } from 'node:crypto'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import {
  handleIdentity,
  lstatIdentity,
  sameFile,
  handleIdentitySync,
  lstatIdentitySync,
} from '../../fs/fileIdentity'

const ownerFile = constants.S_IRUSR | constants.S_IWUSR
const ownerDirectory = ownerFile | constants.S_IXUSR
function checkOwner(mode: number, uid: number): void {
  if (
    (mode & (constants.S_IRWXG | constants.S_IRWXO)) !== 0 ||
    (process.getuid && uid !== process.getuid())
  )
    throw new Error(UI_TEXT.vault.noAccess)
}
export async function vaultPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: ownerDirectory })
  const sample = await lstat(path)
  if (!sample.isDirectory() || sample.isSymbolicLink()) throw new Error(UI_TEXT.vault.noAccess)
  checkOwner(sample.mode, sample.uid)
}
export async function readVaultFile(
  path: string,
  maxBytes = VAULT_LIMITS.frameBytes,
): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let result: Buffer | undefined
  const extra = Buffer.alloc(1)
  let hasTransferred = false
  try {
    try {
      const sample = await file.stat()
      if (!sample.isFile() || sample.nlink !== 1 || sample.size > maxBytes)
        throw new Error(UI_TEXT.vault.noAccess)
      checkOwner(sample.mode, sample.uid)
      result = Buffer.alloc(sample.size)
      let offset = 0
      while (offset < result.length) {
        const { bytesRead } = await file.read(result, offset, result.length - offset, offset)
        if (bytesRead === 0) throw new Error(UI_TEXT.vault.noAccess)
        offset += bytesRead
      }
      const overflow = await file.read(extra, 0, 1, offset)
      if (overflow.bytesRead !== 0) throw new Error(UI_TEXT.vault.noAccess)
    } finally {
      await file.close()
    }
    hasTransferred = true
    return result
  } finally {
    extra.fill(0)
    if (!hasTransferred) result?.fill(0)
  }
}
export async function writeVaultFile(
  path: string,
  bytes: Uint8Array,
  authorize?: () => void,
): Promise<void> {
  await vaultPrivateDirectory(pathModule.dirname(path))
  const temporary = `${path}.${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}.tmp`
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    ownerFile,
  )
  try {
    await file.writeFile(bytes)
    await file.sync()
    await file.close()
    if (authorize) {
      authorize()
      renameSync(temporary, path)
    } else await rename(temporary, path)
    const directory = await open(pathModule.dirname(path), constants.O_RDONLY)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error: unknown) {
    await file.close()
    try {
      await unlink(temporary)
    } catch {
      /* The rename may already have consumed this private temporary. */
    }
    throw error
  }
}
/** Cleanup only the file we created; never unlink a replacement from a competing process. */
export async function vaultExclusiveFile(
  path: string,
  bytes: Uint8Array,
): Promise<() => Promise<void>> {
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    ownerFile,
  )
  try {
    await file.writeFile(bytes)
    await file.sync()
  } catch (error: unknown) {
    await file.close()
    throw error
  }
  const identity = await handleIdentity(file)
  return async () => {
    try {
      if (sameFile(identity, await lstatIdentity(path))) await unlink(path)
    } finally {
      await file.close()
    }
  }
}
export function isVaultFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** A writer owns one descriptor. Commit and close are synchronous, so neither can cross a barrier. */
export interface VaultFileWriter {
  append(bytes: Uint8Array): void
  replace(bytes: Uint8Array): void
  close(): void
}
const writePrivateBytes = (fd: number, bytes: Uint8Array): void => {
  let offset = 0
  while (offset < bytes.byteLength) {
    const count = writeSync(fd, bytes, offset, bytes.byteLength - offset)
    if (count === 0) throw new Error(UI_TEXT.vault.noAccess)
    offset += count
  }
  fsyncSync(fd)
}
function privateWriter(path: string): VaultFileWriter {
  const flags =
    constants.O_WRONLY |
    constants.O_APPEND |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK
  let descriptor: number | null = openSync(path, flags, ownerFile)
  const initial = fstatSync(descriptor)
  if (!initial.isFile() || initial.nlink !== 1) {
    closeSync(descriptor)
    throw new Error(UI_TEXT.vault.noAccess)
  }
  try {
    checkOwner(initial.mode, initial.uid)
  } catch (error: unknown) {
    closeSync(descriptor)
    throw error
  }
  const current = (): number => {
    if (descriptor === null) throw new Error(UI_TEXT.vault.locked)
    const held = handleIdentitySync(descriptor),
      named = lstatIdentitySync(path)
    if (!sameFile(held, named)) {
      closeSync(descriptor)
      descriptor = null
      const replacement = openSync(path, flags, ownerFile),
        sample = fstatSync(replacement)
      try {
        if (!sample.isFile() || sample.nlink !== 1) throw new Error(UI_TEXT.vault.noAccess)
        checkOwner(sample.mode, sample.uid)
      } catch (error: unknown) {
        closeSync(replacement)
        throw error
      }
      descriptor = replacement
    }
    return descriptor
  }

  return {
    append: (bytes) => {
      writePrivateBytes(current(), bytes)
    },
    replace: (bytes) => {
      current()
      const temporary = `${path}.${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}.tmp`
      const fd = openSync(
        temporary,
        constants.O_WRONLY |
          constants.O_APPEND |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        ownerFile,
      )
      try {
        writePrivateBytes(fd, bytes)
        const previous = current()
        renameSync(temporary, path)
        closeSync(previous)
        descriptor = fd
        const directory = openSync(pathModule.dirname(path), constants.O_RDONLY)
        try {
          fsyncSync(directory)
        } finally {
          closeSync(directory)
        }
      } catch (error: unknown) {
        if (descriptor !== fd) closeSync(fd)
        try {
          unlinkSync(temporary)
        } catch {
          /* Rename may have consumed this owned file. */
        }
        throw error
      }
    },
    close: () => {
      if (descriptor === null) {
        return
      }

      closeSync(descriptor)
      descriptor = null
    },
  }
}

/** Windows supplies native owner-DACL creation/verification; there is no POSIX-mode fallback. */
export interface VaultPrivateFilesPort {
  writer(path: string): VaultFileWriter
  directory(path: string): Promise<void>
  read(path: string, maxBytes?: number): Promise<Buffer>
  replace(path: string, bytes: Uint8Array, authorize?: () => void): Promise<void>
  claim(path: string, bytes: Uint8Array): Promise<() => Promise<void>>
}
export class UnixVaultPrivateFiles implements VaultPrivateFilesPort {
  constructor() {
    if (process.platform === 'win32') throw new Error(UI_TEXT.vault.noAccess)
  }
  writer(path: string): VaultFileWriter {
    return privateWriter(path)
  }
  async directory(path: string): Promise<void> {
    await vaultPrivateDirectory(path)
  }
  async read(path: string, maxBytes?: number): Promise<Buffer> {
    return await readVaultFile(path, maxBytes)
  }
  async replace(path: string, bytes: Uint8Array, authorize?: () => void): Promise<void> {
    await writeVaultFile(path, bytes, authorize)
  }
  async claim(path: string, bytes: Uint8Array): Promise<() => Promise<void>> {
    return await vaultExclusiveFile(path, bytes)
  }
}
