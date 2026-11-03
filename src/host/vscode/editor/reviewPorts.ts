// The edit review's two editor-facing ports as VS Code provides them: a
// Revert's publishing with the editor's own trash, and the editor's diff
// command. Shared so the M104g suite drives what the extension wires.

import * as vscode from 'vscode'
import { VSCODE_COMMANDS } from '../../../shared/constants'
import type { EditReviewDeps } from '../../editor/editReview'
import { createRevertIo, type RevertIoDeps } from '../../editor/revertIo'

export function vscodeReviewPorts(io: RevertIoDeps['io']): Pick<EditReviewDeps, 'io' | 'openDiff'> {
  return {
    io: createRevertIo({
      io,
      platform: process.platform,
      trash: async (fsPath) => {
        await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true })
      },
    }),
    openDiff: async (beforeUri, fsPath, title) => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.diff,
        vscode.Uri.parse(beforeUri),
        vscode.Uri.file(fsPath),
        title,
      )
    },
  }
}
