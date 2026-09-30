// The VS Code side of "Memory…" (M49, PLAN.md D41): the picks, the input
// boxes, the modal, the editor and the trash. The flow lives in
// commands/memoryCommands.ts, the notes in core/memory/memoryStore.ts.

import * as vscode from 'vscode'
import type { MemoryStore } from '../core/memory/memoryStore'
import { MUSE_MEMORY_DOCS_URL, UI_TEXT } from '../shared/constants'
import { type MemoryEdit, showMemory } from './commands/memoryCommands'
import type { Logger } from './logger'
import { loggedPopups } from './popups'
import { showPickOne } from './quickPick'

export interface MemoryFeatureDeps {
  readonly store: MemoryStore
  readonly log: Logger
  readonly edit: MemoryEdit
  /** Keeps a note's bytes for a checkpoint restore before it is deleted. */
  readonly beforeDelete: (absolutePath: string) => Promise<void>
}

export interface MemoryFeatures {
  showMemory(): Promise<void>
}

export function createMemoryFeatures(deps: MemoryFeatureDeps): MemoryFeatures {
  return {
    showMemory: () =>
      showMemory({
        store: deps.store,
        edit: deps.edit,
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
        trash: async (fsPath, assertCanWrite) => {
          await deps.beforeDelete(fsPath)
          // VS Code's delete has no publication callback: the guard speaks last, right before it.
          assertCanWrite()
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
