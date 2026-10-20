// Whether an ignore file exists for Tab's reads (read by extension.ts):
// a missing file reads absent; a file that cannot be proven absent reads
// present, so a broken check narrows (never widens) what Tab reads. Never
// throws: the Tab typing path expects a boolean.
import { statSync } from 'node:fs'
import path from 'node:path'

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/**
Whether the nearest existing ancestor of a missing path is a folder. Windows
answers ENOENT for a path that runs through a file (POSIX answers ENOTDIR),
so a missing entry proves absence only when the first ancestor that exists
is a folder.
*/
function isMissingUnderFolder(absolutePath: string): boolean {
  for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
    try {
      return statSync(folder).isDirectory()
    } catch (error: unknown) {
      if (!isMissing(error) || path.dirname(folder) === folder) return false
    }
  }
}

/**
Whether an ignore file exists at an absolute path: missing reads absent,
anything else that cannot be proven absent reads present, so a broken
check denies (never widens) what Tab reads.
*/
export function hasIgnoreFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile()
  } catch (error: unknown) {
    return !(isMissing(error) && isMissingUnderFolder(absolutePath))
  }
}
