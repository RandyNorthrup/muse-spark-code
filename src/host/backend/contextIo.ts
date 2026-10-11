// The file access behind the workspace context loaders (PLAN.md D13, D27):
// a file's raw bytes, so the loaders can tell UTF-8 from UTF-16 by its
// byte-order mark, and a skill root's entries with symbolic links and
// junctions included (a `Dirent` reports a link, and on Windows a junction,
// as neither a directory nor a file). Confinement and decoding are the
// loaders' (`src/core/context/contextFiles.ts`).

import { fileReadIdentity } from '../../core/fs/fileIdentity'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import type { ContextIo } from '../../core/context/contextFiles'
import { handleIdentity, statIdentity, sameFile } from '../../core/fs/fileIdentity'
import { isSamePath } from '../../core/paths'
import { FILE_REFUSAL_MODEL_TEXT } from '../../shared/constants'
import { contentHash } from '../../core/schedules/provenance'
import { canonicalPath, isMissingPath } from '../canonicalPath'

/**
 * At most `maxBytes + 1` bytes of a regular file (M76): the catalogs cap a
 * file the repository ships, and a cap checked after a whole read would not
 * stop a huge file, a pipe that never ends or a device that blocks.
 */
async function readCapped(absolutePath: string, maxBytes: number): Promise<Uint8Array> {
  const info = await stat(absolutePath)
  if (!info.isFile()) {
    throw new Error(`${absolutePath} is not a regular file`)
  }
  const wanted = Math.min(info.size, maxBytes + 1)
  const handle = await open(absolutePath, 'r')
  try {
    const buffer = Buffer.alloc(wanted)
    let filled = 0
    while (filled < wanted) {
      const { bytesRead } = await handle.read(buffer, filled, wanted - filled, filled)
      if (bytesRead === 0) {
        break
      }
      filled += bytesRead
    }
    return buffer.subarray(0, filled)
  } finally {
    await handle.close()
  }
}

export const fileContextIo: ContextIo = {
  async readSource(absolutePath, maxBytes) {
    let handle
    try {
      const canonical = await canonicalPath(absolutePath)
      handle = await open(canonical, 'r')
      const info = await handleIdentity(handle)
      if (!info.isFile()) throw new Error(`${canonical} is not a regular file`)
      const assertSource = async () => {
        if (
          !isSamePath(canonical, await canonicalPath(canonical), process.platform) ||
          !sameFile(info, await statIdentity(canonical))
        )
          throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
      await assertSource()
      const bytes =
        maxBytes === undefined
          ? await handle.readFile()
          : Buffer.alloc(Math.min(Number(info.size), maxBytes + 1))
      if (maxBytes !== undefined) {
        let filled = 0
        while (filled < bytes.length) {
          const read = await handle.read(bytes, filled, bytes.length - filled, filled)
          if (read.bytesRead === 0) break
          filled += read.bytesRead
        }
        if (filled !== bytes.length)
          throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
      const after = await handleIdentity(handle)
      await assertSource()
      if (info.size !== after.size || info.mtimeNs !== after.mtimeNs)
        throw new Error(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      return {
        bytes,
        source: {
          kind: 'file',
          contentHash: contentHash(bytes),
          file: {
            path: canonical.replaceAll('\\', '/'),
            ...fileReadIdentity(info),
          },
        },
      }
    } catch (error: unknown) {
      if (isMissingPath(error)) return
      throw error
    } finally {
      await handle?.close()
    }
  },
  async readFile(absolutePath, maxBytes) {
    try {
      return maxBytes === undefined
        ? await readFile(absolutePath)
        : await readCapped(absolutePath, maxBytes)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return
      }
      throw error
    }
  },
  async listDirectory(absolutePath) {
    try {
      const entries = await readdir(absolutePath, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
    } catch (error: unknown) {
      if (isMissingPath(error)) {
        return []
      }
      throw error
    }
  },
  realPath: canonicalPath,
}
