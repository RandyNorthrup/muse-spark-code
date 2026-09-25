// The VS Code side of "New worktree…" and "Remove worktree…" (M32, PLAN.md
// D30): the input box, the picks, the confirmations and the new window.
// The flows live in commands/worktreeCommands.ts.

import { existsSync } from 'node:fs'
import * as vscode from 'vscode'
import { UI_TEXT, VSCODE_COMMANDS } from '../shared/constants'
import { newWorktree, removeWorktree, type WorktreeDeps } from './commands/worktreeCommands'
import type { Logger } from './logger'
import { loggedPopups } from './popups'

export interface WorktreeFeatureDeps {
  readonly workspaceRoot: string | undefined
  /** git by absolute path (git.ts), with an optional per-call timeout. */
  readonly runGit: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
  readonly log: Logger
}

export interface WorktreeFeatures {
  newWorktree(): Promise<void>
  removeWorktree(): Promise<void>
}

export function createWorktreeFeatures(deps: WorktreeFeatureDeps): WorktreeFeatures {
  const flowDeps = (): WorktreeDeps => ({
    workspaceRoot: deps.workspaceRoot,
    platform: process.platform,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    runGit: deps.runGit,
    pathExists: existsSync,
    askBranchName: (validate) =>
      Promise.resolve(
        vscode.window.showInputBox({
          title: UI_TEXT.worktreeBranchPrompt,
          placeHolder: UI_TEXT.worktreeBranchPlaceholder,
          ignoreFocusOut: true,
          validateInput: validate,
        }),
      ),
    pick: async (items, title, placeholder) => {
      const choice = await vscode.window.showQuickPick(
        items.map((item) => ({ ...item })),
        { title, placeHolder: placeholder, matchOnDescription: true },
      )
      return choice?.id
    },
    confirm: async (message, detail, action) =>
      (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action,
    offerOpen: async (message) =>
      (await vscode.window.showInformationMessage(message, UI_TEXT.worktreeOpen)) ===
      UI_TEXT.worktreeOpen,
    openFolder: async (fsPath) => {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.openFolder, vscode.Uri.file(fsPath), {
        forceNewWindow: true,
      })
    },
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message)
    },
    ...loggedPopups(deps.log),
    log: deps.log,
  })
  return {
    newWorktree: () => newWorktree(flowDeps()),
    removeWorktree: () => removeWorktree(flowDeps()),
  }
}
