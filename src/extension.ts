// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import { execFile, type ExecFileException } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { AgentHost, BackendKind } from './core/agent/agentBackend'
import { environmentValue, terminalEnvironment } from './core/backends/musecode/launch'
import { confineWorkspacePath } from './core/workspacePath'
import { readBackendChoice } from './core/backendSelection'
import { personalSkillsRoot } from './core/context/skills'
import { memoryDataRoot } from './core/memory/memoryLocation'
import { MemoryStore } from './core/memory/memoryStore'
import { terminalArgument } from './core/shellQuote'
import { renderSupportReport } from './core/support/report'
import { type CliInvocation, isSandboxNetworkApplied } from './core/backends/musecode/sandbox'
import { DIAGNOSTIC_SEVERITIES, type DiagnosticEntry, diagnosticsTool } from './core/diagnostics'
import type { EditorContext } from './core/editorContext'
import type { MentionSource } from './core/mention'
import { MentionIndex } from './core/mentionIndex'
import {
  type FolderLookup,
  hostSideUri,
  resolveAgainstRoot,
  rootRelativePath,
} from './core/workspaceRoot'
import { keychainItemPresence } from './core/backends/musecode/credentialFile'
import { AccountHosts, connectAccountSession } from './host/auth/accountHost'
import { AuthService } from './host/auth/authService'
import { CliAccount, isCliSignedIn } from './host/auth/cliAccount'
import { runDeviceSignIn } from './host/auth/deviceSignIn'
import { CredentialStore, isValidModelApiKey } from './host/auth/credentialStore'
import { ModelApiBackendManager } from './host/backend/modelApiBackendManager'
import { createFileScheduleStore } from './host/backend/fileScheduleStore'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { chooseAuthorizedHost } from './host/backend/selectedHost'
import { type ProcessResult, SandboxSetup } from './host/backend/sandboxSetup'
import { fileContextIo } from './host/backend/contextIo'
import { describeEnvironment } from './host/backend/environment'
import { createFileSessionStore } from './host/backend/fileSessionStore'
import { modelApiMcpPoolDeps } from './host/backend/mcpServers'
import { type JobHelper, jobSourceReader } from './host/backend/jobSource'
import { mcpJobExecutable } from './host/backend/mcpJobExecutable'
import { createMemoryIo, systemPath } from './host/backend/memoryIo'
import {
  museSettingsPath,
  readDelegationMode,
  readWorkflowTriggerMode,
} from './host/backend/museSettings'
import { type ShellJobDeps, shellJobAssembly } from './host/backend/shellJob'
import {
  createToolIo,
  readPickedFile,
  toolImagePreviewIo,
  terminalPlatform,
  withTerminalOverrides,
} from './host/backend/toolIo'
import { EditorContextTracker } from './host/editor/editorContextTracker'
import { EditReview } from './host/editor/editReview'
import { createVerifyEditor } from './host/editor/verifyEditor'
import { verifyGuidance } from './core/verify/checkCommands'
import { IdeMcpServer } from './host/ide/ideMcpServer'
import { createRulesFile } from './host/commands/createRulesFile'
import { insertMentionReference } from './host/commands/insertMention'
import { openMuseTerminal, type TerminalLaunchOptions } from './host/commands/openInTerminal'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import {
  ConversationController,
  type FileAccess,
  type PickedFile,
  type SessionMemory,
} from './host/conversation/conversationController'
import { canonicalPath } from './host/canonicalPath'
import { loadToolImage } from './core/toolImages'
import { ModelApiClient } from './core/backends/modelapi/client'
import { ideImageTools } from './host/ide/imageTools'
import { ideWebFetchTools, isIdeWebFetchOffered, oneQuestionPerUrl } from './host/ide/webFetchTool'
import { isWebFetchAllowed } from './host/web/webFetchConfirm'
import { pageConverter } from './host/web/pageConverter'
import { createWebFetcher } from './host/web/webFetcher'
import { ideCodeIntelTools } from './host/ide/codeIntelTools'
import { vscodeLanguageServices } from './host/codeIntel/languageServices'
import { usablePaidFeatures } from './shared/paid'
import { createCliFeatures } from './host/cliFeatures'
import { createWorktreeFeatures } from './host/worktreeFeatures'
import { createMemoryFeatures } from './host/memoryFeatures'
import { createPlanFiles, createPlanIo } from './host/planFeatures'
import { planMarkdownLoader } from './host/planMarkdownBundle'
import { showPickOne } from './host/quickPick'
import { processGitRunner } from './host/git'
import { createLogger, errorDetail, type Logger, logRejection } from './host/logger'
import {
  liveFetch,
  managedConfiguration,
  readNetworkFacts,
  readProxySettings,
} from './host/networkPosture'
import { OutputDocumentStore } from './host/outputDocuments'
import { pickMentionFile } from './host/mention/mentionQuickPick'
import { createWorkspaceFileLister, findRootFiles } from './host/mention/workspaceFiles'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from './host/views/ChatViewProvider'
import { openChatPanel, restoreChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface } from './host/views/chatSurface'
import type { WebviewHostContext } from './host/views/webviewSetup'
import { loadUiTable } from './host/l10n'
import { createInsightsReader } from './host/usage/traceLogs'
import { createDictationSetup, createMuseVoiceSetup } from './host/voice/dictationHost'
import { createPaidFeatures } from './host/paid/paidHost'
import { imageUseRequest } from './core/backends/modelapi/imageGeneration'
import {
  BACKEND_SETTING,
  BYPASS_SETTING,
  CLI_PROCESS_SETTINGS,
  HTTP_SETTINGS_SECTION,
  POSIX_TERMINAL_SHELL,
  TERMINAL_ENV_KEYS,
  TERMINAL_ENV_SECTION,
  HAS_APPROVAL_UI,
  CHAT_PANEL_VIEW_TYPE,
  CHAT_VIEW_ID,
  CLI_OUTPUT_MAX_BYTES,
  COMMAND_IDS,
  CONTEXT_KEYS,
  DEFAULT_MODEL_ID,
  DICTATION_HELPER_DIR,
  FIND_FILES_GLOB,
  MODEL_API_BASE_URL,
  MODEL_API_BUNDLE_FILE,
  PLAN_MARKDOWN_BUNDLE_FILE,
  MODEL_API_SCHEDULES_DIR,
  MODEL_API_SESSIONS_DIR,
  PAID_FEATURE_SETTINGS,
  PERSONAL_SKILLS_GLOB,
  PROJECT_SKILLS_GLOB,
  GLOBAL_STATE_KEYS,
  MACOS_KEYCHAIN_LOOKUP_ARGS,
  MACOS_KEYCHAIN_LOOKUP_TIMEOUT_MS,
  MACOS_SECURITY_TOOL,
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  MUSE_CONFIG_STATUS_ARGS,
  MUSE_CONFIG_STATUS_TIMEOUT_MS,
  MUSE_EDIT_SCHEME,
  MUSE_INIT_ARGS,
  MUSE_INIT_TIMEOUT_MS,
  MUSE_INSTALL_COMMANDS,
  OUTPUT_DOCUMENT_SCHEME,
  PRODUCT_NAME,
  SANDBOX_NETWORK_SETTING,
  PAGE_WORKER_FILE,
  SEARCH_WORKER_FILE,
  SETTINGS_SECTION,
  SHELL_SANDBOX_SETTING,
  UI_TEXT,
  VSCODE_COMMANDS,
  WALKTHROUGH_QUALIFIED_ID,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
  WORKSPACE_STATE_KEYS,
} from './shared/constants'
import { fill } from './shared/l10n/text'
import type { HostAction } from './shared/protocol'
import type { AccountFacts } from './shared/usage'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })
// `workspaceState` values are whatever an earlier version stored.
const archivedIdsSchema = z.array(z.string())
const lastSessionSchema = z.object({ sessionId: z.string(), at: z.number() })

// `git ls-files` on a large monorepo can exceed Node's 1 MiB default.
const QUICK_PICK_LIMIT = 50
// A document on disk (not an untitled buffer, an output tab or a diff side).
const FILE_SCHEME = 'file'

function activeSelection(): MentionSource | undefined {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined) {
    return undefined
  }
  return {
    // A file outside the first folder is named by its absolute path (D27).
    relativePath: relativePathInWorkspace(editor.document.uri) ?? editor.document.uri.fsPath,
    startLine: editor.selection.start.line + 1,
    endLine: editor.selection.end.line + 1,
    isEmpty: editor.selection.isEmpty,
  }
}

/** The active workspace file and selection for the open-file chip (M5). */
function editorSnapshot(): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor
  const selection = activeSelection()
  if (editor === undefined || selection === undefined) {
    return undefined
  }
  const relativePath = relativePathInWorkspace(editor.document.uri)
  if (relativePath === undefined) {
    return undefined
  }
  return {
    ...selection,
    relativePath,
    selectedText: selection.isEmpty ? undefined : editor.document.getText(editor.selection),
  }
}

/** Every diagnostic VS Code holds, by root-relative path; the tool reports the root's only (D27). */
function collectDiagnostics(): readonly DiagnosticEntry[] {
  return vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) =>
    diagnostics.map((diagnostic): DiagnosticEntry => ({
      path: relativePathInWorkspace(uri),
      severity: DIAGNOSTIC_SEVERITIES[diagnostic.severity] ?? 'error',
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      message: diagnostic.message,
      source: diagnostic.source,
    })),
  )
}

async function isExistingPath(fsPath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
    return true
  } catch {
    return false
  }
}

// VS Code's FileSystemError code for a path that does not exist.
const FILE_NOT_FOUND = 'FileNotFound'
// A UTF-8 BOM stays in the text, so a Revert writes the file back with it (D27).
const TEXT_KEEPING_BOM = new TextDecoder('utf-8', { ignoreBOM: true })

async function readTextFile(fsPath: string): Promise<string | undefined> {
  try {
    return TEXT_KEEPING_BOM.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)))
  } catch (error: unknown) {
    // Only a missing file is absent. Anything else (no permission, a
    // folder) is raised, so a rewind says why instead of "no longer
    // matches" (M39).
    if (error instanceof vscode.FileSystemError && error.code === FILE_NOT_FOUND) {
      return undefined
    }
    throw error
  }
}

/** The usage modal's "Auth method" for the backend in use (M14). */
function signInMethodFor(
  kind: BackendKind,
  hasCliSession: boolean,
  hasKey: boolean,
): AccountFacts['signInMethod'] {
  if (kind === 'museCode') {
    return hasCliSession ? 'cli' : 'none'
  }
  return hasKey ? 'apiKey' : 'none'
}

function readTextFileSync(fsPath: string): string | undefined {
  try {
    return readFileSync(fsPath, 'utf8')
  } catch {
    return undefined
  }
}

/** A file's modification time in epoch ms; undefined when it does not exist. */
function modifiedAt(fsPath: string): number | undefined {
  try {
    return statSync(fsPath).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * Runs the CLI where the user can see and interact with it. The terminal's
 * shell is pinned so the call syntax is known (PLAN.md D25): Windows
 * PowerShell on Windows (the CLI's own shim shell), `/bin/sh` elsewhere (a
 * default shell of pwsh or nushell would not run `"path" login` as a
 * command). `env` is added to the terminal's own environment.
 */
function runInTerminal(
  cliPath: string,
  args: readonly string[],
  options: TerminalLaunchOptions,
  env: Record<string, string>,
): void {
  const isWindows = process.platform === 'win32'
  const systemRoot = process.env['SystemRoot']
  const windowsShell =
    systemRoot === undefined ? undefined : `${systemRoot}${WINDOWS_POWERSHELL_TERMINAL_PATH}`
  const shellPath = isWindows ? windowsShell : POSIX_TERMINAL_SHELL
  const terminal = vscode.window.createTerminal({
    name: options.name,
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(shellPath !== undefined && { shellPath }),
    env,
  })
  terminal.show(true)
  // The path and each argument single-quoted for the pinned shell (M31):
  // nothing in them is expanded, and an MCP server's name, which comes
  // from the user's settings, stays one argument whatever it holds.
  const invocation = [cliPath, ...args]
    .map((part) => terminalArgument(part, process.platform))
    .join(' ')
  terminal.sendText(isWindows ? `& ${invocation}` : invocation)
}

async function promptForApiKey(): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    title: UI_TEXT.apiKeyPrompt,
    placeHolder: UI_TEXT.apiKeyPlaceholder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (isValidModelApiKey(value) ? undefined : UI_TEXT.apiKeyInvalid),
  })
}

/** The root every workspace-relative path is relative to: the first folder (PLAN.md D27). */
function firstFolderPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

// VS Code's own attribution of a resource to a folder (PLAN.md D27).
const folderLookup: FolderLookup<vscode.Uri> = {
  folderOf: (uri) => vscode.workspace.getWorkspaceFolder(uri),
  relativePath: (uri) => vscode.workspace.asRelativePath(uri, false),
  parentOf: (uri) => vscode.Uri.joinPath(uri, '..'),
  isSame: (a, b) => a.toString() === b.toString(),
}

/** Relative to the first folder; undefined for a file anywhere else, a second folder included. */
function relativePathInWorkspace(uri: vscode.Uri): string | undefined {
  return rootRelativePath(uri, folderLookup)
}

/** VS Code's file search, the first folder's files only (D27). */
function findWorkspaceFiles(): Promise<readonly string[]> {
  const root = vscode.workspace.workspaceFolders?.[0]
  return findRootFiles({
    search:
      root === undefined
        ? undefined
        : () =>
            vscode.workspace.findFiles(
              new vscode.RelativePattern(root, FIND_FILES_GLOB),
              undefined,
              MENTION_INDEX_LIMIT,
            ),
    relativePath: relativePathInWorkspace,
  })
}

// git by absolute path, with a timeout and no optional locks (PLAN.md D24).
const runGit = processGitRunner()

// A failed spawn or a timeout kill has no exit code; report it as negative so
// the caller can tell "the CLI said no" from "the CLI never ran".
const NO_EXIT_CODE = -1

function exitCodeOf(error: ExecFileException | null): number {
  if (error === null) {
    return 0
  }
  return typeof error.code === 'number' ? error.code : NO_EXIT_CODE
}

/**
 * Runs a short CLI command to completion without a shell; never rejects.
 * `env` replaces the inherited environment (`muse serve`'s, so the CLI reads
 * the same config root, M30).
 */
function runProcess(
  invocation: CliInvocation,
  timeoutMs: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      invocation.command,
      [...invocation.args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: CLI_OUTPUT_MAX_BYTES, cwd, env },
      (error, stdout, stderr) => {
        resolve({ exitCode: exitCodeOf(error), stdout, stderr })
      },
    )
  })
}

/**
 * A tested Windows job helper, compiled once from the shared C# (`jobSource.ts`):
 * the shell tool's job assembly (M27) or the direct MCP stdio launcher (M50).
 * Undefined off Windows.
 */
function windowsJobHelper(
  build: (deps: ShellJobDeps) => () => Promise<string | undefined>,
  storageDir: string,
  readJobSource: (helper: JobHelper) => Promise<string>,
  log: Logger,
): (() => Promise<string | undefined>) | undefined {
  const systemRoot = process.env['SystemRoot']
  return systemRoot !== undefined && process.platform === 'win32'
    ? build({
        storageDir,
        systemRoot,
        readJobSource,
        log: (message) => {
          log.warn(message)
        },
      })
    : undefined
}

/** Set by `activate`: stops the hosts, their turns and their processes. */
const lifecycle: { shutdown: (() => Promise<void>) | undefined } = { shutdown: undefined }

/**
 * VS Code awaits this before the extension host exits (PLAN.md D25): running
 * turns are cancelled and `muse serve` is closed rather than left to the
 * process teardown, while the log channel is still open to say so.
 */
export async function deactivate(): Promise<void> {
  await lifecycle.shutdown?.()
  lifecycle.shutdown = undefined
}

/**
 * A command whose failure is logged, with its stack, and said once (M39). A
 * rejected command would otherwise reach only VS Code's Extension Host log.
 * No command here takes arguments.
 */
function registerLoggedCommand(log: Logger, id: string, run: () => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(id, async () => {
    try {
      return await run()
    } catch (error: unknown) {
      log.error(`${id} failed: ${errorDetail(error)}`)
      const reason = error instanceof Error ? error.message : String(error)
      void vscode.window.showErrorMessage(`${UI_TEXT.actionFailed}: ${reason}`)
      return
    }
  })
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // How long activation takes, for the log (M39).
  const activationStartedAt = performance.now()
  const channel = vscode.window.createOutputChannel(PRODUCT_NAME, { log: true })
  const log = createLogger(channel)
  const { version } = packageManifestSchema.parse(context.extension.packageJSON)
  log.info(
    `Activating ${PRODUCT_NAME} ${version} (VS Code ${vscode.version}, Node ${process.versions.node}, ${process.platform})`,
  )
  // M16 stored an account-agnostic usage snapshot. Remove it before any
  // surface opens: a later sign-in may belong to another Meta account.
  try {
    if (context.globalState.get(GLOBAL_STATE_KEYS.lastUsage) !== undefined) {
      await context.globalState.update(GLOBAL_STATE_KEYS.lastUsage, undefined)
    }
  } catch {
    // This obsolete value is never read again. A failed cleanup must not
    // prevent the extension from activating for the current account.
    log.warn('Could not remove the obsolete subscription usage snapshot')
  }
  // The display language's table goes in before anything registers a view
  // or says a word (PLAN.md D33); the webviews get the same table.
  const l10n = await loadUiTable({
    language: vscode.env.language,
    readExtensionFile: async (segments) =>
      new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, ...segments)),
      ),
    log,
  })

  const registry = new SurfaceRegistry()
  const controllers = new Map<string, ConversationController>()
  let isInputFocused = false
  // Ctrl+B belongs to the panel only while the conversation in view runs a
  // command it can move to the background (M46); VS Code's sidebar toggle
  // keeps it otherwise.
  const refreshTaskContext = () => {
    const active = registry.active
    const controller = active === undefined ? undefined : controllers.get(active.id)
    void vscode.commands.executeCommand(
      VSCODE_COMMANDS.setContext,
      CONTEXT_KEYS.canMoveToBackground,
      controller?.hasForegroundShell === true,
    )
  }
  const currentSettings = () =>
    readSettings(vscode.workspace.getConfiguration(SETTINGS_SECTION), log)
  const updateSetting = (key: string, value: unknown) =>
    vscode.workspace
      .getConfiguration(SETTINGS_SECTION)
      .update(key, value, vscode.ConfigurationTarget.Global)
  const workspaceRoot = firstFolderPath()
  const insights = createInsightsReader({ homeDir: homedir(), now: () => Date.now() })

  const credentials = new CredentialStore(context.secrets, (message) => {
    log.warn(message)
  })
  // The paid Model API features (M33–M35, PLAN.md D30): on only with the
  // setting on and the price accepted; every panel shows which are on.
  // Whether a Model API key is stored (M44): the Muse Code backend then
  // offers the key's paid images and voice. Read at start and after every
  // sign-in change, never from anywhere but the secret store.
  let isKeyStored = false
  const paid = createPaidFeatures({
    globalState: context.globalState,
    workspaceState: context.workspaceState,
    isSettingOn: (feature) => currentSettings()[PAID_FEATURE_SETTINGS[feature]],
    isKeyStored: () => isKeyStored,
    // "Allow always in this workspace" (M58) needs a workspace to keep it,
    // and never in Restricted Mode.
    canRememberPaidUse: () =>
      vscode.workspace.isTrusted && (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    log,
  })
  // Muse Voice (M35): the paid engine's recorder, used only while it is
  // on, its price accepted, and the window runs on the Model API key.
  const museVoiceSetup = createMuseVoiceSetup(
    {
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      helperDir: path.join(context.extensionPath, DICTATION_HELPER_DIR),
    },
    {
      apiKey: () => credentials.getApiKey(),
      onSeconds: (seconds) => {
        paid.usage.add('voice', seconds)
      },
      log,
    },
  )
  const broadcastPaidState = () => {
    registry.broadcast({ type: 'paidState', state: paid.state() })
    for (const controller of controllers.values()) {
      controller.refreshDictation()
    }
  }
  const refreshKeyPresence = async (): Promise<void> => {
    const isStored = (await credentials.getApiKey()) !== undefined
    if (isStored === isKeyStored) {
      return
    }
    isKeyStored = isStored
    broadcastPaidState()
  }
  void refreshKeyPresence()
  // Voice dictation (M9): the OS recogniser behind the composer's microphone.
  const dictation = createDictationSetup(
    {
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      helperDir: path.join(context.extensionPath, DICTATION_HELPER_DIR),
    },
    log,
  )
  const backend = new MuseCodeBackendManager({
    log,
    extensionVersion: version,
    getConfiguredBinaryPath: () => currentSettings().museBinaryPath,
    getEnvironmentVariables: () => currentSettings().environmentVariables,
    workspaceRoot,
    getShellSandbox: () => currentSettings().shellSandbox,
    getSandboxNetwork: () => currentSettings().sandboxNetwork,
    userProfileDir: process.env['USERPROFILE'],
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    getProxySettings: () =>
      readProxySettings(vscode.workspace.getConfiguration(HTTP_SETTINGS_SECTION)),
  })
  // Muse Code's own settings and trace logs (M14): read, never written; the
  // config root as the CLI sees it, `museSpark.environmentVariables` included.
  const museConfig = () => ({
    platform: process.platform,
    homeDir: homedir(),
    xdgConfigHome: environmentValue(
      backend.childEnvironment(),
      process.platform,
      'XDG_CONFIG_HOME',
    ),
  })
  const delegationMode = () =>
    readDelegationMode({ ...museConfig(), readTextFile: readTextFileSync })
  const workflowTriggerMode = () =>
    readWorkflowTriggerMode({ ...museConfig(), readTextFile: readTextFileSync })
  /**
   * Stops both hosts (PLAN.md D25). The conversations hear it first: a
   * running turn is cancelled, and unless they end (sign-out, shutdown) the
   * next message resumes the same session on the new host.
   */
  const restartBackend = async (reason: string, isConversationEnding = false): Promise<void> => {
    log.info(`Restarting the backends: ${reason}`)
    await Promise.all(
      Array.from(controllers.values(), (controller) =>
        controller.backendStopping(isConversationEnding),
      ),
    )
    await Promise.all([backend.dispose(), modelApi.dispose()])
  }
  /**
   * The CLI in a terminal (`muse logout`, `muse mcp login`, Open in
   * Terminal), with `museSpark.environmentVariables` as `muse serve` gets
   * them, so it reads the same config home (the review of PR #49).
   */
  const runCliInTerminal = (
    cliPath: string,
    args: readonly string[],
    options: TerminalLaunchOptions,
  ): void => {
    runInTerminal(
      cliPath,
      args,
      options,
      terminalEnvironment(currentSettings().environmentVariables, process.platform),
    )
  }
  // Skills, imports and export (M30): the CLI by absolute path, in the
  // environment `muse serve` gets, from the workspace root.
  const cliFeatures = createCliFeatures({
    runCli: (args, timeoutMs) => {
      const resolution = backend.resolveLaunch()
      return resolution.ok
        ? runProcess(
            { command: resolution.launch.command, args },
            timeoutMs,
            workspaceRoot,
            backend.childEnvironment(),
          )
        : undefined
    },
    // `muse mcp login|logout` (M31): the CLI's own launcher in a terminal,
    // where its browser sign-in and prompts are seen.
    runCliInTerminal: (args, terminalName) => {
      const resolution = backend.resolveLaunch()
      if (!resolution.ok) {
        return false
      }
      runCliInTerminal(resolution.launch.cliPath, args, { name: terminalName, cwd: workspaceRoot })
      return true
    },
    museSettingsPath: () => museSettingsPath(museConfig()),
    workspaceRoot,
    restartBackend: () => restartBackend('asked for after a skills or MCP change'),
    // On the Model API backend the MCP servers view shows them as this
    // window runs them (M50).
    modelApiMcp: () =>
      auth.current.backend === 'modelApi' ? () => modelApi.mcpSnapshot() : undefined,
    modelApiHooks: () =>
      auth.current.backend === 'modelApi' ? currentSettings().modelApiHooks : undefined,
    openLog: () => {
      channel.show(true)
    },
    log,
  })
  const worktrees = createWorktreeFeatures({ workspaceRoot, runGit, log })
  const sandbox = new SandboxSetup({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    resolveLaunch: () => backend.resolveLaunch(),
    run: runProcess,
    showWarning: async (message, ...choices) =>
      await vscode.window.showWarningMessage(message, ...choices),
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message)
    },
    isPromptSuppressed: () =>
      context.globalState.get<boolean>(GLOBAL_STATE_KEYS.sandboxPromptSuppressed) === true,
    suppressPrompt: async () => {
      await context.globalState.update(GLOBAL_STATE_KEYS.sandboxPromptSuppressed, true)
    },
    log,
  })
  // Muse Code's account methods run on a short-lived host of their own (M55,
  // D26): the device sign-in, `account/read` and `account/logout`.
  const connectAccountHost = (signal: AbortSignal) =>
    connectAccountSession(backend, version, log, workspaceRoot, signal)
  // The short-lived account/read and account/logout hosts end with the window.
  const accountHosts = new AccountHosts(connectAccountHost, log)
  const cliAccount = new CliAccount({
    platform: process.platform,
    credentialFilePath: () => backend.credentialFilePath(),
    probe: () => accountHosts.probe(),
    log,
  })
  /** The CLI's own credential without a question to the CLI on macOS: META_API_KEY or its sign-in. */
  const hasCliSession = async () =>
    backend.hasEnvironmentKey() || isCliSignedIn(await cliAccount.signIn(false))
  const auth = new AuthService({
    backend: {
      resolveCli: () => {
        // The sign-in gate's check is an explicit re-look: an install is noticed at once.
        backend.invalidateLaunch()
        const resolution = backend.resolveLaunch()
        return resolution.ok
          ? { ok: true, cliPath: resolution.launch.cliPath }
          : {
              ok: false,
              reason: `${resolution.reason} ${fill(UI_TEXT.cliSearched, { paths: resolution.searched.join(', ') })}`,
            }
      },
      cliSignIn: (isUserAction) => cliAccount.signIn(isUserAction),
      abandonCliProbe: () => {
        cliAccount.abandonProbe()
      },
      forgetCliAnswers: () => {
        cliAccount.forgetAnswers()
      },
      credentialFilePath: () => backend.credentialFilePath(),
      credentialFileModifiedAt: () => modifiedAt(backend.credentialFilePath()),
      hasEnvironmentKey: () => backend.hasEnvironmentKey(),
      getBackendMode: () => currentSettings().backend,
      restartBackend: (isConversationEnding) =>
        restartBackend('authentication changed', isConversationEnding),
      logOutCli: async () => (await accountHosts.logOut()) === 'confirmed',
    },
    credentials,
    logoutHold: {
      get: () => context.globalState.get<boolean>(GLOBAL_STATE_KEYS.cliLogoutHold) === true,
      set: (isHeld) => context.globalState.update(GLOBAL_STATE_KEYS.cliLogoutHold, isHeld),
    },
    runInTerminal: (cliPath, args) => {
      runCliInTerminal(cliPath, args, { name: UI_TEXT.museLoginTerminalName, cwd: undefined })
    },
    installCommand:
      process.platform === 'win32' ? MUSE_INSTALL_COMMANDS.win32 : MUSE_INSTALL_COMMANDS.posix,
    runInstallerInTerminal: () => {
      const isWindows = process.platform === 'win32'
      const systemRoot = process.env['SystemRoot']
      let shellPath: string | undefined = POSIX_TERMINAL_SHELL
      if (isWindows) {
        shellPath =
          systemRoot === undefined ? undefined : `${systemRoot}${WINDOWS_POWERSHELL_TERMINAL_PATH}`
      }
      const terminal = vscode.window.createTerminal({
        name: UI_TEXT.installStartAction,
        ...(shellPath !== undefined && { shellPath }),
      })
      terminal.show(true)
      terminal.sendText(isWindows ? MUSE_INSTALL_COMMANDS.win32 : MUSE_INSTALL_COMMANDS.posix)
    },
    runDeviceSignIn: (signal, onCode) =>
      runDeviceSignIn({
        connect: connectAccountHost,
        credentialFileModifiedAt: () => modifiedAt(backend.credentialFilePath()),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        signal,
        onCode,
        log,
      }),
    promptForApiKey,
    broadcast: (message) => {
      registry.broadcast(message)
      if (message.type !== 'authState') {
        return
      }
      // A key pasted or signed out of changes what the Muse Code backend offers (M44).
      void refreshKeyPresence()
      // The backend decides which engine the microphone uses (M35).
      for (const controller of controllers.values()) {
        controller.refreshDictation()
      }
      // The walkthrough's sign-in step completes on this context key.
      void vscode.commands.executeCommand(
        VSCODE_COMMANDS.setContext,
        CONTEXT_KEYS.signedIn,
        message.status === 'signedIn',
      )
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    now: () => Date.now(),
    log,
  })
  // The window closing ends the account hosts, then the browser sign-in
  // (awaited, so its host is closed too), then the backends (the review of
  // PR #49).
  lifecycle.shutdown = async () => {
    accountHosts.close()
    await auth.stopSignIn()
    await restartBackend('the window is closing', true)
  }

  const editorContext = new EditorContextTracker({
    broadcast: (summary) => {
      registry.broadcast({ type: 'editorContext', context: summary })
    },
  })
  const listWorkspaceFiles = createWorkspaceFileLister({
    workspaceRoot: workspaceRoot ?? '',
    respectGitIgnore: () => currentSettings().respectGitIgnore,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    runGit,
    findFiles: findWorkspaceFiles,
    log,
  })
  // The C# of both Windows job helpers, shipped beside the bundle (PLAN.md D6).
  const readJobSource = jobSourceReader(context.extensionPath)
  const storageDir = context.globalStorageUri.fsPath
  const windowsJobAssembly = windowsJobHelper(shellJobAssembly, storageDir, readJobSource, log)
  const windowsMcpJob = windowsJobHelper(mcpJobExecutable, storageDir, readJobSource, log)
  // The workspace's files and a shell (M7): the Model API backend's tools,
  // and the files the ide server's image tools read and write (M44).
  const toolIo = createToolIo({
    platform: process.platform,
    listFiles: listWorkspaceFiles,
    systemRoot: process.env['SystemRoot'],
    // The user's terminal environment settings apply to the shell tool as
    // they do to VS Code's terminal (PLAN.md D25).
    env: () =>
      withTerminalOverrides(
        process.env,
        vscode.workspace
          .getConfiguration(TERMINAL_ENV_SECTION)
          .get<Record<string, string | null>>(TERMINAL_ENV_KEYS[terminalPlatform()]) ?? {},
        process.platform,
        workspaceRoot,
      ),
    searchWorkerPath: vscode.Uri.joinPath(context.extensionUri, 'dist', SEARCH_WORKER_FILE).fsPath,
    log: (message) => {
      log.warn(message)
    },
    // Each Windows command in a job object of its own, so a Stop ends
    // everything it started (PLAN.md M27).
    shellJobAssembly: windowsJobAssembly,
    // The open editors with unsaved changes to a file (PLAN.md D27).
    unsavedFiles: () =>
      vscode.workspace.textDocuments
        .filter((document) => document.isDirty && document.uri.scheme === FILE_SCHEME)
        .map((document) => document.uri.fsPath),
  })
  // The verify loop (M68, PLAN.md D49): what the language servers report on
  // edited files, which only an editor showing a file makes them do, and the
  // formatter over the Model API backend's edits.
  const verifyEditor = createVerifyEditor({
    platform: process.platform,
    log,
    workspaceRoot,
    realPath: canonicalPath,
  })
  context.subscriptions.push(verifyEditor)
  const diagnostics = diagnosticsTool({
    getDiagnostics: collectDiagnostics,
    workspaceRoot,
    platform: process.platform,
    relativeInRoot: (absolutePath) => relativePathInWorkspace(vscode.Uri.file(absolutePath)),
    settleFile: (absolutePath, signal) => verifyEditor.settleFile(absolutePath, signal),
  })
  // Images for Muse Code (M44, PLAN.md D37): made here with the stored key,
  // never by `muse serve`, each one confirmed with its price.
  const keyClient = new ModelApiClient({
    fetch: liveFetch,
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => credentials.getApiKey(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    now: () => Date.now(),
    random: () => Math.random(),
    log,
  })
  const ideTools = [diagnostics]
  // Web fetch (M69, PLAN.md D49): resolved, checked and pinned here, for the
  // Model API backend's `web_fetch` and Muse Code's `mcp__ide__webFetch`.
  // HTML is converted on a worker of its own bundle, started for each page.
  const webFetch = createWebFetcher(
    log,
    pageConverter(vscode.Uri.joinPath(context.extensionUri, 'dist', PAGE_WORKER_FILE).fsPath, log),
  )
  const askWebFetch = oneQuestionPerUrl(isWebFetchAllowed)
  // Code intelligence over VS Code's language services (M67, PLAN.md D49):
  // native tools on the Model API backend, `ide` tools for Muse Code. Only
  // with a folder open, since every path is the workspace's.
  const languageServices = vscodeLanguageServices()
  const codeIntel =
    workspaceRoot === undefined
      ? undefined
      : {
          service: languageServices,
          workspaceRoot,
          platform: process.platform,
          io: toolIo,
          now: () => Date.now(),
        }
  const ideServer = new IdeMcpServer(
    () => [
      diagnostics,
      ...ideCodeIntelTools(codeIntel),
      // The server is attached in Restricted Mode too, and has no session
      // identity: the tool is listed only in a trusted workspace whose
      // sandbox network setting allows the network, and every call asks.
      ...ideWebFetchTools({
        isOffered: () =>
          isIdeWebFetchOffered(vscode.workspace.isTrusted, currentSettings().sandboxNetwork),
        fetchPage: webFetch,
        confirm: askWebFetch,
        log,
      }),
      ...ideImageTools({
        isOffered: () => isKeyStored && paid.gate.isOn('imageGeneration'),
        keyGeneration: () => auth.admissionGeneration,
        workspace:
          workspaceRoot === undefined
            ? undefined
            : { workspaceRoot, platform: process.platform, io: toolIo },
        client: keyClient,
        confirm: async (plan) => await paid.consent.allows(imageUseRequest(plan)),
        onBilled: () => {
          paid.usage.add('imageGeneration', 1)
        },
        log,
      }),
    ],
    log,
  )
  // Started by the first session that asks for it, not at activation (M39);
  // callers asking while it starts share that start.
  let ideServerStart: Promise<void> | undefined
  const startIdeServer = (): Promise<void> => {
    ideServerStart ??= (async () => {
      try {
        await ideServer.start()
      } catch (error: unknown) {
        log.warn(`IDE tool server could not start; diagnostics stay unavailable: ${String(error)}`)
      } finally {
        ideServerStart = undefined
      }
    })()
    return ideServerStart
  }
  // Tool outputs open as read-only documents (M15), the tab named through the
  // URI path as Claude Code names its own ("PowerShell tool output (a1b2c3)");
  // the last OUTPUT_DOCUMENTS_KEPT stay readable after their tab is reopened.
  const outputDocuments = new OutputDocumentStore()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_DOCUMENT_SCHEME, {
      provideTextDocumentContent: (uri) => outputDocuments.get(uri.query) ?? '',
    }),
  )
  const openDocument = async (title: string, content: string): Promise<void> => {
    const id = outputDocuments.add(content)
    const uri = vscode.Uri.from({ scheme: OUTPUT_DOCUMENT_SCHEME, path: `/${title}`, query: id })
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document, { preview: true })
  }

  // A tool row's path opens the file with the changed lines selected and
  // revealed (M16), as Claude Code's file links do.
  const openFile = async (
    filePath: string,
    range: { readonly startLine: number; readonly endLine: number } | undefined,
  ): Promise<void> => {
    const fsPath = resolveAgainstRoot(filePath, workspaceRoot, process.platform)
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
    const editor = await vscode.window.showTextDocument(document, { preview: true })
    if (range === undefined) {
      return
    }
    const lastLine = document.lineCount - 1
    const start = new vscode.Position(Math.min(Math.max(range.startLine - 1, 0), lastLine), 0)
    const endLine = Math.min(Math.max(range.endLine - 1, 0), lastLine)
    const end = document.lineAt(endLine).range.end
    editor.selection = new vscode.Selection(start, end)
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter)
  }

  const editReview = new EditReview({
    platform: process.platform,
    workspaceRoot,
    readFile: readTextFile,
    realPath: canonicalPath,
    writeFile: async (fsPath, content) => {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(fsPath),
        new TextEncoder().encode(content),
      )
    },
    deleteFile: async (fsPath) => {
      await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true })
    },
    openDiff: async (beforeUri, fsPath, title) => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.diff,
        vscode.Uri.parse(beforeUri),
        vscode.Uri.file(fsPath),
        title,
      )
    },
    log,
  })

  const mentions = new MentionIndex({
    listFiles: listWorkspaceFiles,
    now: () => Date.now(),
    ttlMs: MENTION_INDEX_TTL_MS,
    limit: MENTION_INDEX_LIMIT,
    log,
  })
  // The Model API backend (M7): the pasted key, the workspace's files and a
  // shell, all in this process. Its sessions live for this window.
  // Muse Code's managed personal skill root, watched alongside the workspace's
  // `.agents/skills` so the palette follows the files (PLAN.md D13).
  const skillsHome = personalSkillsRoot(museConfig())
  // Muse Code's memory (M49, PLAN.md D41): one store for the window, which
  // the Model API's memory tools and the Memory view both use, in the data
  // home `muse serve` sees (`museSpark.environmentVariables` included).
  const memory = new MemoryStore({
    io: createMemoryIo(toolIo, {
      warn: (message) => {
        log.warn(`Memory: ${message}`)
      },
    }),
    platform: process.platform,
    dataRoot: () =>
      memoryDataRoot({
        platform: process.platform,
        homeDir: homedir(),
        xdgDataHome: environmentValue(
          backend.childEnvironment(),
          process.platform,
          'XDG_DATA_HOME',
        ),
      }),
    workspaceRoot,
    systemPath,
    warn: (message) => {
      log.warn(`Memory: ${message}`)
    },
  })
  const memoryView = createMemoryFeatures({ store: memory, log })
  // Plans as files (M79): `.agents/plans/` of the workspace folder, when there is one.
  const plans =
    workspaceRoot === undefined
      ? undefined
      : createPlanFiles({
          workspaceRoot,
          platform: process.platform,
          io: createPlanIo({ log, now: () => Date.now() }),
          beginEdit: (file, ownerRecorder) => modelApi.beginExternalEdit(ownerRecorder, [file]),
          captureOwner: (session) => modelApi.captureExternalEditOwner(session),
          pick: showPickOne,
          confirm: async (message, detail, action) =>
            (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) ===
            action,
          // The panel's Markdown parser, its own bundle, loaded on the first plan action (D6).
          markdown: planMarkdownLoader({
            bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', PLAN_MARKDOWN_BUNDLE_FILE)
              .fsPath,
            log,
          }),
        })
  const modelApi = new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    io: toolIo,
    contextIo: fileContextIo,
    // VS Code's proxy-aware fetch, as it stands at each request (M56, D43).
    fetch: liveFetch,
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    random: () => Math.random(),
    personalSkillsRoot: skillsHome,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    hookSettingsPath: museSettingsPath(museConfig()),
    isHooksEnabled: () => currentSettings().modelApiHooks,
    // Sessions survive the window (PLAN.md D14) in the workspace storage
    // directory; no folder open, no storage, no persistence.
    store:
      context.storageUri === undefined
        ? undefined
        : createFileSessionStore({
            directory: path.join(context.storageUri.fsPath, MODEL_API_SESSIONS_DIR),
            log,
            retentionDays: () => currentSettings().cleanupPeriodDays,
            now: () => Date.now(),
            sleep: (ms) =>
              new Promise((resolve) => {
                setTimeout(resolve, ms)
              }),
          }),
    scheduleStore:
      context.storageUri === undefined
        ? undefined
        : createFileScheduleStore({
            directory: path.join(context.storageUri.fsPath, MODEL_API_SCHEDULES_DIR),
            now: () => Date.now(),
            log,
          }),
    describeEnvironment: () =>
      describeEnvironment({
        runGit,
        workspaceRoot,
        isWorkspaceTrusted: () => vscode.workspace.isTrusted,
        log,
        now: Date.now,
      }),
    isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
    notePaidUse: (feature, units) => {
      paid.usage.add(feature, units)
    },
    promptCacheRetention: () => currentSettings().modelApiPromptCacheRetention,
    // Muse Code's MCP servers, run by this window for the Model API backend
    // (M50, PLAN.md D42): started in a trusted workspace only, stopped with
    // the host.
    createMcpServers: async (root, newPool) =>
      newPool(
        modelApiMcpPoolDeps({
          workspaceRoot: root,
          settingsPath: () => museSettingsPath(museConfig()),
          isWorkspaceTrusted: () => vscode.workspace.isTrusted,
          clientVersion: version,
          platform: process.platform,
          jobExecutablePath: await windowsMcpJob?.(),
          env: () => process.env,
          fetch: globalThis.fetch.bind(globalThis),
          log,
        }),
      ),
    ideTools,
    webFetch,
    codeIntel: languageServices,
    isRepoMapInPrompt: () => currentSettings().modelApiRepoMap,
    allowsPaidUse: async (request, requiresAsking) =>
      await paid.consent.allows(request, requiresAsking),
    isPaidUseRemembered: (feature) => paid.consent.isRemembered(feature),
    noteSubagentUsage: (modelId, usage) => {
      paid.usage.addSubagentUsage(modelId, usage)
    },
    memory,
    // The settings are read at each use; a repository cannot set them (D15).
    verify: {
      isDiagnosticsOn: () => currentSettings().diagnosticsAfterEdits,
      checkCommands: () => currentSettings().checkCommands,
      isFormatOnEdit: () => currentSettings().formatOnEdit,
      diagnosticsAfterEdit: (files, signal) => verifyEditor.diagnosticsAfterEdit(files, signal),
      formatAfterEdit: (absolutePath, text) => verifyEditor.formatAfterEdit(absolutePath, text),
    },
    // Its own bundle, loaded when this backend first starts (M57, PLAN.md D6).
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', MODEL_API_BUNDLE_FILE).fsPath,
  })
  const watchedHosts = new WeakSet<AgentHost>()
  let chosenBackend: BackendKind | undefined
  /** The host for the next conversation, by the same selection the sign-in gate uses. */
  const ensureSelectedHost = async () => {
    const host = await chooseAuthorizedHost(
      () => auth.backend,
      // Forced Model API asks the CLI nothing (Codex on 328efb52).
      async () =>
        await readBackendChoice({
          setting: currentSettings().backend,
          hasCli: backend.resolveLaunch().ok,
          hasCliSession,
          hasStoredKey: async () => (await credentials.getApiKey()) !== undefined,
        }),
      async (kind): Promise<AgentHost> =>
        kind === 'modelApi' ? await modelApi.ensureHost() : await backend.ensureHost(),
      () => auth.admissionGeneration,
    )
    if (host.info.kind !== chosenBackend) {
      // Said when it changes, not on every message (M39).
      chosenBackend = host.info.kind
      log.info(`Conversations run on the ${host.info.kind} backend`)
    }
    // One exit listener per host, however many messages ask for it (D25).
    if (host.info.kind === 'museCode' && !watchedHosts.has(host)) {
      watchedHosts.add(host)
      host.onExit((exit) => {
        for (const active of controllers.values()) {
          active.hostExited(exit)
        }
      })
    }
    return host
  }

  // Session history memory (M6): archived ids and the last session, per
  // workspace, in the extension's own `workspaceState`.
  const sessions: SessionMemory = {
    // A value an earlier version (or a hand edit) stored that does not
    // validate reads as "none archived" instead of throwing (PLAN.md D25).
    archivedIds: () => {
      const parsed = archivedIdsSchema.safeParse(
        context.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.archivedSessions) ?? [],
      )
      return parsed.success ? parsed.data : []
    },
    setArchivedIds: async (ids) => {
      await context.workspaceState.update(WORKSPACE_STATE_KEYS.archivedSessions, [...ids])
    },
    lastSession: () => {
      const stored = context.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.lastSession)
      const parsed = lastSessionSchema.safeParse(stored)
      return parsed.success ? parsed.data : undefined
    },
    setLastSession: async (last) => {
      await context.workspaceState.update(WORKSPACE_STATE_KEYS.lastSession, last)
    },
  }

  const files: FileAccess = {
    showOpenDialog: async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: UI_TEXT.attachTitle,
      })
      return (uris ?? []).map((uri): PickedFile => ({
        name: path.basename(uri.fsPath),
        fsPath: uri.fsPath,
        relativePath: relativePathInWorkspace(uri),
      }))
    },
    readFile: readPickedFile,
    canonicalRelativePath: async (fsPath) => {
      if (workspaceRoot === undefined) {
        return
      }
      const resolved = await confineWorkspacePath(workspaceRoot, fsPath, process.platform, toolIo)
      return resolved.ok
        ? { canonical: resolved.canonical, checkedAbsolute: resolved.checkedAbsolute }
        : undefined
    },
    pickMentionFile: () =>
      pickMentionFile({
        createQuickPick: () => vscode.window.createQuickPick(),
        mentions,
        limit: QUICK_PICK_LIMIT,
        placeholder: UI_TEXT.mentionFile,
      }),
    // A dropped URI is the UI side's name for the file; in a remote window it
    // is mapped to this (remote) side's as VS Code maps URIs itself (D27).
    toRelativePath: (uri) =>
      relativePathInWorkspace(
        vscode.Uri.from(hostSideUri(vscode.Uri.parse(uri), vscode.env.remoteName)),
      ),
  }

  const runHostAction = async (action: HostAction): Promise<void> => {
    switch (action) {
      case 'openSettings': {
        await vscode.commands.executeCommand(VSCODE_COMMANDS.openSettings, SETTINGS_SECTION)
        break
      }
      case 'openKeybindings': {
        await vscode.commands.executeCommand(VSCODE_COMMANDS.openKeybindings, SETTINGS_SECTION)
        break
      }
      case 'openLog': {
        channel.show(true)
        break
      }
      case 'toggleFocusView': {
        await toggleFocusView({
          isFocusViewEnabled: () => currentSettings().focusView,
          setFocusViewEnabled: (isEnabled) => updateSetting('focusView', isEnabled),
        })
        break
      }
      case 'toggleCtrlEnterToSend': {
        await updateSetting('useCtrlEnterToSend', !currentSettings().useCtrlEnterToSend)
        break
      }
      case 'hideOnboarding': {
        await updateSetting('hideOnboarding', true)
        break
      }
      case 'openMuseSettings': {
        const settingsPath = museSettingsPath(museConfig())
        if (await isExistingPath(settingsPath)) {
          await vscode.window.showTextDocument(vscode.Uri.file(settingsPath))
        } else {
          void vscode.window.showInformationMessage(
            fill(UI_TEXT.museSettingsMissing, { path: settingsPath }),
          )
        }
        break
      }
      case 'manageSkills': {
        await cliFeatures.manageSkills()
        break
      }
      case 'importSkills': {
        await cliFeatures.importSkills()
        break
      }
      case 'showMcpServers': {
        await cliFeatures.showMcpServers()
        break
      }
      case 'showHooks': {
        await cliFeatures.showHooks()
        break
      }
      case 'showMemory': {
        await memoryView.showMemory()
        break
      }
      case 'newWorktree': {
        await worktrees.newWorktree()
        break
      }
      case 'removeWorktree': {
        await worktrees.removeWorktree()
        break
      }
    }
  }

  const controllerFor = (surface: ChatSurface): ConversationController => {
    let controller = controllers.get(surface.id)
    if (controller === undefined) {
      controller = new ConversationController({
        surface,
        auth,
        ensureHost: ensureSelectedHost,
        workspaceRoot,
        modelId: DEFAULT_MODEL_ID,
        initialPermissionMode: currentSettings().initialPermissionMode,
        hasApprovalUi: HAS_APPROVAL_UI,
        openExternal: (url) => {
          void vscode.env.openExternal(vscode.Uri.parse(url))
        },
        openSideChat: (sessionId) => {
          openChatPanel(hostContext, registry, {
            sessionId,
            isSideChat: true,
            onDisposed: () => {
              if (registry.has(surface)) {
                surface.reveal()
              }
            },
          })
        },
        mentions: {
          search: (query, limit) => mentions.search(query, limit),
          contains: (relativePath) => mentions.contains(relativePath),
        },
        files,
        isBypassAllowed: () => currentSettings().allowDangerouslySkipPermissions,
        isRemoteWindow: vscode.env.remoteName !== undefined,
        confirmRemoteBypass: async () =>
          (await vscode.window.showWarningMessage(
            UI_TEXT.bypassRemoteTitle,
            { modal: true, detail: UI_TEXT.bypassRemoteDetail },
            UI_TEXT.bypassRemoteConfirm,
          )) === UI_TEXT.bypassRemoteConfirm,
        isConfidentialWorkspace: () => currentSettings().confidentialWorkspace,
        // Contributor-tier models let Meta train on the traffic: one explicit
        // yes per conversation before the model switches (PLAN.md §9).
        confirmContributor: async (modelId) =>
          (await vscode.window.showWarningMessage(
            `${UI_TEXT.contributorTitle} ${modelId}: ${UI_TEXT.contributorDetail}`,
            { modal: true },
            UI_TEXT.contributorConfirm,
          )) === UI_TEXT.contributorConfirm,
        runHostAction,
        copyText: async (text) => {
          await vscode.env.clipboard.writeText(text)
        },
        insertCode: async (text) => {
          const editor = vscode.window.activeTextEditor
          if (editor === undefined) {
            return false
          }
          return await editor.edit((builder) => {
            builder.insert(editor.selection.active, text)
          })
        },
        onSandboxUnavailable: () => {
          void sandbox.offerIfNeeded('failure').catch(logRejection(log, 'sandbox offer'))
        },
        platform: process.platform,
        userProfileDir: process.env['USERPROFILE'],
        shellSandbox: () => backend.shellSandboxPosture(),
        editorContext: () => editorContext.active,
        isAutosaveEnabled: () => currentSettings().autosave,
        saveAll: async () => {
          await vscode.workspace.saveAll(false)
        },
        // Workspace files open with unsaved changes (PLAN.md D27).
        unsavedFiles: () =>
          vscode.workspace.textDocuments
            .filter((document) => document.isDirty && document.uri.scheme === FILE_SCHEME)
            .map((document) => vscode.workspace.asRelativePath(document.uri, false)),
        // Code block "Apply": the block replaces the selection (or lands at
        // the caret); false when no text editor is active.
        applyCode: async (text) => {
          const editor = vscode.window.activeTextEditor
          if (editor === undefined) {
            return false
          }
          const isApplied = await editor.edit((builder) => {
            builder.replace(editor.selection, text)
          })
          if (isApplied) {
            editor.revealRange(editor.selection)
          }
          return isApplied
        },
        editReview,
        openDocument,
        openFile,
        readToolImage: async (imagePath) =>
          await loadToolImage(
            imagePath,
            workspaceRoot,
            process.platform,
            toolImagePreviewIo(toolIo, async (fsPath) => {
              const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
              return stat.size
            }),
          ),
        // A server that failed to start is started again, and the session
        // that asked waits for it, so it gets the tool too (D25).
        ideMcpEndpoint: async () => {
          if (ideServer.current === undefined) {
            await startIdeServer()
          }
          return ideServer.current
        },
        newAttachmentId: () => crypto.randomUUID(),
        sessions,
        // The usage modal's Account section and insights (M14).
        accountFacts: async (kind) => {
          const resolution = backend.resolveLaunch()
          const isCliSession = await hasCliSession()
          const hasKey = (await credentials.getApiKey()) !== undefined
          const signInMethod = signInMethodFor(kind, isCliSession, hasKey)
          const cliVersion = resolution.ok
            ? backend.installedVersion(resolution.launch.installDir)
            : undefined
          return {
            signInMethod,
            ...(cliVersion !== undefined && { cliVersion }),
            ...(kind === 'museCode' && {
              delegationMode: delegationMode(),
              workflowTriggerMode: workflowTriggerMode(),
            }),
          }
        },
        usageInsights: () => insights.read(),
        // Only the sidebar reopens on its last session; a tab is a new
        // conversation by construction (M6).
        isRestorable: surface.id === SIDEBAR_SURFACE_ID,
        dictation,
        // Muse Voice on the Model API backend, and on Muse Code with a stored key (M44).
        museVoice: () =>
          paid.gate.isOn('voice') &&
          usablePaidFeatures(auth.current.backend, isKeyStored).includes('voice')
            ? museVoiceSetup
            : undefined,
        exports: cliFeatures.exports,
        plans,
        // The palette's paid-feature toggles (M33): on goes through the price confirmation.
        setPaidFeature: async (feature, isOn) => {
          if (isOn) {
            await paid.gate.turnOn(feature)
          } else {
            await paid.gate.turnOff(feature)
          }
        },
        isWorkspaceTrusted: () => vscode.workspace.isTrusted,
        onForegroundTasksChanged: refreshTaskContext,
        isScheduledPaidOn: () => paid.gate.isOn('scheduledPrompts'),
        confirmScheduledRun: async (job, modelId) =>
          await paid.consent.allows({ feature: 'scheduledPrompts', prompt: job.prompt, modelId }),
        allowsPaidUse: async (request) => await paid.consent.allows(request),
        forgetPaidUse: async () => {
          await paid.consent.forget()
        },
        // Muse Code checks its own edits (M68): its checks run through its own
        // shell, so none are named while Restricted Mode runs no shell (D13).
        // The diagnostics sentence only for a session that has the ide server.
        verifyGuidance: (hasIdeServer) => {
          const settings = currentSettings()
          return verifyGuidance(
            settings.diagnosticsAfterEdits && hasIdeServer,
            vscode.workspace.isTrusted ? settings.checkCommands : [],
          )
        },
        now: () => Date.now(),
        log,
      })
      controllers.set(surface.id, controller)
    }
    return controller
  }

  const hostContext: WebviewHostContext = {
    extensionUri: context.extensionUri,
    l10n,
    log,
    getSettings: () => toSettingsSnapshot(currentSettings()),
    onInputFocusChanged: (surface, isFocused) => {
      isInputFocused = isFocused
      if (isFocused) {
        registry.setActive(surface)
      }
      void vscode.commands.executeCommand(
        VSCODE_COMMANDS.setContext,
        CONTEXT_KEYS.inputFocused,
        isFocused,
      )
    },
    onSurfaceReady: (surface, attachmentEpoch) => {
      const controller = controllerFor(surface)
      controller.surfaceReady(attachmentEpoch)
      surface.post({ type: 'editorContext', context: editorContext.summary })
      surface.post({ type: 'paidState', state: paid.state() })
      // A rebuilt panel resumes the session it held (D15); the sidebar
      // follows the ten-minute rule (M6).
      const restoredSessionId = surface.takeRestoredSessionId()
      const restore = () =>
        restoredSessionId === undefined
          ? controller.restoreRecentSession()
          : controller.restoreSession(restoredSessionId)
      if (auth.current.status === 'checking') {
        void auth.refresh().then(restore).catch(logRejection(log, 'session restore'))
      } else {
        void restore().catch(logRejection(log, 'session restore'))
      }
      // No setup offer where this window will not use the sandbox anyway.
      if (!backend.shellSandboxPosture().isSandboxed) {
        return
      }
      void sandbox.offerIfNeeded('startup').catch(logRejection(log, 'sandbox offer'))
    },
    onConversationMessage: (surface, message) => {
      void controllerFor(surface).handle(message)
    },
  }

  registry.onRemoved((surface) => {
    controllers.get(surface.id)?.dispose()
    controllers.delete(surface.id)
  })
  registry.onActiveChanged(refreshTaskContext)
  /** A command for the conversation in view, when there is one. */
  const forActiveConversation =
    (run: (controller: ConversationController) => Promise<void>) => async () => {
      const surface = registry.active
      if (surface !== undefined) {
        await run(controllerFor(surface))
      }
    }

  const openSidebar = () => vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`)
  /** A conversation where the setting says new ones open. */
  const openConversation = async (): Promise<void> => {
    if (currentSettings().preferredLocation === 'sidebar') {
      await openSidebar()
      return
    }
    openChatPanel(hostContext, registry)
  }
  const resolveCli = () => {
    const resolution = backend.resolveLaunch()
    return resolution.ok
      ? { ok: true as const, cliPath: resolution.launch.cliPath }
      : { ok: false as const, reason: resolution.reason }
  }
  const fileWatcher = vscode.workspace.createFileSystemWatcher(FIND_FILES_GLOB, false, true, false)
  const onSkillFilesChanged = () => {
    void modelApi.refreshSkills().catch(logRejection(log, 'skill refresh'))
  }
  const projectSkillsWatcher = vscode.workspace.createFileSystemWatcher(PROJECT_SKILLS_GLOB)
  const personalSkillsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(skillsHome), PERSONAL_SKILLS_GLOB),
  )

  editorContext.update(editorSnapshot)
  // A setting turned on while VS Code was closed, or in another window, is
  // confirmed here: at activation, and when this window gains focus (D30).
  void paid.gate.review().catch(logRejection(log, 'paid feature review'))
  context.subscriptions.push(
    { dispose: paid.gate.onDidChange(broadcastPaidState) },
    { dispose: paid.consent.onDidChange(broadcastPaidState) },
    { dispose: paid.usage.onDidChange(broadcastPaidState) },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        void paid.gate.review().catch(logRejection(log, 'paid feature review'))
      }
    }),
    channel,
    fileWatcher,
    projectSkillsWatcher,
    personalSkillsWatcher,
    projectSkillsWatcher.onDidChange(onSkillFilesChanged),
    projectSkillsWatcher.onDidCreate(onSkillFilesChanged),
    projectSkillsWatcher.onDidDelete(onSkillFilesChanged),
    personalSkillsWatcher.onDidChange(onSkillFilesChanged),
    personalSkillsWatcher.onDidCreate(onSkillFilesChanged),
    personalSkillsWatcher.onDidDelete(onSkillFilesChanged),
    editorContext,
    {
      dispose: () => {
        ideServer.close()
      },
    },
    vscode.window.onDidChangeActiveTextEditor(() => {
      editorContext.update(editorSnapshot)
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      editorContext.update(editorSnapshot)
    }),
    vscode.workspace.registerTextDocumentContentProvider(MUSE_EDIT_SCHEME, {
      provideTextDocumentContent: (uri) => editReview.provide(uri.path),
    }),
    fileWatcher.onDidCreate(() => {
      mentions.invalidate()
    }),
    fileWatcher.onDidDelete(() => {
      mentions.invalidate()
    }),
    vscode.window.registerWebviewViewProvider(
      CHAT_VIEW_ID,
      new ChatViewProvider(hostContext, registry),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        registry.broadcast({ type: 'settingsChanged', settings: hostContext.getSettings() })
      }
      // A paid feature turned on anywhere asks for its price once (D30).
      if (paid.affects(event)) {
        void paid.gate.review().catch(logRejection(log, 'paid feature review'))
      }
      // Turning the Bypass setting off ends Bypass everywhere now (D24).
      if (
        event.affectsConfiguration(BYPASS_SETTING) &&
        !currentSettings().allowDangerouslySkipPermissions
      ) {
        for (const controller of controllers.values()) {
          void controller.revokeBypass().catch(logRejection(log, 'Bypass revocation'))
        }
      }
      // A host keeps its sandbox posture, its environment and its binary for
      // life, and the backend choice is made per host: drop them so the next
      // message spawns afresh (and resumes the conversation, D25).
      const isBackendSetting = event.affectsConfiguration(BACKEND_SETTING)
      if (isBackendSetting) {
        void restartBackend('the backend setting changed')
          .then(() => auth.refresh())
          .catch(logRejection(log, 'backend restart'))
        return
      }
      const isCliSetting = CLI_PROCESS_SETTINGS.some((key) => event.affectsConfiguration(key))
      if (isCliSetting) {
        backend.invalidateLaunch()
      }
      const isHostSetting =
        isCliSetting ||
        event.affectsConfiguration(SHELL_SANDBOX_SETTING) ||
        event.affectsConfiguration(SANDBOX_NETWORK_SETTING)
      if (!isHostSetting || !backend.isRunning) {
        return
      }
      void restartBackend('a CLI, environment, proxy or sandbox setting changed').catch(
        logRejection(log, 'backend restart'),
      )
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.sandboxRestartNotice })
    }),
    // Trust is a host-lifetime posture like the sandbox (PLAN.md D13): the
    // hosts restart so the next message loads the rules and skills.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      // The index was built without git in Restricted Mode (D24).
      mentions.invalidate()
      void restartBackend('the workspace was trusted').catch(logRejection(log, 'backend restart'))
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.trustGrantedNotice })
      // "Allow always in this workspace" counts only in a trusted one (M58).
      broadcastPaidState()
    }),
    // Editor-tab conversations come back after a window reload (D15).
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state: unknown) => {
        restoreChatPanel(panel, state, hostContext, registry)
        return Promise.resolve()
      },
    }),
    registerLoggedCommand(log, COMMAND_IDS.openInNewTab, () => {
      openChatPanel(hostContext, registry)
    }),
    registerLoggedCommand(log, COMMAND_IDS.newConversation, async () => {
      const surface = registry.active
      if (surface === undefined) {
        await openConversation()
        return
      }
      surface.reveal()
      await controllerFor(surface).handle({ type: 'clearConversation' })
    }),
    registerLoggedCommand(log, COMMAND_IDS.signOut, async () => {
      await auth.signOut()
      void vscode.window.showInformationMessage(UI_TEXT.signedOutNotice)
    }),
    registerLoggedCommand(log, COMMAND_IDS.openInTerminal, () => {
      openMuseTerminal({
        resolveCli,
        runInTerminal: runCliInTerminal,
        workspaceRoot,
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message)
        },
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.createRulesFile, async () => {
      await createRulesFile({
        workspaceRoot,
        isWorkspaceTrusted: () => vscode.workspace.isTrusted,
        fileExists: isExistingPath,
        writeFile: async (fsPath, content) => {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(fsPath),
            new TextEncoder().encode(content),
          )
        },
        openFile: async (fsPath) => {
          await vscode.window.showTextDocument(vscode.Uri.file(fsPath))
        },
        runInit: () => {
          const resolution = backend.resolveLaunch()
          return workspaceRoot !== undefined && resolution.ok
            ? runProcess(
                { command: resolution.launch.command, args: MUSE_INIT_ARGS },
                MUSE_INIT_TIMEOUT_MS,
                workspaceRoot,
              )
            : undefined
        },
        showInformation: (message) => {
          void vscode.window.showInformationMessage(message)
        },
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message)
        },
        log,
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.openWalkthrough, async () => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.openWalkthrough,
        WALKTHROUGH_QUALIFIED_ID,
        false,
      )
    }),
    registerLoggedCommand(log, COMMAND_IDS.openInSidebar, openSidebar),
    registerLoggedCommand(log, COMMAND_IDS.showLogs, () => {
      channel.show(true)
    }),
    // The support report (PLAN.md D14): facts only, credentials as booleans.
    registerLoggedCommand(log, COMMAND_IDS.diagnostics, async () => {
      const settings = currentSettings()
      const resolution = backend.resolveLaunch()
      const posture = backend.shellSandboxPosture()
      // The managed configuration as the CLI reads it (M56, PLAN.md D43): a
      // local read, no model call, in the environment `muse serve` gets.
      const managed = await managedConfiguration(
        resolution.ok
          ? () =>
              runProcess(
                { command: resolution.launch.command, args: MUSE_CONFIG_STATUS_ARGS },
                MUSE_CONFIG_STATUS_TIMEOUT_MS,
                workspaceRoot,
                backend.childEnvironment(),
              )
          : undefined,
      )
      // Where a macOS sign-in's token lives, looked up by attribute only (no
      // `-g`/`-w`: no secret, no prompt); never the sign-in signal (D26).
      const keychainLookup =
        process.platform === 'darwin'
          ? await runProcess(
              { command: MACOS_SECURITY_TOOL, args: MACOS_KEYCHAIN_LOOKUP_ARGS },
              MACOS_KEYCHAIN_LOOKUP_TIMEOUT_MS,
            )
          : undefined
      log.info(
        renderSupportReport({
          extensionVersion: version,
          vscodeVersion: vscode.version,
          nodeVersion: process.versions.node,
          platform: process.platform,
          arch: process.arch,
          remoteName: vscode.env.remoteName,
          hasWorkspace: workspaceRoot !== undefined,
          isWorkspaceTrusted: vscode.workspace.isTrusted,
          backendSetting: settings.backend,
          shellSandboxSetting: settings.shellSandbox,
          shellSandboxPosture: `${posture.isSandboxed ? 'sandboxed' : 'disabled'} (${posture.reason})`,
          sandboxNetworkSetting: settings.sandboxNetwork,
          isSandboxNetworkApplied: isSandboxNetworkApplied(settings.sandboxNetwork, posture),
          isBinaryPathConfigured: settings.museBinaryPath !== '',
          environmentVariableCount: settings.environmentVariables.length,
          cli: resolution.ok
            ? {
                ok: true,
                installDir: resolution.launch.installDir,
                version: backend.installedVersion(resolution.launch.installDir),
              }
            : { ok: false, reason: resolution.reason },
          cliCredentialFile: backend.credentialFileVerdict(),
          cliSignIn: await cliAccount.signIn(true),
          keychainItem:
            keychainLookup === undefined
              ? undefined
              : keychainItemPresence(keychainLookup.exitCode),
          delegationMode: delegationMode(),
          workflowTriggerMode: workflowTriggerMode(),
          hasStoredApiKey: (await credentials.getApiKey()) !== undefined,
          hasEnvironmentApiKey: backend.hasEnvironmentKey(),
          dictation: dictation.isAvailable
            ? { isAvailable: true }
            : { isAvailable: false, reason: dictation.reason },
          network: readNetworkFacts(
            vscode.workspace.getConfiguration(HTTP_SETTINGS_SECTION),
            process.env,
            process.platform,
            backend,
            globalThis,
          ),
          managedConfiguration: managed,
          homeDir: homedir(),
        }),
      )
      channel.show(true)
    }),
    registerLoggedCommand(log, COMMAND_IDS.focusInput, async () => {
      await toggleInputFocus({
        isInputFocused: () => isInputFocused,
        activeSurface: () => registry.active,
        focusEditor: () => vscode.commands.executeCommand(VSCODE_COMMANDS.focusActiveEditorGroup),
        openSidebar,
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.insertMentionReference, async () => {
      await insertMentionReference({
        activeSelection,
        activeSurface: () => registry.active,
        openSidebar,
        showInformation: (message) => {
          void vscode.window.showInformationMessage(message)
        },
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.toggleFocusView, async () => {
      await runHostAction('toggleFocusView')
    }),
    registerLoggedCommand(
      log,
      COMMAND_IDS.toggleThinking,
      forActiveConversation((controller) => controller.toggleThinking()),
    ),
    // Ctrl+B and "Stop Background Tasks" (M46, PLAN.md D39).
    registerLoggedCommand(
      log,
      COMMAND_IDS.moveToBackground,
      forActiveConversation((controller) => controller.moveRunningToBackground()),
    ),
    registerLoggedCommand(
      log,
      COMMAND_IDS.stopBackgroundTasks,
      forActiveConversation((controller) => controller.stopBackgroundTasks()),
    ),
    registerLoggedCommand(log, COMMAND_IDS.setUpSandbox, async () => {
      await sandbox.runCommand()
    }),
    registerLoggedCommand(log, COMMAND_IDS.manageSkills, () => cliFeatures.manageSkills()),
    registerLoggedCommand(log, COMMAND_IDS.importSkills, () => cliFeatures.importSkills()),
    registerLoggedCommand(log, COMMAND_IDS.mcpServers, () => cliFeatures.showMcpServers()),
    registerLoggedCommand(log, COMMAND_IDS.hooks, () => cliFeatures.showHooks()),
    registerLoggedCommand(log, COMMAND_IDS.memory, () => memoryView.showMemory()),
    registerLoggedCommand(log, COMMAND_IDS.newWorktree, () => worktrees.newWorktree()),
    registerLoggedCommand(log, COMMAND_IDS.removeWorktree, () => worktrees.removeWorktree()),
    registerLoggedCommand(log, COMMAND_IDS.exportConversation, async () => {
      const surface = registry.active
      if (surface === undefined) {
        void vscode.window.showInformationMessage(UI_TEXT.exportNothing)
        return
      }
      await controllerFor(surface).handle({ type: 'exportConversation', format: 'markdown' })
    }),
  )
  log.info(`Activated in ${String(Math.round(performance.now() - activationStartedAt))} ms`)
}
