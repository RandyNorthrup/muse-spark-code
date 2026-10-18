// The portable half of the import and share-file dialogs (M84, PLAN.md
// D49): the picked file's shape, and parsing its text without a throw. The
// dialogs themselves need `vscode` and live in `./transferDialogs`; the
// conversation controller takes them as a `SessionTransferFiles` dep.

import { UI_TEXT } from '../../shared/constants'
import { parseSessionExport, type SessionExportParse } from '../../core/export/sessionTransfer'

/**
 * The picked bytes as text. Invalid UTF-8 is refused rather than read as
 * replacement characters, in the panel's language (the decoder's own message
 * is English); a byte-order mark is dropped. The refusal carries its cause.
 */
export function decodeTransferBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new Error(UI_TEXT.textFileInvalid, { cause: error })
  }
}

/** A picked file: dismissed, refused for its size, or its text. */
export type PickedTransferFile =
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'tooLarge' }
  | { readonly kind: 'read'; readonly content: string }

export interface SessionTransferFiles {
  /** The open dialog under `title`; throws when the file cannot be read or is not UTF-8. */
  pickTransferFile(title: string): Promise<PickedTransferFile>
  /** The import's confirmation; true resumes the file as a new session. */
  confirmImport(title: string, detail: string): Promise<boolean>
}

/** Parses a picked file's text; a syntax error reads as a failed parse, never a throw. */
export function readTransferDocument(content: string): SessionExportParse {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error: unknown) {
    // JSON.parse can quote the hostile file's contents, including credentials.
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, reason: UI_TEXT.transferNotAnExport }
  }
  return parseSessionExport(raw)
}
