// Theia can acknowledge a successful reveal before its visible-editor delta
// reaches the plugin host, then reject showTextDocument. Wait for that delta
// without revealing twice, taking focus, or treating a real failure as success.
import * as vscode from 'vscode'
import {
  EDITOR_REVEAL_MAX_MS,
  EDITOR_REVEAL_POLL_MS,
  THEIA_SHOW_DOCUMENT_FAILURE,
} from '../../shared/constants'

export async function showEditorDocument(
  document: vscode.TextDocument,
  options: vscode.TextDocumentShowOptions = {},
  isAllowed?: () => boolean,
): Promise<vscode.TextEditor> {
  try {
    return await vscode.window.showTextDocument(document, options)
  } catch (error: unknown) {
    if (!(error instanceof Error) || !error.message.startsWith(THEIA_SHOW_DOCUMENT_FAILURE)) {
      throw error
    }
    const deadline = Date.now() + EDITOR_REVEAL_MAX_MS
    while (isAllowed?.() !== false) {
      const shown = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.toString() === document.uri.toString(),
      )
      if (shown !== undefined) return shown
      if (Date.now() >= deadline) break
      await new Promise<void>((resolve) => {
        setTimeout(resolve, EDITOR_REVEAL_POLL_MS)
      })
    }
    throw error
  }
}
