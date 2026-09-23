// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import { execFile, type ExecFileException } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { AgentHost, BackendKind } from './core/agent/agentBackend'
import { environmentValue } from './core/backends/musecode/launch'
import { selectBackend } from './core/backendSelection'
import { personalSkillsRoot } from './core/context/skills'
import { isSamePath } from './core/paths'
import { renderSupportReport } from './core/support/report'
import type { CliInvocation } from './core/backends/musecode/sandbox'
import { type DiagnosticEntry, type DiagnosticSeverity, diagnosticsTool } from './core/diagnostics'
import type { EditorContext } from './core/editorContext'
import type { MentionSource } from './core/mention'
import { MentionIndex } from './core/mentionIndex'
import {
  type FolderLookup,
  hostSideUri,
  resolveAgainstRoot,
  rootRelativePath,
} from './core/workspaceRoot'
import { AuthService } from './host/auth/authService'
import { CredentialStore, isValidModelApiKey } from './host/auth/credentialStore'
import { ModelApiBackendManager } from './host/backend/modelApiBackendManager'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { type ProcessResult, SandboxSetup } from './host/backend/sandboxSetup'
import { fileContextIo } from './host/backend/contextIo'
import { describeEnvironment } from './host/backend/environment'
import { createFileSessionStore } from './host/backend/fileSessionStore'
import { museSettingsPath, readDelegationMode } from './host/backend/museSettings'
import { createToolIo, terminalPlatform, withTerminalOverrides } from './host/backend/toolIo'
import { EditorContextTracker } from './host/editor/editorContextTracker'
import { EditReview } from './host/editor/editReview'
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
import { createGitRunner } from './host/git'
import { createLogger } from './host/logger'
import { pickMentionFile } from './host/mention/mentionQuickPick'
import { createWorkspaceFileLister, findRootFiles } from './host/mention/workspaceFiles'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from './host/views/ChatViewProvider'
import { openChatPanel, restoreChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface, WebviewHostContext } from './host/views/webviewSetup'
import { createInsightsReader } from './host/usage/traceLogs'
import { createDictationSetup } from './host/voice/dictationHost'
import {
  BACKEND_SETTING,
  BYPASS_SETTING,
  CLI_PROCESS_SETTINGS,
  HTTP_NO_PROXY_SETTING,
  HTTP_PROXY_SETTING,
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
  MODEL_API_SESSIONS_DIR,
  PERSONAL_SKILLS_GLOB,
  PROJECT_SKILLS_GLOB,
  GLOBAL_STATE_KEYS,
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  MUSE_EDIT_SCHEME,
  MUSE_INIT_ARGS,
  MUSE_INIT_TIMEOUT_MS,
  MUSE_LOGIN_TERMINAL_NAME,
  OUTPUT_DOCUMENT_SCHEME,
  OUTPUT_DOCUMENTS_KEPT,
  PRODUCT_NAME,
  SEARCH_WORKER_FILE,
  SETTINGS_SECTION,
  SHELL_SANDBOX_SETTING,
  UI_TEXT,
  VSCODE_COMMANDS,
  WALKTHROUGH_QUALIFIED_ID,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
  WORKSPACE_STATE_KEYS,
} from './shared/constants'
import type { HostAction } from './shared/protocol'
import { type AccountFacts, subscriptionUsageSchema } from './shared/usage'

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
const execFileAsync = promisify(execFile)

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

const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = [
  'error',
  'warning',
  'information',
  'hint',
]

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

// A UTF-8 BOM stays in the text, so a Revert writes the file back with it (D27).
const TEXT_KEEPING_BOM = new TextDecoder('utf-8', { ignoreBOM: true })

async function readTextFile(fsPath: string): Promise<string | undefined> {
  try {
    return TEXT_KEEPING_BOM.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)))
  } catch {
    return undefined
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

function quoteForShell(value: string): string {
  return `"${value.replaceAll('"', String.raw`\"`)}"`
}

/**
 * Runs the CLI where the user can see and interact with it. The terminal's
 * shell is pinned so the call syntax is known (PLAN.md D25): Windows
 * PowerShell on Windows (the CLI's own shim shell), `/bin/sh` elsewhere (a
 * default shell of pwsh or nushell would not run `"path" login` as a
 * command).
 */
function runInTerminal(
  cliPath: string,
  args: readonly string[],
  options: TerminalLaunchOptions,
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
  })
  terminal.show(true)
  const invocation = `${quoteForShell(cliPath)} ${args.join(' ')}`
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
const runGit = createGitRunner({
  platform: process.platform,
  env: process.env,
  fileExists: existsSync,
  execFile: async (file, args, options) => {
    const { stdout } = await execFileAsync(file, [...args], { ...options, encoding: 'utf8' })
    return stdout
  },
})

// A failed spawn or a timeout kill has no exit code; report it as negative so
// the caller can tell "the CLI said no" from "the CLI never ran".
const NO_EXIT_CODE = -1

function exitCodeOf(error: ExecFileException | null): number {
  if (error === null) {
    return 0
  }
  return typeof error.code === 'number' ? error.code : NO_EXIT_CODE
}

/** Runs a short CLI command to completion without a shell; never rejects. */
function runProcess(
  invocation: CliInvocation,
  timeoutMs: number,
  cwd?: string,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      invocation.command,
      [...invocation.args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: CLI_OUTPUT_MAX_BYTES, cwd },
      (error, stdout, stderr) => {
        resolve({ exitCode: exitCodeOf(error), stdout, stderr })
      },
    )
  })
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

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(PRODUCT_NAME, { log: true })
  const log = createLogger(channel)
  const { version } = packageManifestSchema.parse(context.extension.packageJSON)
  log.info(
    `Activating ${PRODUCT_NAME} ${version} (VS Code ${vscode.version}, Node ${process.versions.node}, ${process.platform})`,
  )

  const registry = new SurfaceRegistry()
  const controllers = new Map<string, ConversationController>()
  let isInputFocused = false
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
    userProfileDir: process.env['USERPROFILE'],
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    getProxySettings: () => {
      const http = vscode.workspace.getConfiguration(HTTP_SETTINGS_SECTION)
      return {
        proxy: http.get<string>(HTTP_PROXY_SETTING) ?? '',
        noProxy: http.get<readonly string[]>(HTTP_NO_PROXY_SETTING) ?? [],
      }
    },
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
  /**
   * Stops both hosts (PLAN.md D25). The conversations hear it first: a
   * running turn is cancelled, and unless they end (sign-out, shutdown) the
   * next message resumes the same session on the new host.
   */
  const restartBackend = async (isConversationEnding = false): Promise<void> => {
    await Promise.all(
      Array.from(controllers.values(), (controller) =>
        controller.backendStopping(isConversationEnding),
      ),
    )
    await Promise.all([backend.dispose(), modelApi.dispose()])
  }
  lifecycle.shutdown = () => restartBackend(true)
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
              reason: `${resolution.reason} Searched: ${resolution.searched.join(', ')}`,
            }
      },
      credentialFileExists: () => backend.credentialFileExists(),
      credentialFileModifiedAt: () => modifiedAt(backend.credentialFilePath()),
      hasEnvironmentKey: () => backend.hasEnvironmentKey(),
      getBackendMode: () => currentSettings().backend,
      restartBackend,
    },
    credentials,
    runInTerminal: (cliPath, args) => {
      runInTerminal(cliPath, args, { name: MUSE_LOGIN_TERMINAL_NAME, cwd: undefined })
    },
    promptForApiKey,
    broadcast: (message) => {
      registry.broadcast(message)
      // The walkthrough's sign-in step completes on this context key.
      if (message.type === 'authState') {
        void vscode.commands.executeCommand(
          VSCODE_COMMANDS.setContext,
          CONTEXT_KEYS.signedIn,
          message.status === 'signedIn',
        )
      }
    },
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    now: () => Date.now(),
    log,
  })

  const editorContext = new EditorContextTracker({
    broadcast: (summary) => {
      registry.broadcast({ type: 'editorContext', context: summary })
    },
  })
  const ideServer = new IdeMcpServer(
    [
      diagnosticsTool({
        getDiagnostics: collectDiagnostics,
        workspaceRoot,
        platform: process.platform,
        relativeInRoot: (absolutePath) => relativePathInWorkspace(vscode.Uri.file(absolutePath)),
      }),
    ],
    log,
  )
  const startIdeServer = async (): Promise<void> => {
    try {
      await ideServer.start()
    } catch (error: unknown) {
      log.warn(`IDE tool server could not start; diagnostics stay unavailable: ${String(error)}`)
    }
  }
  void startIdeServer()
  // Tool outputs open as read-only documents (M15), the tab named through the
  // URI path as Claude Code names its own ("PowerShell tool output (a1b2c3)");
  // the last OUTPUT_DOCUMENTS_KEPT stay readable after their tab is reopened.
  const outputDocuments = new Map<string, string>()
  let outputDocumentCount = 0
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_DOCUMENT_SCHEME, {
      provideTextDocumentContent: (uri) => outputDocuments.get(uri.query) ?? '',
    }),
  )
  const openDocument = async (title: string, content: string): Promise<void> => {
    outputDocumentCount += 1
    const id = String(outputDocumentCount)
    outputDocuments.set(id, content)
    for (const key of outputDocuments.keys()) {
      if (outputDocuments.size <= OUTPUT_DOCUMENTS_KEPT) {
        break
      }
      outputDocuments.delete(key)
    }
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

  const listWorkspaceFiles = createWorkspaceFileLister({
    workspaceRoot: workspaceRoot ?? '',
    respectGitIgnore: () => currentSettings().respectGitIgnore,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    runGit,
    findFiles: findWorkspaceFiles,
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
  const modelApi = new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    io: createToolIo({
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
      searchWorkerPath: vscode.Uri.joinPath(context.extensionUri, 'dist', SEARCH_WORKER_FILE)
        .fsPath,
      log: (message) => {
        log.warn(message)
      },
      // An open editor with unsaved changes to the file (PLAN.md D27).
      hasUnsavedChanges: (absolutePath) =>
        vscode.workspace.textDocuments.some(
          (document) =>
            document.isDirty &&
            document.uri.scheme === FILE_SCHEME &&
            isSamePath(document.uri.fsPath, absolutePath, process.platform),
        ),
    }),
    contextIo: fileContextIo,
    fetch: globalThis.fetch.bind(globalThis),
    newId: () => crypto.randomUUID(),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      }),
    random: () => Math.random(),
    personalSkillsRoot: skillsHome,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
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
    describeEnvironment: () =>
      describeEnvironment({
        runGit,
        workspaceRoot,
        isWorkspaceTrusted: () => vscode.workspace.isTrusted,
      }),
  })
  const watchedHosts = new WeakSet<AgentHost>()
  /** The host for the next conversation, by the same selection the sign-in gate uses. */
  const ensureSelectedHost = async () => {
    const choice = selectBackend({
      setting: currentSettings().backend,
      hasCli: backend.resolveLaunch().ok,
      hasCliSession: backend.credentialFileExists() || backend.hasEnvironmentKey(),
      hasStoredKey: (await credentials.getApiKey()) !== undefined,
    })
    if (choice.kind === 'modelApi') {
      return await modelApi.ensureHost()
    }
    const host = await backend.ensureHost()
    // One exit listener per host, however many messages ask for it (D25).
    if (!watchedHosts.has(host)) {
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
    readFile: async (fsPath) => await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)),
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
            `${UI_TEXT.museSettingsMissing} ${settingsPath}`,
          )
        }
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
          void sandbox.offerIfNeeded('failure')
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
        usageCache: {
          read: () => {
            const parsed = subscriptionUsageSchema.safeParse(
              context.globalState.get(GLOBAL_STATE_KEYS.lastUsage),
            )
            return parsed.success ? parsed.data : undefined
          },
          write: async (usage) => {
            await context.globalState.update(GLOBAL_STATE_KEYS.lastUsage, usage)
          },
        },
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
          const hasCliSession = backend.credentialFileExists() || backend.hasEnvironmentKey()
          const hasKey = (await credentials.getApiKey()) !== undefined
          const signInMethod = signInMethodFor(kind, hasCliSession, hasKey)
          const cliVersion = resolution.ok
            ? backend.installedVersion(resolution.launch.installDir)
            : undefined
          return {
            signInMethod,
            ...(cliVersion !== undefined && { cliVersion }),
            ...(kind === 'museCode' && { delegationMode: delegationMode() }),
          }
        },
        usageInsights: () => insights.read(),
        // Only the sidebar reopens on its last session; a tab is a new
        // conversation by construction (M6).
        isRestorable: surface.id === SIDEBAR_SURFACE_ID,
        dictation,
        now: () => Date.now(),
        log,
      })
      controllers.set(surface.id, controller)
    }
    return controller
  }

  const hostContext: WebviewHostContext = {
    extensionUri: context.extensionUri,
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
    onSurfaceReady: (surface) => {
      const controller = controllerFor(surface)
      controller.surfaceReady()
      surface.post({ type: 'editorContext', context: editorContext.summary })
      // A rebuilt panel resumes the session it held (D15); the sidebar
      // follows the ten-minute rule (M6).
      const restoredSessionId = surface.takeRestoredSessionId()
      const restore = () =>
        restoredSessionId === undefined
          ? controller.restoreRecentSession()
          : controller.restoreSession(restoredSessionId)
      if (auth.current.status === 'checking') {
        void auth.refresh().then(restore)
      } else {
        void restore()
      }
      // No setup offer where this window will not use the sandbox anyway.
      if (!backend.shellSandboxPosture().isSandboxed) {
        return
      }
      void sandbox.offerIfNeeded('startup')
    },
    onConversationMessage: (surface, message) => {
      void controllerFor(surface).handle(message)
    },
  }

  registry.onRemoved((surface) => {
    controllers.get(surface.id)?.dispose()
    controllers.delete(surface.id)
  })

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
    void modelApi.refreshSkills()
  }
  const projectSkillsWatcher = vscode.workspace.createFileSystemWatcher(PROJECT_SKILLS_GLOB)
  const personalSkillsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(skillsHome), PERSONAL_SKILLS_GLOB),
  )

  editorContext.update(editorSnapshot())
  context.subscriptions.push(
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
      editorContext.update(editorSnapshot())
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      editorContext.update(editorSnapshot())
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
      // Turning the Bypass setting off ends Bypass everywhere now (D24).
      if (
        event.affectsConfiguration(BYPASS_SETTING) &&
        !currentSettings().allowDangerouslySkipPermissions
      ) {
        for (const controller of controllers.values()) {
          void controller.revokeBypass()
        }
      }
      // A host keeps its sandbox posture, its environment and its binary for
      // life, and the backend choice is made per host: drop them so the next
      // message spawns afresh (and resumes the conversation, D25).
      const isBackendSetting = event.affectsConfiguration(BACKEND_SETTING)
      if (isBackendSetting) {
        void restartBackend().then(() => auth.refresh())
        return
      }
      const isCliSetting = CLI_PROCESS_SETTINGS.some((key) => event.affectsConfiguration(key))
      if (isCliSetting) {
        backend.invalidateLaunch()
      }
      const isHostSetting = isCliSetting || event.affectsConfiguration(SHELL_SANDBOX_SETTING)
      if (!isHostSetting || !backend.isRunning) {
        return
      }
      void restartBackend()
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.sandboxRestartNotice })
    }),
    // Trust is a host-lifetime posture like the sandbox (PLAN.md D13): the
    // hosts restart so the next message loads the rules and skills.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      // The index was built without git in Restricted Mode (D24).
      mentions.invalidate()
      void restartBackend()
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.trustGrantedNotice })
    }),
    // Editor-tab conversations come back after a window reload (D15).
    vscode.window.registerWebviewPanelSerializer(CHAT_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: (panel, state: unknown) => {
        restoreChatPanel(panel, state, hostContext, registry)
        return Promise.resolve()
      },
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInNewTab, () => {
      openChatPanel(hostContext, registry)
    }),
    vscode.commands.registerCommand(COMMAND_IDS.newConversation, async () => {
      const surface = registry.active
      if (surface === undefined) {
        await openConversation()
        return
      }
      surface.reveal()
      await controllerFor(surface).handle({ type: 'clearConversation' })
    }),
    vscode.commands.registerCommand(COMMAND_IDS.signOut, async () => {
      await auth.signOut()
      void vscode.window.showInformationMessage(UI_TEXT.signedOutNotice)
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInTerminal, () => {
      openMuseTerminal({
        resolveCli,
        runInTerminal,
        workspaceRoot,
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message)
        },
      })
    }),
    vscode.commands.registerCommand(COMMAND_IDS.createRulesFile, async () => {
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
    vscode.commands.registerCommand(COMMAND_IDS.openWalkthrough, async () => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.openWalkthrough,
        WALKTHROUGH_QUALIFIED_ID,
        false,
      )
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInSidebar, openSidebar),
    vscode.commands.registerCommand(COMMAND_IDS.showLogs, () => {
      channel.show(true)
    }),
    // The support report (PLAN.md D14): facts only, credentials as booleans.
    vscode.commands.registerCommand(COMMAND_IDS.diagnostics, async () => {
      const settings = currentSettings()
      const resolution = backend.resolveLaunch()
      const posture = backend.shellSandboxPosture()
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
          isBinaryPathConfigured: settings.museBinaryPath !== '',
          environmentVariableCount: settings.environmentVariables.length,
          cli: resolution.ok
            ? {
                ok: true,
                installDir: resolution.launch.installDir,
                version: backend.installedVersion(resolution.launch.installDir),
              }
            : { ok: false, reason: resolution.reason },
          hasCliCredentialFile: backend.credentialFileExists(),
          delegationMode: delegationMode(),
          hasStoredApiKey: (await credentials.getApiKey()) !== undefined,
          hasEnvironmentApiKey: backend.hasEnvironmentKey(),
          dictation: dictation.isAvailable
            ? { isAvailable: true }
            : { isAvailable: false, reason: dictation.reason },
          homeDir: homedir(),
        }),
      )
      channel.show(true)
    }),
    vscode.commands.registerCommand(COMMAND_IDS.focusInput, async () => {
      await toggleInputFocus({
        isInputFocused: () => isInputFocused,
        activeSurface: () => registry.active,
        focusEditor: () => vscode.commands.executeCommand(VSCODE_COMMANDS.focusActiveEditorGroup),
        openSidebar,
      })
    }),
    vscode.commands.registerCommand(COMMAND_IDS.insertMentionReference, async () => {
      await insertMentionReference({
        activeSelection,
        activeSurface: () => registry.active,
        openSidebar,
        showInformation: (message) => {
          void vscode.window.showInformationMessage(message)
        },
      })
    }),
    vscode.commands.registerCommand(COMMAND_IDS.toggleFocusView, async () => {
      await runHostAction('toggleFocusView')
    }),
    vscode.commands.registerCommand(COMMAND_IDS.toggleThinking, async () => {
      const surface = registry.active
      if (surface !== undefined) {
        await controllerFor(surface).toggleThinking()
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.setUpSandbox, async () => {
      await sandbox.runCommand()
    }),
  )
}
