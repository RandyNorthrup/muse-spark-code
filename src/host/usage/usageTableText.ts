// The usage table's text for the Usage panel (read by usagePanelEntry.ts):
// the workspace read first, the installed disk copy when that read fails.
// The fallback is logged with the failure's kind, and the disk read's own
// failure still throws with its cause. VS Code-free, so the unit tests can
// drive it.
import { failureForLog } from '../../core/backends/musecode/logText'
import { readUsageTableFile } from '../../runtime/usage/usageTableFile'
import type { Logger } from '../logger'

/**
The usage table's text: the workspace read first, the installed disk
copy when that read fails. The fallback is logged with the failure's
kind, and the disk read's own failure still throws with its cause.
*/
export async function readHostUsageTableText(
  readPrimary: () => Promise<Uint8Array>,
  fsPath: string,
  segments: readonly string[],
  log: Logger,
): Promise<string> {
  try {
    return new TextDecoder().decode(await readPrimary())
  } catch (error: unknown) {
    log.warn(`Usage table fell back to the disk copy: ${failureForLog(error)}`)
    return await readUsageTableFile(fsPath, segments)
  }
}
