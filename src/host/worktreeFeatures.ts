// The VS Code side of "New worktree…" and "Remove worktree…" (M32, PLAN.md
// D30): the input box, the picks, the confirmations and the new window.
// The flows live in commands/worktreeCommands.ts.

import { existsSync } from 'node:fs'
import * as vscode from 'vscode'
import { UI_TEXT, VSCODE_COMMANDS } from '../shared/constants'
import { newWorktree, removeWorktree, type WorktreeDeps } from './commands/worktreeCommands'
import type { WorktreeRegistry } from './git/worktreeRegistry'
import type { Logger } from './logger'
import { loggedPopups } from './popups'

export interface WorktreeFeatureDeps {
  readonly workspaceRoot: string | undefined
  /** VS Code trust and the extension's held-PR ceiling, read per action. */
  readonly isWorkspaceTrusted: () => boolean
  /** git by absolute path (git.ts), with an optional per-call timeout. */
  readonly runGit: WorktreeDeps['runGit']
  /** Exact add/remove forms can run repository hooks; admit them before Git starts. */
  readonly mutationGit: WorktreeDeps['runGit']
  /** The worktree records every window reads (M71). */
  readonly registry: WorktreeRegistry
  readonly log: Logger
}

export interface WorktreeFeatures {
  newWorktree(): Promise<void>
  removeWorktree(): Promise<void>
}

/** A worktree's folder in a new window, and a plain popup: shared with M71's pull requests. */
export const newWindowActions = {
  openFolder: async (fsPath: string): Promise<void> => {
    await vscode.commands.executeCommand(VSCODE_COMMANDS.openFolder, vscode.Uri.file(fsPath), {
      forceNewWindow: true,
    })
  },
  showInformation: (message: string): void => {
    void vscode.window.showInformationMessage(message)
  },
}

export function createWorktreeFeatures(deps: WorktreeFeatureDeps): WorktreeFeatures {
  const flowDeps = (): WorktreeDeps => ({
    workspaceRoot: deps.workspaceRoot,
    platform: process.platform,
    isWorkspaceTrusted: deps.isWorkspaceTrusted,
    runGit: (args, cwd, timeoutMs, beforeRun) =>
      args[0] === 'worktree' && (args[1] === 'add' || args[1] === 'remove')
        ? deps.mutationGit(args, cwd, timeoutMs, beforeRun)
        : deps.runGit(args, cwd, timeoutMs, beforeRun),
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
    ...newWindowActions,
    recordWorktree: async (folder, branch, repositoryRoot) => {
      await deps.registry.put({
        folder,
        repositoryRoot,
        createdAt: Date.now(),
        branch,
        isHeld: false,
      })
    },
    ...loggedPopups(deps.log),
    log: deps.log,
  })
  return {
    newWorktree: () => newWorktree(flowDeps()),
    removeWorktree: () => removeWorktree(flowDeps()),
  }
}
