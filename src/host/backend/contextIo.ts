// The file access behind the workspace context loaders (PLAN.md D13, D27):
// a file's raw bytes, so the loaders can tell UTF-8 from UTF-16 by its
// byte-order mark, and a skill root's entries with symbolic links and
// junctions included (a `Dirent` reports a link, and on Windows a junction,
// as neither a directory nor a file). Confinement and decoding are the
// loaders' (`src/core/context/contextFiles.ts`).

import { open, readdir, readFile, stat } from 'node:fs/promises'
import type { ContextIo } from '../../core/context/contextFiles'
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
