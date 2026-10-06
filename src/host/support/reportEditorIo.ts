// VS Code's side of the report's exports (M93, PLAN.md D72): the clipboard,
// the user's browser, the save picker and VS Code's own issue reporter. The
// export paths and the dialog's bundle take it as `ReportEditorIo`, so they
// reach no `vscode` themselves. Nothing here shows a notification: the
// dialog's status line says each outcome.

import * as vscode from 'vscode'
import { VSCODE_COMMANDS } from '../../shared/constants'
import type { ReportEditorIo } from './reportProblem'

const MARKDOWN_FILTER = 'Markdown'
const REPORT_FILE_EXTENSION = 'md'

export const vscodeReportEditorIo: ReportEditorIo = {
  async writeClipboard(text) {
    await vscode.env.clipboard.writeText(text)
  },
  async openExternal(url) {
    return await vscode.env.openExternal(vscode.Uri.parse(url))
  },
  async saveText(text) {
    const target = await vscode.window.showSaveDialog({
      filters: { [MARKDOWN_FILTER]: [REPORT_FILE_EXTENSION] },
    })
    if (target === undefined) {
      return false
    }
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text))
    return true
  },
  async openIssueReporter(prefill) {
    // VS Code 1.99's prefill (D72): the supported title and body fields
    // only. `data` is deliberately never passed: it is absent from the
    // documented option schema.
    await vscode.commands.executeCommand(VSCODE_COMMANDS.openIssueReporter, prefill)
  },
}
