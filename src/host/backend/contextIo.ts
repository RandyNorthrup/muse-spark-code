// The file access behind the workspace context loaders (PLAN.md D13, D27):
// a file's raw bytes, so the loaders can tell UTF-8 from UTF-16 by its
// byte-order mark, and a skill root's entries with symbolic links and
// junctions included (a `Dirent` reports a link, and on Windows a junction,
// as neither a directory nor a file). Confinement and decoding are the
// loaders' (`src/core/context/contextFiles.ts`).

import { readdir, readFile } from 'node:fs/promises'
import type { ContextIo } from '../../core/context/contextFiles'
import { canonicalPath, isMissingPath } from '../canonicalPath'

export const fileContextIo: ContextIo = {
  async readFile(absolutePath) {
    try {
      return await readFile(absolutePath)
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
