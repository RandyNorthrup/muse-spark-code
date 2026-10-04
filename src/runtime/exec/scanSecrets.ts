import type { Readable } from 'node:stream'
import { countSecretMatches } from '../../core/redact'
import {
  EXEC_EXIT,
  EXEC_SCAN_EXIT_FOUND,
  EXEC_SCAN_MAX_BYTES,
  EXEC_STOP_GRACE_MS,
  UI_TEXT,
} from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { FdWriter } from './fdWriter'
import { readKeyLine } from './keyInput'

export async function runSecretScan(input: {
  file: string
  keyFromStdin: boolean
  stdin: Readable
  signal: AbortSignal
  readFile: (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  out: FdWriter
}): Promise<typeof EXEC_EXIT.ok | typeof EXEC_SCAN_EXIT_FOUND | typeof EXEC_EXIT.usage> {
  const held: { key: string | undefined } = { key: undefined }
  try {
    input.signal.throwIfAborted()
    if (input.keyFromStdin) {
      const read = await readKeyLine(input.stdin, input.signal)
      if (!read.ok) return EXEC_EXIT.usage
      held.key = read.key
    }
    const bytes = await input.readFile(input.file, EXEC_SCAN_MAX_BYTES, input.signal)
    input.signal.throwIfAborted()
    if (bytes.length > EXEC_SCAN_MAX_BYTES) return EXEC_EXIT.usage
    if (input.out.isClosed) return EXEC_EXIT.usage
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const count = countSecretMatches(text, held.key === undefined ? [] : [held.key])
    input.out.write(`${plural(UI_TEXT.execScanMatches, count)}\n`)
    if (!(await input.out.flush(EXEC_STOP_GRACE_MS)) || input.signal.aborted) return EXEC_EXIT.usage
    return count === 0 ? EXEC_EXIT.ok : EXEC_SCAN_EXIT_FOUND
  } catch {
    // Scanner refuses rather than echoing a key, file, path or exception.
    return EXEC_EXIT.usage
  } finally {
    held.key = undefined
  }
}
