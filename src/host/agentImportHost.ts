// The VS Code side of "Import from other agents" (M83, PLAN.md D49): the
// pickers, the read-only preview, the modals, unsaved target edits.
// Activation retains only `runAgentImport`, the loader shim. The UI entry
// and the scan, plan and writes load together through `agentImportEntry.ts`
// in the existing import bundle on the first import.

import { homedir } from 'node:os'
import * as vscode from 'vscode'
import type { AgentImportBundle } from './agentImportBundle'
import type { AgentImportHost, AgentImportSourceChoice } from './commands/agentImportCommands'
import type { EditedFile } from '../core/verify/diagnosticsReport'
import type { WorkspaceEditRecorder } from '../core/verify/workspaceEdits'
import { UI_TEXT } from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'
import type { Logger } from './logger'
import * as z from 'zod/mini'

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
  /** The checkpoint lease and storage guard for project writes (M86); never recorded. */
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
    { label: UI_TEXT.agentImportSourceEvery, choice: 'all' },
    { label: UI_TEXT.importSourceClaude, choice: 'claudeCode' },
    { label: UI_TEXT.importSourceCodex, choice: 'codex' },
    { label: UI_TEXT.agentImportSourceCursor, choice: 'cursor' },
    { label: UI_TEXT.agentImportSourceGemini, choice: 'gemini' },
    { label: UI_TEXT.agentImportSourceCopilot, choice: 'copilot' },
    { label: UI_TEXT.agentImportSourceWindsurf, choice: 'windsurf' },
    { label: UI_TEXT.agentImportSourceKiro, choice: 'kiro' },
    { label: UI_TEXT.agentImportSourceCline, choice: 'cline' },
  ]
}

const configSchema = z.looseObject({
  mcpServers: z.optional(z.record(z.string(), z.unknown())),
  hooks: z.optional(z.record(z.string(), z.array(z.unknown()))),
})

/** Merge only imported members into the live document; preserve existing servers and unrelated settings. */
function mergedConfig(
  current: string,
  additions: string,
): { readonly text: string } | { readonly reason: 'exists' | 'unreadable' } {
  try {
    const prior = configSchema.parse(current.trim() === '' ? {} : JSON.parse(current))
    const added = configSchema.parse(JSON.parse(additions))
    if (
      Object.keys(added.mcpServers ?? {}).some((name) =>
        Object.hasOwn(prior.mcpServers ?? {}, name),
      )
    )
      return { reason: 'exists' }
    const events = new Set([...Object.keys(prior.hooks ?? {}), ...Object.keys(added.hooks ?? {})])
    return {
      text: JSON.stringify(
        {
          ...added,
          ...prior,
          ...(added.mcpServers !== undefined && {
            mcpServers: { ...added.mcpServers, ...prior.mcpServers },
          }),
          ...(added.hooks !== undefined && {
            hooks: Object.fromEntries(
              [...events].map((event) => [
                event,
                [...(prior.hooks?.[event] ?? []), ...(added.hooks?.[event] ?? [])],
              ]),
            ),
          }),
        },
        undefined,
        2,
      ),
    }
  } catch {
    return { reason: 'unreadable' }
  }
}

export async function runAgentImport(deps: AgentImportHostDeps): Promise<void> {
  // Only this shim is retained by activation; the existing UI implementation
  // is exported to the import bundle and is tree-shaken from the shim's caller.
  await deps.bundle().runAgentImport(deps, UI_TEXT, uiLocale())
}

export async function runAgentImportUi(deps: AgentImportHostDeps): Promise<void> {
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
      workspaceRoots: () =>
        vscode.workspace.workspaceFolders
          ?.filter((folder) => folder.uri.scheme === 'file')
          .map((folder) => folder.uri.fsPath) ??
        (deps.workspaceRoot === undefined ? [] : [deps.workspaceRoot]),
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
      offerEdit: async (message) => {
        const picked = await vscode.window.showInformationMessage(
          message,
          UI_TEXT.agentImportEditAction,
          UI_TEXT.agentImportOpenFile,
        )
        if (picked === UI_TEXT.agentImportEditAction) {
          return 'edit'
        }
        return picked === UI_TEXT.agentImportOpenFile ? 'open' : undefined
      },
      openTarget: async (absolutePath, isExisting, isStillSafe, canApply, text) => {
        if (!(await isStillSafe()) || !canApply()) return false
        const file = vscode.Uri.file(absolutePath)
        const document = await vscode.workspace.openTextDocument(
          isExisting ? file : file.with({ scheme: UNTITLED_SCHEME }),
        )
        if (!(await isStillSafe()) || !canApply()) return false
        await vscode.window.showTextDocument(document, { preview: false })
        if (text === undefined) return true
        const content = mergedConfig(document.getText(), text)
        if ('reason' in content) {
          void vscode.window.showWarningMessage(
            content.reason === 'exists'
              ? UI_TEXT.agentImportSkippedExists
              : UI_TEXT.agentImportSkippedUnreadable,
          )
          return false
        }
        const version = document.version
        if (!(await isStillSafe()) || !canApply() || document.version !== version) return false
        const edit = new vscode.WorkspaceEdit()
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          content.text,
        )
        // The edit stays dirty: the user reviews and saves it at this exact target.
        return await vscode.workspace.applyEdit(edit)
      },
      showInformation: (message) => {
        void vscode.window.showInformationMessage(message)
      },
      showWarning: (message) => {
        void vscode.window.showWarningMessage(message)
      },
      log: deps.log,
    },
    UI_TEXT,
    uiLocale(),
  )
}
