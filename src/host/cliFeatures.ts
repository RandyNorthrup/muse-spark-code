// The VS Code side of the CLI-backed features (M30, M31, PLAN.md D30): the
// pickers, dialogs, terminals and file writes behind "Manage skills…",
// "Import skills…", "Export conversation…", "MCP servers…" and "Hooks…".
// The flows themselves live in commands/skillsCommands.ts,
// commands/museConfigCommands.ts and conversation/exportConversation.ts.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  EXPORT_FILE_EXTENSIONS,
  MUSE_EXPORT_TIMEOUT_MS,
  MUSE_EXTENDING_DOCS_URL,
  MUSE_SKILLS_TIMEOUT_MS,
  PROJECT_HOOKS_SEGMENTS,
  type SkillImportSource,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ProcessResult } from './backend/sandboxSetup'
import { type MuseConfigDeps, showHooks, showMcpServers } from './commands/museConfigCommands'
import { importSkills, manageSkills, type SkillsCliDeps } from './commands/skillsCommands'
import type { ConversationExports } from './conversation/exportConversation'
import type { Logger } from './logger'
import { loggedPopups } from './popups'

export interface CliFeatureDeps {
  /** The CLI with these arguments, run to completion in `muse serve`'s environment; undefined when absent. */
  readonly runCli: (
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<ProcessResult> | undefined
  /** The CLI in a VS Code terminal the user watches; false when it is not installed. */
  readonly runCliInTerminal: (args: readonly string[], terminalName: string) => boolean
  /** Muse Code's settings file where `muse serve` reads it (`XDG_CONFIG_HOME` honoured). */
  readonly museSettingsPath: () => string
  readonly workspaceRoot: string | undefined
  /** Stops the hosts; the next message starts them with the new settings (D25). */
  readonly restartBackend: () => Promise<void>
  readonly log: Logger
}

export interface CliFeatures {
  manageSkills(): Promise<void>
  importSkills(): Promise<void>
  showMcpServers(): Promise<void>
  showHooks(): Promise<void>
  readonly exports: ConversationExports
}

const NOT_FOUND = 'ENOENT'

/** The file's text; undefined when there is none; throws on any other failure. */
function readTextIfPresent(fsPath: string): string | undefined {
  try {
    return readFileSync(fsPath, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === NOT_FOUND) {
      return undefined
    }
    throw error
  }
}

interface SourceChoice extends vscode.QuickPickItem {
  readonly source: SkillImportSource
}

/** Built when asked, so the labels come from the table installed at activation. */
function sourceChoices(): readonly SourceChoice[] {
  return [
    { label: UI_TEXT.importSourceClaude, source: 'claude' },
    { label: UI_TEXT.importSourceCodex, source: 'codex' },
  ]
}
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
    showError: loggedPopups(deps.log).showError,
    confirmRestart: async () =>
      (await vscode.window.showInformationMessage(
        UI_TEXT.skillsRestartPrompt,
        UI_TEXT.restartNow,
        UI_TEXT.restartLater,
      )) === UI_TEXT.restartNow,
    restart: deps.restartBackend,
    log: deps.log,
  })
  const configDeps = (): MuseConfigDeps => {
    const settingsPath = deps.museSettingsPath()
    return {
      settingsPath,
      readSettings: () => readTextIfPresent(settingsPath),
      projectHooksPath:
        deps.workspaceRoot === undefined
          ? undefined
          : path.join(deps.workspaceRoot, ...PROJECT_HOOKS_SEGMENTS),
      fileExists: existsSync,
      isWorkspaceTrusted: () => vscode.workspace.isTrusted,
      pick: async (items, title, placeholder) => {
        const choice = await vscode.window.showQuickPick(
          items.map((item) => ({ ...item })),
          { title, placeHolder: placeholder, matchOnDescription: true, matchOnDetail: true },
        )
        return choice?.id
      },
      openFile: async (fsPath) => {
        await vscode.window.showTextDocument(vscode.Uri.file(fsPath), { preview: false })
      },
      openDocs: () => {
        void vscode.env.openExternal(vscode.Uri.parse(MUSE_EXTENDING_DOCS_URL))
      },
      runMcpCommand: (action, server) =>
        deps.runCliInTerminal(['mcp', action, server], UI_TEXT.mcpTerminalName),
      restart: deps.restartBackend,
      showInformation: (message) => {
        void vscode.window.showInformationMessage(message)
      },
      showWarning: loggedPopups(deps.log).showWarning,
    }
  }
  const saveTarget = (fileName: string, filterName: string, extension: string) =>
    vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(deps.workspaceRoot ?? homedir(), fileName)),
      filters: { [filterName]: [extension] },
    })
  return {
    showMcpServers: () => showMcpServers(configDeps()),
    showHooks: () => showHooks(configDeps()),
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
          const choice = await vscode.window.showQuickPick(sourceChoices(), {
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
            firstLine(result.stderr) ||
              `muse export: ${fill(UI_TEXT.processExitCode, { code: String(result.exitCode) })}`,
          )
        }
        deps.log.info(`muse export wrote session ${sessionId} to ${target.fsPath}`)
        const choice = await vscode.window.showInformationMessage(
          fill(UI_TEXT.exportSaved, { path: target.fsPath }),
          UI_TEXT.exportOpen,
        )
        if (choice === UI_TEXT.exportOpen) {
          await vscode.window.showTextDocument(target, { preview: false })
        }
      },
    },
  }
}
