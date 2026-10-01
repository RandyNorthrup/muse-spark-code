// The import and share-file dialogs behind the conversation controller
// (M84, PLAN.md D49): picking a portable JSON file within the size cap and
// confirming an import. They need `vscode`; the controller takes them as a
// `SessionTransferFiles` dep, and the portable parse lives in
// `./sessionImport`.

import * as vscode from 'vscode'
import { SESSION_EXPORT_MAX_BYTES, UI_TEXT } from '../../shared/constants'
import { readPickedFile } from '../backend/toolIo'
import { canonicalPath } from '../canonicalPath'
import type { SessionTransferFiles } from './sessionImport'

const JSON_FILTER = 'JSON'
const JSON_EXTENSION = 'json'

/** The open dialog, the size cap, and the import confirmation behind the controller. */
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
      const { bytes, isMissing } = await readPickedFile(
        target.fsPath,
        SESSION_EXPORT_MAX_BYTES,
        expectedCanonicalPath,
        SESSION_EXPORT_MAX_BYTES,
      )
      // Moved or deleted (a sync client) between the dialog and the read.
      if (isMissing) {
        throw new Error(UI_TEXT.transferFileMissing)
      }
      if (bytes === undefined) {
        return { kind: 'tooLarge' }
      }
      // Invalid UTF-8 is refused rather than read as replacement characters,
      // in the panel's language (the decoder's own message is English); a
      // byte-order mark is dropped.
      try {
        return { kind: 'read', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
      } catch {
        throw new Error(UI_TEXT.textFileInvalid)
      }
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
