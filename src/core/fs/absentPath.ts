import { statSync } from 'node:fs'
import path from 'node:path'

/**
Whether a path that just failed with ENOENT is really absent: its nearest
existing ancestor is a folder. Windows answers ENOENT where POSIX answers
ENOTDIR for a path that runs through a file, so ENOENT alone cannot tell
"no record yet" from "a file stands where a folder should be"; the second
is damage, never absence. The ENOENT that sends a caller here means the
operating system walked through every existing ancestor, so examining them
does not fail but for a concurrent change, which then throws its own error.
*/
export function isAbsentBelowFolder(absolutePath: string): boolean {
  for (let folder = path.dirname(absolutePath); ; folder = path.dirname(folder)) {
    const ancestor = statSync(folder, { throwIfNoEntry: false })
    if (ancestor !== undefined) return ancestor.isDirectory()
    if (path.dirname(folder) === folder) return false
  }
}
