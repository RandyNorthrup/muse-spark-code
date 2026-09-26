// The VS Code side of "Memory…" (M49, PLAN.md D41): the picks, the input
// boxes, the modal, the editor and the trash. The flow lives in
// commands/memoryCommands.ts, the notes in core/memory/memoryStore.ts.

import * as vscode from 'vscode'
import type { MemoryStore } from '../core/memory/memoryStore'
import { MUSE_MEMORY_DOCS_URL, UI_TEXT } from '../shared/constants'
import { showMemory } from './commands/memoryCommands'
import type { Logger } from './logger'
import { loggedPopups } from './popups'
import { showPickOne } from './quickPick'

export interface MemoryFeatureDeps {
  readonly store: MemoryStore
  readonly log: Logger
}

export interface MemoryFeatures {
  showMemory(): Promise<void>
}

export function createMemoryFeatures(deps: MemoryFeatureDeps): MemoryFeatures {
  return {
    showMemory: () =>
      showMemory({
        store: deps.store,
        pick: showPickOne,
        askName: (validate) =>
          Promise.resolve(
            vscode.window.showInputBox({
              title: UI_TEXT.memoryNamePrompt,
              placeHolder: UI_TEXT.memoryNamePlaceholder,
              ignoreFocusOut: true,
              validateInput: validate,
            }),
          ),
        askDescription: () =>
          Promise.resolve(
            vscode.window.showInputBox({
              title: UI_TEXT.memoryDescriptionPrompt,
              placeHolder: UI_TEXT.memoryDescriptionPlaceholder,
              ignoreFocusOut: true,
            }),
          ),
        confirm: async (message, detail, action) =>
          (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) ===
          action,
        openFile: async (fsPath) => {
          await vscode.window.showTextDocument(vscode.Uri.file(fsPath), { preview: false })
        },
        trash: async (fsPath) => {
          await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true })
          deps.log.info(`Memory note moved to the trash: ${fsPath}`)
        },
        openDocs: () => {
          void vscode.env.openExternal(vscode.Uri.parse(MUSE_MEMORY_DOCS_URL))
        },
        showInformation: (message) => {
          void vscode.window.showInformationMessage(message)
        },
        showError: loggedPopups(deps.log).showError,
      }),
  }
}
