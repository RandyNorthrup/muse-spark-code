// The VS Code side of the CLI-backed features (M30, M31, PLAN.md D30): the
// pickers, dialogs, terminals and file writes behind "Manage skills…",
// "Import skills…", "Export conversation…", "MCP servers…" and "Hooks…".
// The flows themselves live in commands/skillsCommands.ts,
// commands/museConfigCommands.ts and conversation/exportConversation.ts.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import type { McpPoolSnapshot } from '../core/backends/modelapi/mcp/pool'
import { redactSecrets } from '../core/redact'
import {
  EXPORT_FILE_EXTENSIONS,
  MUSE_EXPORT_TIMEOUT_MS,
  MUSE_EXTENDING_DOCS_URL,
  MODEL_API_HOOKS_SETTING,
  MUSE_SKILLS_TIMEOUT_MS,
  PROJECT_HOOKS_SEGMENTS,
  type SkillImportSource,
  UI_TEXT,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ProcessResult } from './backend/sandboxSetup'
import type { AgentImportHostDeps } from './agentImportHost'
import { runAgentImport } from './agentImportBundle'
import { type MuseConfigDeps, showHooks, showMcpServers } from './commands/museConfigCommands'
import { importSkills, manageSkills, type SkillsCliDeps } from './commands/skillsCommands'
import type { ConversationExports } from './conversation/exportConversation'
import type { Logger } from './logger'
import { loggedPopups } from './popups'
import { showPickOne } from './quickPick'

export interface CliFeatureDeps {
  /** The CLI with these arguments, run to completion in `muse serve`'s environment; undefined when absent. */
  readonly runCli: (
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<ProcessResult> | undefined
  /** The CLI in a VS Code terminal the user watches; false when it is not installed. */
  readonly runCliInTerminal: (
    args: readonly string[],
    terminalName: string,
  ) => boolean | Promise<boolean>
  /** Muse Code's settings file where `muse serve` reads it (`XDG_CONFIG_HOME` honoured). */
  readonly museSettingsPath: () => string
  readonly workspaceRoot: string | undefined
  /**
   * Runs a write of `fsPath` (an export the user placed): inside the
   * workspace folder under the checkpoint lease (M72), elsewhere as it is.
   */
  readonly editFile: <T>(fsPath: string, work: () => Promise<T>) => Promise<T>
  /** What the import from other agents needs of the window (M83). */
  readonly agentImport: Omit<
    AgentImportHostDeps,
    'workspaceRoot' | 'museSettingsPath' | 'openDocument' | 'log'
  >
  /** A read-only document that is never written to disk: an export's preview (M84). */
  readonly openPreview: (title: string, content: string) => Promise<void>
  /** Stops the hosts; the next message starts them with the new settings (D25). */
  readonly restartBackend: () => Promise<void>
  /**
   * The Model API backend's MCP servers, read for the view when this window
   * runs on that backend (M50); undefined on Muse Code.
   */
  readonly modelApiMcp: () => (() => McpPoolSnapshot | undefined) | undefined
  /** Undefined on Muse Code; current machine hook setting on Model API. */
  readonly modelApiHooks: () => boolean | undefined
  /** Shows the extension's log, where an MCP server's stderr goes. */
  readonly openLog: () => void
  /**
   * VS Code trusts the workspace and the window is not held on someone
   * else's pull request (M71): the project's skills and hooks may be read.
   */
  readonly isProjectTrusted: () => boolean
  /** Whether this window is held on someone else's pull request (M71). */
  readonly isProjectHeld: () => boolean
  /** Opens text as a read-only document (M15's tool outputs; M83's import preview). */
  readonly openDocument: (title: string, content: string) => Promise<void>
  readonly log: Logger
}

export interface CliFeatures {
  manageSkills(): Promise<void>
  importSkills(): Promise<void>
  /** Import from Claude Code, Codex and Cursor (M83). */
  importFromAgents(): Promise<void>
  showMcpServers(): Promise<void>
  showHooks(): Promise<void>
  readonly exports: ConversationExports
}

const NOT_FOUND = 'ENOENT'

/** The file's text; undefined when there is none; throws on any other failure. */
export function readTextIfPresent(fsPath: string): string | undefined {
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

/** A saved export: where it went, and Open. */
async function offerToOpen(target: vscode.Uri): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    fill(UI_TEXT.exportSaved, { path: target.fsPath }),
    UI_TEXT.exportOpen,
  )
  if (choice === UI_TEXT.exportOpen) {
    await vscode.window.showTextDocument(target, { preview: false })
  }
}

export function createCliFeatures(deps: CliFeatureDeps): CliFeatures {
  const skillsDeps = (): SkillsCliDeps => ({
    runCli: (args) => deps.runCli(args, MUSE_SKILLS_TIMEOUT_MS),
    workspaceRoot: deps.workspaceRoot,
    isWorkspaceTrusted: deps.isProjectTrusted,
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
      isWorkspaceTrusted: deps.isProjectTrusted,
      pick: showPickOne,
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
      modelApiServers: deps.modelApiMcp(),
      modelApiHooks: deps.modelApiHooks() === undefined ? undefined : () => deps.modelApiHooks(),
      openModelApiHooksSetting: async () => {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          MODEL_API_HOOKS_SETTING,
        )
      },
      openLog: deps.openLog,
    }
  }
  const saveTarget = (fileName: string, filterName: string, extension: string) =>
    vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(deps.workspaceRoot ?? homedir(), fileName)),
      filters: { [filterName]: [extension] },
    })
  /**
   * Asks where to save an export and writes it there under the edit lease
   * and action guard (M72), Markdown and portable JSON alike; undefined,
   * with nothing written, when the dialog is dismissed.
   */
  const saveExport = async (
    fileName: string,
    filterName: string,
    extension: string,
    content: string,
  ): Promise<vscode.Uri | undefined> => {
    const target = await saveTarget(fileName, filterName, extension)
    if (target === undefined) {
      return undefined
    }
    await deps.editFile(target.fsPath, async () => {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
    })
    return target
  }
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
    importFromAgents: () =>
      runAgentImport({
        ...deps.agentImport,
        workspaceRoot: deps.workspaceRoot,
        isProjectTrusted: deps.isProjectTrusted,
        isProjectHeld: deps.isProjectHeld,
        museSettingsPath: deps.museSettingsPath,
        openDocument: deps.openDocument,
        log: deps.log,
      }),
    exports: {
      saveMarkdown: async (fileName, content) => {
        const target = await saveExport(
          fileName,
          MARKDOWN_FILTER,
          EXPORT_FILE_EXTENSIONS.markdown,
          content,
        )
        if (target === undefined) {
          return
        }
        deps.log.info(`Exported the conversation to ${target.toString()}`)
        await vscode.window.showTextDocument(target, { preview: false })
      },
      saveJson: async (fileName, content) => {
        const target = await saveExport(fileName, JSON_FILTER, EXPORT_FILE_EXTENSIONS.json, content)
        if (target === undefined) {
          return
        }
        deps.log.info(`Exported the session as JSON to ${target.toString()}`)
        await offerToOpen(target)
      },
      // The redacted file opens first, read-only and in memory; the modal
      // then asks. Closing it writes nothing.
      previewExport: async ({ fileName, content, detail }) => {
        await deps.openPreview(fileName, content)
        const choice = await vscode.window.showInformationMessage(
          UI_TEXT.exportPreviewTitle,
          { modal: true, detail },
          UI_TEXT.exportPreviewRedacted,
          UI_TEXT.exportPreviewFull,
        )
        if (choice === UI_TEXT.exportPreviewFull) {
          return 'full'
        }
        return choice === UI_TEXT.exportPreviewRedacted ? 'redacted' : 'dismissed'
      },
      localRoots: () => [
        ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
        homedir(),
      ],
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
            redactSecrets(
              firstLine(result.stderr) ||
                `muse export: ${fill(UI_TEXT.processExitCode, { code: String(result.exitCode) })}`,
            ),
          )
        }
        deps.log.info(`muse export wrote session ${sessionId} to ${target.fsPath}`)
        await offerToOpen(target)
      },
    },
  }
}
