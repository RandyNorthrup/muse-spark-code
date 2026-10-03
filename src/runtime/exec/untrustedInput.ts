import path from 'node:path'
import {
  EXEC_CHUNK_NEWLINE_LOOKBACK_CHARS,
  EXEC_MARKER_BYTES,
  EXEC_UNTRUSTED_CHUNKS_MAX,
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  EXEC_UNTRUSTED_FILES_MAX,
  EXEC_UNTRUSTED_TOTAL_MAX_BYTES,
  MODEL_TEXT,
  SELECTION_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { ExecInputRecord } from './execProtocol'

/**
 * A file name as it stands in the lead, outside the markers: a JSON string
 * (quotes, backslashes and C0 controls escaped), with every other control,
 * format or separator character percent-encoded, so a name cannot leave its
 * line or pass for the lead's own words.
 */
function quotedName(name: string): string {
  return JSON.stringify(name).replaceAll(/[\p{C}\p{Zl}\p{Zp}]/gu, (char) =>
    encodeURIComponent(char),
  )
}

export async function readUntrustedInputs(input: {
  files: readonly string[]
  signal: AbortSignal
  readFile: (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  randomHex: (bytes: number) => string
}): Promise<{
  resources: readonly { name: string; text: string }[]
  records: readonly ExecInputRecord[]
}> {
  if (input.files.length > EXEC_UNTRUSTED_FILES_MAX)
    throw new Error(plural(UI_TEXT.execTooManyFiles, EXEC_UNTRUSTED_FILES_MAX))
  const resources: { name: string; text: string }[] = []
  const records: ExecInputRecord[] = []
  let total = 0
  for (const file of input.files) {
    input.signal.throwIfAborted()
    const bytes = await input.readFile(file, EXEC_UNTRUSTED_FILE_MAX_BYTES, input.signal)
    total += bytes.byteLength
    if (bytes.byteLength > EXEC_UNTRUSTED_FILE_MAX_BYTES || total > EXEC_UNTRUSTED_TOTAL_MAX_BYTES)
      throw new Error(UI_TEXT.execFileTooLarge)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const name = path.basename(file)
    const label = quotedName(name)
    const pieces: { marker: string; text: string }[] = []
    let offset = 0
    do {
      const marker = input.randomHex(EXEC_MARKER_BYTES)
      const envelope = (slice: string, part: number, parts: number) =>
        [
          fill(MODEL_TEXT.execUntrustedLead, { name: label, part, parts }),
          fill(MODEL_TEXT.execUntrustedOpen, { marker }),
          slice,
          fill(MODEL_TEXT.execUntrustedClose, { marker }),
        ].join('\n')
      const capacity =
        SELECTION_TEXT_MAX_CHARS -
        envelope('', EXEC_UNTRUSTED_CHUNKS_MAX, EXEC_UNTRUSTED_CHUNKS_MAX).length
      if (capacity < 1) throw new Error(UI_TEXT.execTooManyChunks)
      let end = Math.min(text.length, offset + capacity)
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end - 1)
        if (newline >= Math.max(offset, end - EXEC_CHUNK_NEWLINE_LOOKBACK_CHARS)) end = newline + 1
        // Avoid separating a UTF-16 surrogate pair: the ACP serializer must
        // preserve the original code point, including at a chunk boundary.
        if (
          text.slice(end - 1, end + 1).length === 2 &&
          /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(text.slice(end - 1, end + 1))
        )
          end -= 1
      }
      pieces.push({ marker, text: text.slice(offset, end) })
      if (resources.length + pieces.length > EXEC_UNTRUSTED_CHUNKS_MAX)
        throw new Error(UI_TEXT.execTooManyChunks)
      offset = end
    } while (offset < text.length)
    for (const [index, piece] of pieces.entries()) {
      resources.push({
        name,
        text: [
          fill(MODEL_TEXT.execUntrustedLead, {
            name: label,
            part: index + 1,
            parts: pieces.length,
          }),
          fill(MODEL_TEXT.execUntrustedOpen, { marker: piece.marker }),
          piece.text,
          fill(MODEL_TEXT.execUntrustedClose, { marker: piece.marker }),
        ].join('\n'),
      })
    }
    records.push({ name, bytes: bytes.byteLength, chunks: pieces.length, complete: true })
  }
  return { resources, records }
}
