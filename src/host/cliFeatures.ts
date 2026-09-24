// The VS Code side of the CLI-backed features (M30, PLAN.md D30): the
// pickers, dialogs and file writes behind "Manage skills…", "Import
// skills…" and "Export conversation…". The flows themselves live in
// commands/skillsCommands.ts and conversation/exportConversation.ts.

import { homedir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  EXPORT_FILE_EXTENSIONS,
  MUSE_EXPORT_TIMEOUT_MS,
  MUSE_SKILLS_TIMEOUT_MS,
  type SkillImportSource,
  UI_TEXT,
} from '../shared/constants'
import type { ProcessResult } from './backend/sandboxSetup'
import { importSkills, manageSkills, type SkillsCliDeps } from './commands/skillsCommands'
import type { ConversationExports } from './conversation/exportConversation'
import type { Logger } from './logger'

export interface CliFeatureDeps {
  /** The CLI with these arguments, run to completion in `muse serve`'s environment; undefined when absent. */
  readonly runCli: (
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<ProcessResult> | undefined
  readonly workspaceRoot: string | undefined
  /** Stops the hosts; the next message starts them with the new skills (D25). */
  readonly restartBackend: () => Promise<void>
  readonly log: Logger
}

export interface CliFeatures {
  manageSkills(): Promise<void>
  importSkills(): Promise<void>
  readonly exports: ConversationExports
}

interface SourceChoice extends vscode.QuickPickItem {
  readonly source: SkillImportSource
}

const SOURCE_CHOICES: readonly SourceChoice[] = [
  { label: UI_TEXT.importSourceClaude, source: 'claude' },
  { label: UI_TEXT.importSourceCodex, source: 'codex' },
]
const FILE_SCHEME = 'file'
const MARKDOWN_FILTER = 'Markdown'
const JSON_FILTER = 'JSON'
const LINE_BREAK = /\r?\n/

function firstLine(text: string): string {
  return text.trim().split(LINE_BREAK, 1)[0] ?? ''
}

/** `muse export` writes the session's JSON log to a path it is given. */
function sessionExportArgs(sessionId: string, outPath: string): readonly string[] {
  return ['export', '--session', sessionId, '--out', outPath]
}

export function createCliFeatures(deps: CliFeatureDeps): CliFeatures {
  const skillsDeps = (): SkillsCliDeps => ({
    runCli: (args) => deps.runCli(args, MUSE_SKILLS_TIMEOUT_MS),
    workspaceRoot: deps.workspaceRoot,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message)
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message)
    },
    confirmRestart: async () =>
      (await vscode.window.showInformationMessage(
        UI_TEXT.skillsRestartPrompt,
        UI_TEXT.restartNow,
        UI_TEXT.restartLater,
      )) === UI_TEXT.restartNow,
    restart: deps.restartBackend,
    log: deps.log,
  })
  const saveTarget = (fileName: string, filterName: string, extension: string) =>
    vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(deps.workspaceRoot ?? homedir(), fileName)),
      filters: { [filterName]: [extension] },
    })
  return {
    manageSkills: () =>
      manageSkills({
        ...skillsDeps(),
        pickSkills: async (items) => {
          const picked = await vscode.window.showQuickPick(
            items.map((item) => ({ ...item })),
            {
              canPickMany: true,
              title: UI_TEXT.skillsPickTitle,
              placeHolder: UI_TEXT.skillsPickPlaceholder,
              matchOnDescription: true,
              matchOnDetail: true,
              ignoreFocusOut: true,
            },
          )
          return picked === undefined ? undefined : new Set(picked.map((item) => item.id))
        },
      }),
    importSkills: () =>
      importSkills({
        ...skillsDeps(),
        pickSource: async () => {
          const choice = await vscode.window.showQuickPick(SOURCE_CHOICES, {
            title: UI_TEXT.importSourceTitle,
          })
          return choice?.source
        },
        confirmImport: async (message, detail) =>
          (await vscode.window.showInformationMessage(
            message,
            { modal: true, detail },
            UI_TEXT.importConfirmAction,
          )) === UI_TEXT.importConfirmAction,
      }),
    exports: {
      saveMarkdown: async (fileName, content) => {
        const target = await saveTarget(fileName, MARKDOWN_FILTER, EXPORT_FILE_EXTENSIONS.markdown)
        if (target === undefined) {
          return
        }
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
        deps.log.info(`Exported the conversation to ${target.toString()}`)
        await vscode.window.showTextDocument(target, { preview: false })
      },
      saveSessionLog: async (sessionId, fileName) => {
        const target = await saveTarget(fileName, JSON_FILTER, EXPORT_FILE_EXTENSIONS.sessionLog)
        if (target === undefined) {
          return
        }
        // The CLI writes the file itself, so it needs a path on this side.
        if (target.scheme !== FILE_SCHEME) {
          throw new Error(UI_TEXT.exportLogLocalOnly)
        }
        const running = deps.runCli(
          sessionExportArgs(sessionId, target.fsPath),
          MUSE_EXPORT_TIMEOUT_MS,
        )
        if (running === undefined) {
          throw new Error(UI_TEXT.exportCliMissing)
        }
        const result = await running
        if (result.exitCode !== 0) {
          throw new Error(
            firstLine(result.stderr) || `muse export exited with ${String(result.exitCode)}`,
          )
        }
        deps.log.info(`muse export wrote session ${sessionId} to ${target.fsPath}`)
        const choice = await vscode.window.showInformationMessage(
          `${UI_TEXT.exportSaved} ${target.fsPath}`,
          UI_TEXT.exportOpen,
        )
        if (choice === UI_TEXT.exportOpen) {
          await vscode.window.showTextDocument(target, { preview: false })
        }
      },
    },
  }
}
