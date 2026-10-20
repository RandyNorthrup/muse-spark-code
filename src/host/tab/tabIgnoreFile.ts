// Whether an ignore file exists for Tab's reads (read by extension.ts):
// a missing file reads absent; a file that cannot be proven absent reads
// present, so a broken check narrows (never widens) what Tab reads. Never
// throws: the Tab typing path expects a boolean.
import { statSync } from 'node:fs'

/**
Whether an ignore file exists at an absolute path: missing reads absent,
anything else that cannot be proven absent reads present, so a broken
check denies (never widens) what Tab reads.
*/
export function hasIgnoreFile(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isFile()
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
  }
}
