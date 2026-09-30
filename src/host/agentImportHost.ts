// The VS Code side of "Import from other agents" (M83, PLAN.md D49): the
// pickers, the read-only preview, the modals, the clipboard and the editor.
// The scan, the plan, the writes and the flow are the import's own bundle
// (`agentImportEntry.ts`, loaded by `agentImportBundle.ts` on the first
// import), so this file holds only what needs `vscode`.

import { homedir } from 'node:os'
import * as vscode from 'vscode'
import type { AgentImportBundle } from './agentImportBundle'
import type { AgentImportHost, AgentImportSourceChoice } from './commands/agentImportCommands'
import type { EditedFile } from '../core/verify/diagnosticsReport'
import type { WorkspaceEditRecorder } from '../core/verify/workspaceEdits'
import { UI_TEXT } from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'
import type { Logger } from './logger'
import { loggedPopups } from './popups'

export interface AgentImportHostDeps {
  readonly workspaceRoot: string | undefined
  readonly isActive: () => boolean
  /** The window's first folder as VS Code names it now. */
  readonly currentRoot: () => string | undefined
  readonly captureOwner?: () => WorkspaceEditRecorder | undefined
  readonly beginEdit?: (
    file: EditedFile,
    owner: WorkspaceEditRecorder | undefined,
  ) => (wasWritten: boolean) => void
  /** The checkpoint lease for the project writes, and the copy before each (M72). */
  readonly editProject: AgentImportHost['editProject']
  readonly beforeProjectWrite: AgentImportHost['beforeProjectWrite']
  /** Muse Code's settings file where `muse serve` reads it. */
  readonly museSettingsPath: () => string
  /** Opens text as a read-only document titled by its path's last segment. */
  readonly openDocument: (title: string, content: string) => Promise<void>
  /** The import's bundle, loaded on the first import. */
  readonly bundle: () => AgentImportBundle
  readonly log: Logger
}

interface SourceChoice extends vscode.QuickPickItem {
  readonly choice: AgentImportSourceChoice
}

const UNTITLED_SCHEME = 'untitled'

/** Built when asked, so the labels come from the table installed at activation. */
function sourceChoices(): readonly SourceChoice[] {
  return [
    { label: UI_TEXT.agentImportSourceAll, choice: 'all' },
    { label: UI_TEXT.importSourceClaude, choice: 'claudeCode' },
    { label: UI_TEXT.importSourceCodex, choice: 'codex' },
    { label: UI_TEXT.agentImportSourceCursor, choice: 'cursor' },
  ]
}

export async function runAgentImport(deps: AgentImportHostDeps): Promise<void> {
  // Load the bundle first: a window without it says so before any picker opens.
  const { importFromAgents } = deps.bundle()
  // Capture this exact live session before any queue, picker or filesystem await.
  const owner = deps.captureOwner?.()
  const beginEdit = deps.beginEdit
  await importFromAgents(
    {
      platform: process.platform,
      homeDir: homedir(),
      environment: process.env,
      workspaceRoot: deps.workspaceRoot,
      currentRoot: deps.currentRoot,
      isWorkspaceTrusted: () => vscode.workspace.isTrusted,
      isActive: deps.isActive,
      museSettingsFile: deps.museSettingsPath(),
      editProject: deps.editProject,
      beforeProjectWrite: deps.beforeProjectWrite,
      ...(beginEdit !== undefined && { beginProjectEdit: (file) => beginEdit(file, owner) }),
      pickSource: async () => {
        const picked = await vscode.window.showQuickPick(sourceChoices(), {
          title: UI_TEXT.agentImportSourceTitle,
          ignoreFocusOut: true,
        })
        return picked?.choice
      },
      pickCandidates: async (items) => {
        const picked = await vscode.window.showQuickPick(
          items.map((item) => ({ ...item })),
          {
            canPickMany: true,
            title: UI_TEXT.agentImportPickTitle,
            placeHolder: UI_TEXT.agentImportPickPlaceholder,
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true,
          },
        )
        return picked?.map((item) => item.id)
      },
      openPreview: deps.openDocument,
      // Not modal: the preview beside it stays readable and scrollable while it asks.
      confirmImport: async (message) =>
        (await vscode.window.showInformationMessage(message, UI_TEXT.agentImportConfirmAction)) ===
        UI_TEXT.agentImportConfirmAction,
      offerCopy: async (message) => {
        const picked = await vscode.window.showInformationMessage(
          message,
          UI_TEXT.agentImportCopyAction,
          UI_TEXT.agentImportOpenFile,
        )
        if (picked === UI_TEXT.agentImportCopyAction) {
          return 'copy'
        }
        return picked === UI_TEXT.agentImportOpenFile ? 'open' : undefined
      },
      copyText: async (text) => {
        await vscode.env.clipboard.writeText(text)
      },
      openTarget: async (absolutePath, isExisting, isStillSafe) => {
        const file = vscode.Uri.file(absolutePath)
        // A missing file opens unsaved at its path: the user saves it, the extension never writes it.
        const document = await vscode.workspace.openTextDocument(
          isExisting ? file : file.with({ scheme: UNTITLED_SCHEME }),
        )
        // Loading the document awaited: the flow checks the destination again before it is shown.
        if (await isStillSafe()) {
          await vscode.window.showTextDocument(document, { preview: false })
        }
      },
      showInformation: (message) => {
        void vscode.window.showInformationMessage(message)
      },
      showWarning: loggedPopups(deps.log).showWarning,
      log: deps.log,
    },
    UI_TEXT,
    uiLocale(),
  )
}
