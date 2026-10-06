import { constants } from 'node:fs'
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises'
import pathModule from 'node:path'
import { randomBytes } from 'node:crypto'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { handleIdentity, lstatIdentity, sameFile } from '../../fs/fileIdentity'

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
  try {
    const sample = await file.stat()
    if (!sample.isFile() || sample.nlink !== 1 || sample.size > maxBytes)
      throw new Error(UI_TEXT.vault.noAccess)
    checkOwner(sample.mode, sample.uid)
    const result = Buffer.alloc(sample.size)
    let offset = 0
    while (offset < result.length) {
      const { bytesRead } = await file.read(result, offset, result.length - offset, offset)
      if (bytesRead === 0) throw new Error(UI_TEXT.vault.noAccess)
      offset += bytesRead
    }
    const extra = Buffer.alloc(1)
    const overflow = await file.read(extra, 0, 1, offset)
    if (overflow.bytesRead !== 0) throw new Error(UI_TEXT.vault.noAccess)
    return result
  } finally {
    await file.close()
  }
}
export async function writeVaultFile(path: string, bytes: Uint8Array): Promise<void> {
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
    await rename(temporary, path)
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
export async function appendVaultFile(path: string, bytes: Uint8Array): Promise<void> {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    ownerFile,
  )
  try {
    const sample = await file.stat()
    if (!sample.isFile() || sample.nlink !== 1) throw new Error(UI_TEXT.vault.noAccess)
    checkOwner(sample.mode, sample.uid)
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
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

/** Windows supplies native owner-DACL creation/verification; there is no POSIX-mode fallback. */
export interface VaultPrivateFilesPort {
  directory(path: string): Promise<void>
  read(path: string, maxBytes?: number): Promise<Buffer>
  replace(path: string, bytes: Uint8Array): Promise<void>
  append(path: string, bytes: Uint8Array): Promise<void>
  claim(path: string, bytes: Uint8Array): Promise<() => Promise<void>>
}
export class UnixVaultPrivateFiles implements VaultPrivateFilesPort {
  constructor() {
    if (process.platform === 'win32') throw new Error(UI_TEXT.vault.noAccess)
  }
  async directory(path: string): Promise<void> {
    await vaultPrivateDirectory(path)
  }
  async read(path: string, maxBytes?: number): Promise<Buffer> {
    return await readVaultFile(path, maxBytes)
  }
  async replace(path: string, bytes: Uint8Array): Promise<void> {
    await writeVaultFile(path, bytes)
  }
  async append(path: string, bytes: Uint8Array): Promise<void> {
    await appendVaultFile(path, bytes)
  }
  async claim(path: string, bytes: Uint8Array): Promise<() => Promise<void>> {
    return await vaultExclusiveFile(path, bytes)
  }
}
