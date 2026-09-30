// A file's text as one digest (M68): what the model last saw of a file, so an
// edit never overwrites an unseen change (D27), and what an edit left, which
// everything done to the file afterwards checks first (`then_run`, the
// editor's reads; the Codex review of PR #54). Shared by the Model API's
// tools and the editor side, so both hash the same text the same way.

import { createHash } from 'node:crypto'

const FINGERPRINT_HASH = 'sha256'
// A file's bytes as the tools read them: strict UTF-8, a byte-order mark kept
// as a character, so the digest covers exactly what was written.
const FILE_TEXT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export function fingerprint(raw: string): string {
  return createHash(FINGERPRINT_HASH).update(raw).digest('hex')
}

/** The digest of a file's bytes, read as the tools read text; undefined for bytes that are not UTF-8. */
export function bytesFingerprint(bytes: Uint8Array): string | undefined {
  try {
    return fingerprint(FILE_TEXT.decode(bytes))
  } catch {
    // Not text the tools could have written: it matches no edit.
    return undefined
  }
}
