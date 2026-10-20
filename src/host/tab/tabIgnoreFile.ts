// Whether an ignore file exists for Tab's reads (read by extension.ts):
// a missing file reads absent; a file that cannot be proven absent reads
// present, so a broken check narrows (never widens) what Tab reads. Never
// throws: the Tab typing path expects a boolean.
import { statSync } from 'node:fs'
import path from 'node:path'

/**
Whether an ignore file exists at an absolute path: missing reads absent,
anything else that cannot be proven absent reads present, so a broken
check denies (never widens) what Tab reads. Windows answers ENOENT where
POSIX answers ENOTDIR for a path that runs through a file, so a missing
entry proves absence only when the nearest existing ancestor is a folder.
*/
export function hasIgnoreFile(absolutePath: string): boolean {
  try {
    const found = statSync(absolutePath, { throwIfNoEntry: false })
    if (found !== undefined) return found.isFile()
    for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
      const ancestor = statSync(folder, { throwIfNoEntry: false })
      if (ancestor !== undefined) return !ancestor.isDirectory()
      if (path.dirname(folder) === folder) return true
    }
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
  }
}
