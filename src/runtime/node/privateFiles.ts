// Owner-only state, outside every tools workspace (D90.23).
import { constants, type BigIntStats } from 'node:fs'
import { mkdir, open, realpath, rename, unlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { handleIdentity, lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import {
  NODE_DIRECTORY_MODE,
  NODE_BIGINT_ZERO,
  NODE_SINGLE_LINK,
  NODE_FILE_MODE,
  NODE_PRIVATE_MODE_MASK,
  UI_TEXT,
} from '../../shared/constants'

// The platform identity source behind owner and substitution checks.
// Production passes the real sampler; a refusal drill passes a source that
// reports the tampered identity the check must refuse.
export interface NodeIdentitySource {
  lstatIdentity(file: string): Promise<BigIntStats>
  handleIdentity(handle: FileHandle): Promise<BigIntStats>
}

export class NodePrivateFiles {
  private readonly identity: NodeIdentitySource

  constructor(
    readonly root: string,
    identity?: NodeIdentitySource,
  ) {
    this.identity = identity ?? { lstatIdentity, handleIdentity }
  }

  private checkOwner(uid: bigint, mode: bigint): void {
    if (process.platform === 'win32' || process.getuid === undefined) {
      // A0 runs natively on Linux or WSL; a DACL adapter is not qualified.
      throw new Error(UI_TEXT.nodeErrors.unsupported)
    }
    if (
      uid !== BigInt(process.getuid()) ||
      (mode & BigInt(NODE_PRIVATE_MODE_MASK)) !== NODE_BIGINT_ZERO
    ) {
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    }
  }

  async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: NODE_DIRECTORY_MODE })
    const info = await this.identity.lstatIdentity(this.root)
    const resolved = await realpath(this.root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      path.resolve(resolved).replaceAll('\\', '/') !== path.resolve(this.root).replaceAll('\\', '/')
    )
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    this.checkOwner(info.uid, info.mode)
  }

  file(name: string): string {
    if (name === '.' || name === '..' || path.basename(name) !== name || name.includes('\\')) {
      throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    }
    return path.join(this.root, name)
  }

  async read(name: string, maxBytes: number): Promise<string> {
    await this.prepare()
    const file = this.file(name)
    const before = await this.identity.lstatIdentity(file)
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== NODE_SINGLE_LINK) {
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    }
    this.checkOwner(before.uid, before.mode)
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const held = await this.identity.handleIdentity(handle)
      if (!sameFile(before, held) || held.size > BigInt(maxBytes)) {
        throw new Error(UI_TEXT.nodeErrors.tooLarge)
      }
      const bytes = Buffer.alloc(maxBytes + 1)
      let length = 0
      for (;;) {
        const part = await handle.read(bytes, length, bytes.length - length, null)
        length += part.bytesRead
        if (length > maxBytes) throw new Error(UI_TEXT.nodeErrors.tooLarge)
        if (part.bytesRead === 0) break
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
    } finally {
      await handle.close()
    }
  }

  /** Fsync data before rename, then its directory; never overwrite through a link. */
  async write(name: string, text: string): Promise<void> {
    await this.prepare()
    const temporary = this.file(`${name}.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', NODE_FILE_MODE)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, this.file(name))
      const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY)
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } finally {
      // The temporary name is random and private. The next boot never treats
      // it as committed state.
      await removeTemporary(temporary)
    }
  }
}

// A successful rename already removed this name; anything else surfaces.
async function removeTemporary(temporary: string): Promise<void> {
  try {
    await unlink(temporary)
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
  }
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
