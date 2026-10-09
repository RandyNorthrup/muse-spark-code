// Windows extended-length prefixes. The CLI's patch document names files
// as `\\?\C:\ws\notes.md` (verified live 2026-09-22), which `path.relative`
// would treat as a different root from `C:\ws`. Its own module: VS Code's
// language services need it at activation, edit review stays in its bundle.
import path from 'node:path'

const WIN_SEP = path.win32.sep
const UNC_PREFIX = `${WIN_SEP}${WIN_SEP}`
const EXTENDED_PREFIX = `${UNC_PREFIX}?${WIN_SEP}`
const EXTENDED_UNC_PREFIX = `${EXTENDED_PREFIX}UNC${WIN_SEP}`

/** The plain path behind a Windows extended-length (`\\?\`) path. */
export function stripExtendedLengthPrefix(filePath: string): string {
  if (filePath.startsWith(EXTENDED_UNC_PREFIX)) {
    return `${UNC_PREFIX}${filePath.slice(EXTENDED_UNC_PREFIX.length)}`
  }
  return filePath.startsWith(EXTENDED_PREFIX) ? filePath.slice(EXTENDED_PREFIX.length) : filePath
}
