// A judged batch's temporary folder: made per batch, removed after, even
// on failure. Windows can hold a removed file a moment longer (a scanner,
// the side session still exiting), so the removal retries the held-file
// failures a bounded number of times; anything else, or the last attempt,
// keeps failing with the real error. No `vscode` import.
import { rm } from 'node:fs/promises'
import { failureForLog } from '../../core/backends/musecode/logText'
import { storeErrorCode } from '../backend/storeErrors'
import { JUDGE_TEMP_REMOVE_ATTEMPTS, JUDGE_TEMP_REMOVE_RETRY_MS } from '../../shared/constants'

/** What the filesystem says about a file held a moment longer. */
const HELD_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])

function codeOf(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/** A held-file failure, worth one more attempt. */
function isHeldFileError(error: unknown): boolean {
  const code = codeOf(error)
  return code !== undefined && HELD_CODES.has(code)
}

/** A removal failure as the log names it: its code, never its path. */
export function judgeRemovalFailureForLog(error: unknown): string {
  return storeErrorCode(error) ?? failureForLog(error)
}

/**
Remove one batch folder, handing its failure back instead of throwing:
the caller logs it once and goes on without the folder.
*/
export async function removeTempRootSettled(remove: () => Promise<void>): Promise<unknown> {
  try {
    await remove()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/**
Remove one batch folder, waiting out a momentarily held file. A gone
folder is done (`force`); a held file retries bounded; anything else
throws at once instead of burning the attempts.
*/
export async function removeJudgeTempRoot(
  root: string,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  const wait =
    sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error: unknown) {
      // Windows holds the file briefly: each attempt retries while it
      // does. Anything else, or the last attempt, keeps failing.
      if (!isHeldFileError(error) || attempt >= JUDGE_TEMP_REMOVE_ATTEMPTS) {
        throw error
      }
    }
    await wait(JUDGE_TEMP_REMOVE_RETRY_MS)
  }
}
