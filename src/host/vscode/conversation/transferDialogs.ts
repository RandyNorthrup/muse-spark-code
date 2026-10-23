// The import and share-file dialogs behind the conversation controller
// (M84, PLAN.md D49): picking a portable JSON file of any size and
// confirming an import. They need `vscode`; the controller takes them as a
// `SessionTransferFiles` dep, and the portable parse lives in
// `../../conversation/sessionImport`.

import * as vscode from 'vscode'
import { UI_TEXT } from '../../../shared/constants'
import { decodeTransferBytes, readPickedFile } from '../../backend/toolIo'
import { canonicalPath } from '../../canonicalPath'
import type { SessionTransferFiles } from '../../conversation/sessionImport'

const JSON_FILTER = 'JSON'
const JSON_EXTENSION = 'json'

/** The open dialog and the import confirmation behind the controller. */
export function createSessionTransferFiles(): SessionTransferFiles {
  return {
    async pickTransferFile(title) {
      const picked = await vscode.window.showOpenDialog({
        title,
        filters: { [JSON_FILTER]: [JSON_EXTENSION] },
        canSelectMany: false,
      })
      const [target] = picked ?? []
      if (target === undefined) {
        return { kind: 'dismissed' }
      }
      if (target.scheme !== 'file') {
        throw new Error(UI_TEXT.transferLocalFileOnly)
      }
      const expectedCanonicalPath = await canonicalPath(target.fsPath)
      // A share file reads whole at any size (D121: the removed 16 MiB
      // ceiling and the removed 20,000-item bound were invented), so every
      // file written can be read back; a transcript of any length parses.
      const { bytes, isMissing } = await readPickedFile(
        target.fsPath,
        Infinity,
        expectedCanonicalPath,
        Infinity,
      )
      // Moved or deleted (a sync client) between the dialog and the read.
      // The read is unbounded, so missing bytes mean the same: the file
      // went away.
      if (isMissing || bytes === undefined) {
        throw new Error(UI_TEXT.transferFileMissing)
      }
      // Invalid UTF-8 is refused rather than read as replacement characters,
      // in the panel's language (the decoder's own message is English); a
      // byte-order mark is dropped. The refusal carries its cause.
      return { kind: 'read', content: decodeTransferBytes(bytes) }
    },
    async confirmImport(title, detail) {
      return (
        (await vscode.window.showInformationMessage(
          title,
          { modal: true, detail },
          UI_TEXT.importConfirmAction,
        )) === UI_TEXT.importConfirmAction
      )
    },
  }
}
