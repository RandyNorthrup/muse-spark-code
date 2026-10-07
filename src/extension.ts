import { notify } from './core/events/notify'
import {
  PAID_APPROVAL_ORDER_DIRECTORY,
  LEGAL_EXPLANATION_BUNDLE_FILE,
  REFERENCE_BUNDLE_FILE,
  PROVIDER_SECRET_PREFIX,
  PROVIDERS_CONFIG_DIR_NAME,
  PROVIDERS_FILE_NAME,
  LEGAL_REGISTRY_NOTICE_KEY,
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
  COMMAND_IDS,
  CONTEXT_KEYS,
  DEFAULT_MODEL_ID,
  EXTENSION_NAME,
  DICTATION_HELPER_DIR,
  FIND_FILES_GLOB,
  MODEL_API_BASE_URL,
  MODEL_API_BUNDLE_FILE,
  MODEL_API_STATUS_READ_TIMEOUT_MS,
  REVIEW_BUNDLE_FILE,
  PLAN_MARKDOWN_BUNDLE_FILE,
  AGENT_IMPORT_BUNDLE_FILE,
  CONVERSATION_GIT_BUNDLE_FILE,
  CONVERSATION_BUNDLE_FILE,
  BUNDLED_SKILLS_BUNDLE_FILE,
  BUNDLED_SKILLS_SETTING,
  WHATS_NEW_BUNDLE_FILE,
  WHATS_NEW_CLAIMS_DIR,
  WHATS_NEW_CONTENT_FILE,
  OUTPUT_CHANNEL_SCHEME,
  CHECKPOINT_STORE_BUNDLE_FILE,
  BROWSER_CHECK_BUNDLE_FILE,
  BROWSER_RUNTIME_BUNDLE_FILE,
  CODE_INTEL_BUNDLE_FILE,
  MODELS_PANEL_BUNDLE_FILE,
  LEGAL_SCAN_BUNDLE_FILE,
  EXTENSION_SKILLS_DIR,
  WEB_FETCH_BUNDLE_FILE,
  VOICE_BUNDLE_FILE,
  MUSE_CODE_REVIEWER_BUNDLE_FILE,
  JUDGE_BUNDLE_FILE,
  MUSE_CODE_REVIEWER_DIR,
  EXTENSION_HOOKS_BUNDLE_FILE,
  MODEL_API_SCHEDULES_DIR,
  CHECKPOINTS_DIR,
  TURN_CHECKPOINTS_SETTING,
  MODEL_API_SESSIONS_DIR,
  PAID_FEATURE_SETTINGS,
  PAID_DAILY_BUDGET,
  type PaidFeature,
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
  PROMPT_BUNDLE_FILE,
  PROMPT_COMMAND_IDS,
  PROMPT_SYNC_SETTING,
  SANDBOX_NETWORK_SETTING,
  PAGE_WORKER_FILE,
  SEARCH_WORKER_FILE,
  SETTINGS_SECTION,
  SHELL_SANDBOX_SETTING,
  REPORT_ERROR_CODES,
  REPORT_EXIT_CODE,
  UI_TEXT,
  VSCODE_COMMANDS,
  WALKTHROUGH_QUALIFIED_ID,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
  WORKSPACE_STATE_KEYS,
  TAB_CONTEXT_FILES,
} from './shared/constants'
import { PaidAuthority } from './core/paid/paidAuthority'
import { Usd } from './shared/usd'
import {
  createUsageRecording,
  isUsageWriterBundle,
  type UsageRecording,
} from './core/usage/recording'
import { MuseCodeHost } from './core/backends/musecode/MuseCodeHost'
import { agentDataFolder } from './runtime/dataFolder'
import { requireFile } from './host/lazyBundle'
import { isJudgeEngineOn } from './core/judge/engine'
import { promptBundleLoader } from './host/prompts/promptBundle'
import type { createPromptHost } from './host/prompts/promptEntry'
import { judgeWindowPort } from './host/judge/judgeBundle'
import { storeErrorCode } from './host/backend/storeErrors'

import { createLegalFixApplier, legalFixFileEdits } from './host/legalFixApplier'
import { legalScanResultSchema, type LegalScanRunner } from './shared/legal'
import { isReferenceRequest, referenceLoader } from './host/referenceLoader'

// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { usagePanelLoader, isUsageBudgetBundle } from './host/usage/usagePanelBundle'
import type { UsagePanel } from './host/usage/usagePanel'

import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { AgentHost, BackendKind } from './core/agent/agentBackend'
import { environmentValue, terminalEnvironment } from './core/backends/musecode/launch'
import { confineWorkspacePath, resolveWorkspacePath } from './core/workspacePath'
import { isProtectedPath } from './core/protectedPaths'
import type { EditedFile } from './core/verify/diagnosticsReport'
import { readBackendChoice } from './core/backendSelection'
import { personalAgentsRoot } from './core/context/customAgents'
import {
  bundledSkillSourcesRoot,
  bundledSkillsPackageRoot,
  firstPartySkillsRoot,
  personalSkillsRoot,
} from './core/context/skills'
import { memoryDataRoot } from './core/memory/memoryLocation'
import { isSamePath } from './core/paths'
import { terminalArgument } from './core/shellQuote'
import { renderSupportReport } from './core/support/report'
import { isSandboxNetworkApplied } from './core/backends/musecode/sandbox'
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
import { isValidModelApiKey } from './host/auth/credentialStore'
import { ModelApiBackendManager } from './host/backend/modelApiBackendManager'
import { createFileScheduleStore } from './host/backend/fileScheduleStore'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { chooseAuthorizedHost } from './host/backend/selectedHost'
import { SandboxSetup } from './host/backend/sandboxSetup'
import { fileContextIo } from './host/backend/contextIo'
import { describeEnvironment } from './host/backend/environment'
import { createFileSessionStore } from './host/backend/fileSessionStore'
import type { QuestionStore } from './shared/questions'
import { modelApiMcpPoolDeps } from './host/backend/mcpServers'
import { type JobHelper, jobSourceReader } from './host/backend/jobSource'
import { mcpJobExecutable } from './host/backend/mcpJobExecutable'
import { createCheckpointedMemory } from './host/backend/checkpointedMemory'
import { systemPath } from './host/backend/memoryIo'
import {
  museSettingsPath,
  readDelegationMode,
  readWorkflowTriggerMode,
} from './host/backend/museSettings'
import { type ShellJobDeps, shellJobAssembly } from './host/backend/shellJob'
import {
  createToolIo,
  runResourceCommand as runProcess,
  readPickedFile,
  toolImagePreviewIo,
  hookEnvironment,
  terminalPlatform,
  withTerminalOverrides,
} from './host/backend/toolIo'
import { pluginContainment } from './host/backend/pluginContainment'
import { EditorContextTracker } from './host/editor/editorContextTracker'
import { createRevertIo } from './host/editor/revertIo'
import { createVerifyEditor } from './host/editor/verifyEditor'
import { verifyGuidance } from './core/verify/checkCommands'
import { IdeMcpServer } from './host/ide/ideMcpServer'
import { createRulesFile } from './host/commands/createRulesFile'
import { insertMentionReference } from './host/commands/insertMention'
import { openMuseTerminal, type TerminalLaunchOptions } from './host/commands/openInTerminal'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import type {
  ConversationController,
  ConversationReports,
  FileAccess,
  PickedFile,
  SessionMemory,
} from './host/conversation/conversationController'
import { conversationLoader } from './host/conversation/conversationBundle'
import { restartConversationBackends } from './host/conversation/conversationBackends'
import { BackgroundNotifier } from './host/conversation/turnNotifications'
import type { ReportDataSource } from './host/conversation/reportProblemHandler'
import { canonicalPath } from './host/canonicalPath'
import { loadToolImage } from './core/toolImages'
import { modelApiClientLoader } from './host/backend/modelApiBundle'
import { ideImageTools } from './host/ide/imageTools'
import { ideWebFetchTools, isIdeWebFetchOffered, oneQuestionPerUrl } from './host/ide/webFetchTool'
import { isWebFetchAllowed } from './host/web/webFetchConfirm'
import { pageConverter } from './host/web/pageConverter'
import { lazyPageUrlCheck, lazyWebFetcher, webFetchLoader } from './host/web/webFetchBundle'
import { BrowserChecks } from './host/browser/browserChecks'
import { isBrowserCheckAllowed } from './host/browser/browserCheckConfirm'
import { downloadBrowserRuntime } from './host/browser/runtimeCommand'
import { runtimeConsent } from './host/browser/runtimeConsent'
import { ideBrowserCheckTools } from './host/ide/browserCheckTool'
import { type BrowserCheckHost, browserScopeKey } from './core/browser/browserTool'
import { ideCodeIntelTools } from './host/ide/codeIntelTools'
import { codeIntelLoader } from './host/ide/codeIntelBundle'
import { ideLegalScanTools, isIdeLegalScanOffered } from './host/ide/legalScanTool'

import { fill as fillLegalNotice, fill, plural, uiLocale } from './shared/l10n/text'
import { legalScanLoader, legalExplanationLoader } from './host/ide/legalScanBundle'
import { vscodeLanguageServices } from './host/codeIntel/languageServices'
import { usablePaidFeatures } from './shared/paid'
import { agentImportLoader } from './host/agentImportBundle'
import {
  TAB_BUNDLE_FILE,
  TAB_LEDGER_DIR,
  TAB_SNOOZE_STATE_KEY,
  type TabFilesExclude,
  createTabActivation,
  tabTextChangeEvent,
  deferredRefresh,
} from './host/tab/tabBundle'
import { createCliFeatures } from './host/cliFeatures'
import {
  bundledSkillsLoader,
  createBundledSkillsOffer,
  runBundledSkillsInstall,
  runBundledSkillsRemove,
  type BundledSkillsCommandDeps,
} from './host/skills/bundledSkills'
import { hasClaimedVersion, createWhatsNew } from './host/whatsNew/whatsNew'
import { createSessionTransferFiles } from './host/conversation/transferDialogs'
import { createWorktreeFeatures } from './host/worktreeFeatures'
import { heldWorktreesRoot, holdFor } from './core/worktreeConversations'
import {
  conversationGitFactory,
  conversationGitLoader,
  gitFeaturesLoader,
  openPullRequestInConversation,
} from './host/git/conversationGitBundle'
import { WindowHold, WorktreeRegistry } from './host/git/worktreeRegistry'
import { lazyReview } from './host/review/reviewBundle'
import { PendingPrompts, type BoardSession } from './core/sessionBoard'
import { BestOfNCoordinator } from './core/bestOfN/bestOfNCoordinator'
import { createMemoryFeatures } from './host/memoryFeatures'
import { createPlanFiles, createPlanIo } from './host/planFeatures'
import { planMarkdownLoader } from './host/planMarkdownBundle'
import { extensionHooksBundle, type ExtensionHooksModule } from './host/extensionHooksBundle'
import type { ExtensionHookRunner } from './host/extensionHooksEntry'
import { showPickOne } from './host/quickPick'
import { processGitLocator, processGitProcess, processGitRunner } from './host/git'
import { configureResources } from './core/resources/admission'
import {
  createCheckpointPort,
  finishCheckpointTurn,
  prepareCheckpointTurn,
  withCheckpointStorageGuard,
  withCheckpointEdit,
  withCheckpointEditAt,
} from './host/checkpoints/checkpointHost'
import { checkpointStoreLoader } from './host/checkpoints/checkpointStoreBundle'
import { type CheckpointLocation, checkpointLocation } from './host/checkpoints/checkpointLocation'
import { isProcessAlive } from './host/checkpoints/windowPresence'
import { ReportRecorder } from './host/support/reportRecorder'
import type * as RecorderBundle from './host/support/recorderEntry'
import { vscodeReportEditorIo } from './host/support/reportEditorIo'
import {
  changedSettingNames,
  extensionReportFacts,
  manifestSettingNames,
  reportScrubContext,
} from './host/support/reportFacts'
import { createLogger, errorDetail, type Logger, logRejection } from './host/logger'
import {
  liveFetch,
  managedConfiguration,
  readNetworkFacts,
  readProxySettings,
} from './host/networkPosture'
import { OutputDocumentStore } from './host/outputDocuments'
import { loggedPopups } from './host/popups'
import { pickMentionFile } from './host/mention/mentionQuickPick'
import { createWorkspaceFileLister, findRootFiles } from './host/mention/workspaceFiles'
import { permissionSettingsOf, readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from './host/views/ChatViewProvider'
import { openChatPanel, restoreChatPanel } from './host/views/chatPanel'
import { TasksPanel } from './host/views/tasksPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface } from './host/views/chatSurface'
import type { WebviewHostContext } from './host/views/webviewSetup'
import { loadUiTable, readUiTableFile } from './host/l10n'
import type { InsightsReader } from './runtime/usage/traceLogs'
import { createDictationSetup, createMuseVoiceSetup } from './host/voice/dictationHost'
import { voiceLoader } from './host/voice/voiceBundle'
import { museCodeReviewerPort } from './host/review/museCodeReviewerBundle'
import { createPaidFeatures } from './host/paid/paidHost'
import { isActivationPaidSettingOn } from './host/paid/paidActivation'
import {
  modelsPanelLoader,
  providerCredentials,
  recoverProviderRemovals,
} from './host/models/modelsPanelBundle'
import type { ModelsPanelFeatures } from './host/models/modelsPanelEntry'
import type { createPaidDailyBudget } from './host/paid/paidDailyBudget'

import { imageUseRequest } from './core/backends/modelapi/imageGeneration'

import { BACKEND_KINDS, type HostAction } from './shared/protocol'
import type { AccountFacts } from './shared/usage'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })
// `workspaceState` values are whatever an earlier version stored.
const archivedIdsSchema = z.array(z.string())
const damagedIdsSchema = z.array(z.string())
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
const automaticBestOfNGit = processGitRunner({ isAutomatic: true })

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

/** `fsPath` as given and, when it exists, resolved through links (M71's hold reads both). */
function pathSpellings(fsPath: string): readonly string[] {
  try {
    return [fsPath, realpathSync.native(fsPath)]
  } catch {
    // Not there yet (no pull request checked out anywhere): the given path is all there is.
    return [fsPath]
  }
}

/**
 * Set by `activate`: stops the hosts, their turns and their processes; and
 * the window's flight recorder (M93), whose marker a normal exit clears.
 */
const lifecycle: {
  shutdown: (() => Promise<void>) | undefined
  reports: ReportRecorder | undefined
} = { shutdown: undefined, reports: undefined }

/**
 * VS Code awaits this before the extension host exits (PLAN.md D25): running
 * turns are cancelled and `muse serve` is closed rather than left to the
 * process teardown, while the log channel is still open to say so. Last, the
 * flight recorder clears this activation's marker: only a window that never
 * got here leaves one behind (M93, D72).
 */
export async function deactivate(): Promise<void> {
  await lifecycle.shutdown?.()
  lifecycle.shutdown = undefined
  await lifecycle.reports?.shutdown()
  lifecycle.reports = undefined
}

/** `files.exclude` as Tab reads it: the switches and the `when` conditions (M94). */
function tabFilesExcludeTable(value: unknown): TabFilesExclude {
  const table: Record<string, boolean | { readonly when: string }> = {}
  if (typeof value === 'object' && value !== null) {
    const entries: [string, unknown][] = Object.entries(value)
    for (const [glob, entry] of entries) {
      if (typeof entry === 'boolean') {
        table[glob] = entry
      } else if (
        typeof entry === 'object' &&
        entry !== null &&
        'when' in entry &&
        typeof entry.when === 'string'
      ) {
        // A condition is kept, never dropped (RVM94HU 14).
        table[glob] = { when: entry.when }
      }
    }
  }
  return table
}

/**
 * A command whose failure is logged, with its stack, and said once (M39). A
 * rejected command would otherwise reach only VS Code's Extension Host log.
 * Arguments pass through for the commands that take them (Tab's accept).
 */
function registerLoggedCommand(
  log: Logger,
  id: string,
  run: (...args: unknown[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, async (...args: unknown[]) => {
    try {
      return await run(...args)
    } catch (error: unknown) {
      log.error(`${id} failed: ${errorDetail(error)}`)
      const reason = error instanceof Error ? error.message : String(error)
      void vscode.window.showErrorMessage(`${UI_TEXT.actionFailed}: ${reason}`)
      return
    }
  })
}

function isUsageInsightsBundle(value: unknown): value is {
  createInsightsReader(deps: { homeDir: string; now: () => number }): InsightsReader
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createInsightsReader' in value &&
    typeof value.createInsightsReader === 'function'
  )
}

/** A signal that ends a process, as the recorder's vocabulary names it. */
const EXIT_SIGNAL = /\bSIG[A-Z]{2,6}\b/

/**
 * How Muse Code's process ended, as one word of the recorder's vocabulary
 * (M93, D72): the signal named in the exit's description, or `exited`.
 * The description itself (which can name a path) is never recorded.
 */
function exitCodeWord(description: string): string {
  const signal = EXIT_SIGNAL.exec(description)?.[0]
  return signal !== undefined && REPORT_ERROR_CODES.has(signal) ? signal : REPORT_EXIT_CODE
}

/** What activation made before anything else could fail: the log and the flight recorder. */
interface EarlyActivation {
  readonly usageRecording: UsageRecording
  readonly activationStartedAt: number
  readonly channel: vscode.LogOutputChannel
  readonly log: Logger
  readonly version: string
  readonly reports: ReportRecorder
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // How long activation takes, for the log (M39).
  const activationStartedAt = performance.now()
  const channel = vscode.window.createOutputChannel(PRODUCT_NAME, { log: true })
  const log = createLogger(channel)
  const resourceJobSource = jobSourceReader(context.extensionPath)
  const resourceAssembly = windowsJobHelper(
    shellJobAssembly,
    context.globalStorageUri.fsPath,
    resourceJobSource,
    log,
  )
  const resourceMcpJob = windowsJobHelper(
    mcpJobExecutable,
    context.globalStorageUri.fsPath,
    resourceJobSource,
    log,
  )
  context.subscriptions.push({
    dispose: configureResources({
      inspect: (key) => vscode.workspace.getConfiguration('museSpark').inspect(key),
      onError: () => {
        log.warn('Resource tree or sampler reading is unavailable')
      },
      windowsJob: async () => {
        const assemblyPath = await resourceAssembly?.()
        const executablePath = await resourceMcpJob?.()
        return assemblyPath === undefined || executablePath === undefined
          ? undefined
          : { assemblyPath, executablePath }
      },
    }),
  })
  const usageRecording = createUsageRecording({
    client: vscode.env.appName,
    now: Date.now,
    newId: () => crypto.randomUUID(),
    isEnabled: () =>
      vscode.workspace.getConfiguration(SETTINGS_SECTION).get<boolean>('usageHistory', true),
    log,
    writer: async (onWriteError) => {
      const bundle = requireFile(path.join(context.extensionPath, 'dist', 'usageService.js'))
      if (!isUsageWriterBundle(bundle)) throw new Error('Usage writer factory unavailable')
      return await bundle.createUsageWriter({
        dataFolder: agentDataFolder({
          platform: process.platform,
          env: process.env,
          homeDir: homedir(),
        }),
        writerId: crypto.randomUUID(),
        now: Date.now,
        isEnabled: () =>
          vscode.workspace.getConfiguration(SETTINGS_SECTION).get<boolean>('usageHistory', true),
        onWriteError,
      })
    },
  })
  MuseCodeHost.usageRecording = usageRecording
  ModelApiBackendManager.usageRecording = usageRecording
  context.subscriptions.push({
    dispose: () => {
      void usageRecording.flush()
    },
  })
  const { version } = packageManifestSchema.parse(context.extension.packageJSON)
  // The flight recorder (M93, PLAN.md D6, D72): this window's journal and
  // activation marker under global storage. Its front answers from here on;
  // the journal itself (dist/recorder.js) loads just after activation, or at
  // the first failure, and keeps every record until then.
  const reports = new ReportRecorder({
    load: async () => {
      const bundle: typeof RecorderBundle = await import('./host/support/recorderEntry')
      return bundle.createWindowJournal({
        globalStorageDir: context.globalStorageUri.fsPath,
        instance: crypto.randomUUID(),
        ext: version,
        host: vscode.version,
        pid: process.pid,
        log,
        isAlive: isProcessAlive,
        extensionRoot: context.extensionPath,
        now: () => Date.now(),
      })
    },
    now: () => Date.now(),
    onUnavailable: (error) => {
      log.error(`The flight recorder bundle could not be loaded: ${errorDetail(error)}`)
    },
  })
  lifecycle.reports = reports
  try {
    await activateWindow(context, {
      activationStartedAt,
      channel,
      log,
      version,
      reports,
      usageRecording,
    })
  } catch (error: unknown) {
    reports.recordError('activationFailed', error)
    throw error
  }
}

async function activateWindow(
  context: vscode.ExtensionContext,
  early: EarlyActivation,
): Promise<void> {
  const { activationStartedAt, channel, log, version, reports, usageRecording } = early
  log.info(
    `Activating ${PRODUCT_NAME} ${version} (VS Code ${vscode.version}, Node ${process.versions.node}, ${process.platform})`,
  )
  // What's New (M99, PLAN.md D79): read before anything below stores state
  // or creates the global storage folder, so an upgrade from a version
  // before this feature (no version stored) is told from a fresh install.
  const hasEarlierUse =
    context.globalState.keys().length > 0 ||
    context.workspaceState.get(WORKSPACE_STATE_KEYS.lastSession) !== undefined ||
    existsSync(context.globalStorageUri.fsPath)
  // A page seen on one machine is not shown again on another (Settings Sync).
  context.globalState.setKeysForSync([GLOBAL_STATE_KEYS.whatsNewLastSeenVersion])
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
    readExtensionFile: (segments) => readUiTableFile(context.extensionUri.fsPath, segments),
    log,
  })

  const registry = new SurfaceRegistry()
  const readyPromptSurfaces = new WeakSet<ChatSurface>()
  let promptHost: ReturnType<typeof createPromptHost> | undefined

  const controllers = new Map<string, ConversationController>()
  // Approvals and questions waiting on the user, shared by every surface's
  // controller so the session board marks them window-wide (M77).
  const boardPrompts = new PendingPrompts()
  const bestOfNCoordinator = new BestOfNCoordinator()
  // A chat's tasks tab; it leaves once both the chat and the tab are closed.
  const tasksTabs = new Map<string, TasksPanel>()
  context.subscriptions.push({
    dispose: () => {
      for (const tab of tasksTabs.values()) {
        tab.dispose()
      }
    },
  })
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
  // The folder as VS Code spells it: what sessions, the CLI's working
  // directory and memory have always been keyed by. Only the checkpoint store
  // uses the canonical root (below), and it accepts both spellings.
  const workspaceRoot = firstFolderPath()
  const nativeStarts = new AbortController()
  context.subscriptions.push({
    dispose: () => {
      nativeStarts.abort()
    },
  })
  // Conversations in a worktree and someone else's pull requests (M71, PLAN.md
  // D49): a window on a folder under the extension's pull request worktrees is
  // held until the user trusts it in the card, whatever VS Code's trust says.
  const storageRoot = context.globalStorageUri.fsPath
  let loadedQuestionsStore: QuestionStore | undefined
  const questionStore = () => {
    loadedQuestionsStore ??= loadConversation().createHostQuestionStore(storageRoot)
    return loadedQuestionsStore
  }
  const questionsStore: QuestionStore = {
    load: (id) => questionStore().load(id),
    save: (id, questions) => questionStore().save(id, questions),
    remove: (id) => questionStore().remove(id),
  }
  const worktreeRegistry = new WorktreeRegistry(context.globalState, process.platform, existsSync)
  const windowHold = new WindowHold(
    holdFor(
      workspaceRoot === undefined ? [] : pathSpellings(workspaceRoot),
      pathSpellings(heldWorktreesRoot(storageRoot, process.platform)),
      worktreeRegistry.records(),
      process.platform,
    ),
  )
  if (windowHold.isHeld) {
    log.info(
      "This window is held on someone else's pull request: Plan mode, no project configuration",
    )
  }
  /**
   * Whether the project's own configuration may load (rules, skills, hooks,
   * MCP servers, and the backends' workspace shell): VS Code trusts the
   * folder, and the window is not held (M71).
   */
  const isProjectTrusted = () =>
    !nativeStarts.signal.aborted &&
    windowHold.allowsProjectConfiguration(vscode.workspace.isTrusted)
  let checkpointRoot: CheckpointLocation | undefined
  try {
    checkpointRoot = await checkpointLocation(
      workspaceRoot,
      context.globalStorageUri.fsPath,
      process.platform,
    )
  } catch {
    log.warn('Checkpoint workspace identity could not be established')
  }
  // Turn checkpoints (M72, M86; PLAN.md D51, D63): a shadow repository and
  // the windows' write journals under global storage, keyed by the canonical
  // first folder. Current-version windows in this namespace share per-record
  // refs independently of workspace identity. Recording requires trust, git
  // and the setting. Startup admission precedes auth request any workspace-cwd
  // serve, independently of the recording setting. Closing the window ends its
  // git; native uncertainty remains durable. Opening it (or trusting the
  // workspace) recovers gone windows' journals and applies cleanup and retention.
  const checkpointBundle = checkpointStoreLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', CHECKPOINT_STORE_BUNDLE_FILE)
      .fsPath,
    log,
  })
  // This window's instance (M86): one journal and one order of writes, which
  // the turns' recorder (made below, over the window's tool io) and the
  // store's restores and Redos share.
  const writeRecording =
    checkpointRoot === undefined
      ? undefined
      : checkpointBundle().createTurnRecording({
          storageDir: checkpointRoot.storageDir,
          instance: crypto.randomUUID(),
          platform: process.platform,
        })
  const checkpointStore =
    checkpointRoot === undefined || writeRecording === undefined
      ? undefined
      : checkpointBundle().createCheckpointStore(
          {
            workspaceRoot: checkpointRoot.canonicalRoot,
            displayRoot: workspaceRoot,
            storageDir: checkpointRoot.storageDir,
            instance: writeRecording.instance,
            journal: writeRecording.journal,
            lanes: writeRecording.lanes,
            // Every window's checkpoint storage: no tool writes below it (Codex, PR #55).
            storageRoot: path.join(context.globalStorageUri.fsPath, CHECKPOINTS_DIR),
            platform: process.platform,
            git: processGitProcess(),
            env: process.env,
            retentionDays: () => currentSettings().cleanupPeriodDays,
            now: () => Date.now(),
            newId: () => crypto.randomUUID(),
            pid: process.pid,
            isProcessAlive,
            log,
          },
          UI_TEXT,
          uiLocale(),
        )
  if (checkpointStore !== undefined) {
    context.subscriptions.push({
      dispose: () => {
        checkpointStore.dispose()
      },
    })
  }
  if (writeRecording !== undefined) {
    context.subscriptions.push({
      dispose: () => {
        void writeRecording.journal.close().catch(logRejection(log, 'closing the write journal'))
      },
    })
  }
  const checkpoints = createCheckpointPort({
    isNamespaceKnown: () => checkpointRoot !== undefined,
    legacyTurns: async (sessionId) =>
      checkpointRoot === undefined || context.storageUri === undefined
        ? []
        : await checkpointBundle().legacyCheckpointTurns(
            {
              storageDir: path.join(context.storageUri.fsPath, CHECKPOINTS_DIR),
              workspaceRoot: checkpointRoot.canonicalRoot,
              platform: process.platform,
              git: processGitProcess(),
              env: process.env,
              signal: new AbortController().signal,
            },
            sessionId,
            UI_TEXT,
            uiLocale(),
          ),
    onAvailabilityChanged: () => {
      for (const controller of controllers.values()) {
        controller.checkpointAvailabilityChanged()
      }
    },
    store: checkpointStore,
    // A held pull request worktree is untrusted for git as Restricted Mode is (M71, D24).
    isWorkspaceTrusted: isProjectTrusted,
    isEnabled: () => currentSettings().turnCheckpoints,
    hasGit: processGitLocator(),
  })
  void checkpoints.maintain().catch(logRejection(log, 'checkpoint cleanup'))
  let insightsReader: InsightsReader | undefined
  const insights: InsightsReader = {
    read: async () => {
      if (insightsReader === undefined) {
        const bundle = requireFile(path.join(context.extensionPath, 'dist', 'usageService.js'))
        if (!isUsageInsightsBundle(bundle)) throw new Error(UI_TEXT.actionFailed)
        insightsReader = bundle.createInsightsReader({ homeDir: homedir(), now: Date.now })
      }
      return await insightsReader.read()
    },
  }

  const modelsPanelBundle = modelsPanelLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', MODELS_PANEL_BUNDLE_FILE).fsPath,
    log,
  })
  const providerConfigFile = path.join(
    process.env['XDG_CONFIG_HOME'] ?? path.join(homedir(), '.config'),
    PROVIDERS_CONFIG_DIR_NAME,
    PROVIDERS_FILE_NAME,
  )
  let isSubscriptionConnecting = false
  let subscriptions:
    ReturnType<ReturnType<typeof modelsPanelBundle>['createSubscriptionFeatures']> | undefined
  const subscriptionFeatures = () =>
    (subscriptions ??= modelsPanelBundle().createSubscriptionFeatures({
      log,
      secrets: context.secrets,
      globalStorageUri: context.globalStorageUri,
      globalState: context.globalState,
      l10n,
      catalogFile: vscode.Uri.joinPath(context.extensionUri, 'dist', 'providerCatalog.json').fsPath,
      configFile: providerConfigFile,
      isRemote: vscode.env.remoteName !== undefined,
      isConfidential: () => currentSettings().confidentialWorkspace,
      access: context.languageModelAccessInformation,
      disconnected: async () => {
        await restartBackend('a subscription disconnected')
        await auth.refresh()
      },
      connected: async (ref) => {
        isSubscriptionConnecting = true
        try {
          await vscode.workspace
            .getConfiguration(SETTINGS_SECTION)
            .update('backend', 'modelApi', vscode.ConfigurationTarget.Global)
          await restartBackend('a subscription connected')
          await auth.refresh()
          await setComposerModel(ref)
        } finally {
          isSubscriptionConnecting = false
        }
      },
    }))
  const providersSeamBundle = () => subscriptionFeatures().seam
  const credentials = providerCredentials(context.secrets, log, async () => {
    const features = subscriptionFeatures()
    const entries = await features.seam.store.list()
    // Only a live, non-confidential host grant supplies credential-free readiness.
    return entries.map((entry) =>
      entry.id === 'copilot' && features.hasCopilotAccess()
        ? { ...entry, auth: 'none' as const }
        : entry,
    )
  })
  // The paid Model API features (M33–M35, PLAN.md D30): on only with the
  // setting on and the price accepted; every panel shows which are on.
  // Whether a Model API key is stored (M44): the Muse Code backend then
  // offers the key's paid images and voice. Read at start and after every
  // sign-in change, never from anywhere but the secret store.
  let isKeyStored = false
  let paidBackend: 'modelApi' | 'museCode' | undefined
  const isDefaultPaidOn = (feature: PaidFeature) =>
    vscode.workspace
      .getConfiguration(SETTINGS_SECTION)
      .inspect<boolean>(PAID_FEATURE_SETTINGS[feature])?.globalValue === undefined
  const paidAuthority = new PaidAuthority()
  let paidDaily: ReturnType<typeof createPaidDailyBudget> | undefined
  const loadDailyPaid = () => {
    if (paidDaily !== undefined) return paidDaily
    const bundle = requireFile(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'usagePanel.js').fsPath,
    )
    if (!isUsageBudgetBundle(bundle)) throw new Error(UI_TEXT.actionFailed)
    paidDaily = bundle.createUsageBudget({
      l10n,
      authority: paidAuthority,
      directory: path.join(context.globalStorageUri.fsPath, PAID_DAILY_BUDGET.directory),
      now: Date.now,
      capUsd: () => currentSettings().paidDailyBudgetUsd,
      isModelApi: () => paidBackend === 'modelApi',
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }),
    })
    return paidDaily
  }
  const dailyPaid: ReturnType<typeof createPaidDailyBudget> = {
    capUsd: () => loadDailyPaid().capUsd(),
    reserve: (...args) => loadDailyPaid().reserve(...args),
    reserveExact: (costUsd) => loadDailyPaid().reserveExact(costUsd),
    readToday: () => loadDailyPaid().readToday(),
    judgeLedger: {
      remainingUsd: () => loadDailyPaid().judgeLedger.remainingUsd(),
      reserve: (costUsd) => loadDailyPaid().judgeLedger.reserve(costUsd),
    },
    latestDay: () => loadDailyPaid().latestDay(),
    lookupByClaimId: (scope, claimId) => loadDailyPaid().lookupByClaimId(scope, claimId),
  }
  const paid = createPaidFeatures({
    usageRecording,
    authority: paidAuthority,
    orderDirectory: path.join(context.globalStorageUri.fsPath, PAID_APPROVAL_ORDER_DIRECTORY),
    globalState: context.globalState,
    workspaceState: context.workspaceState,
    isSettingOn: (feature) => isActivationPaidSettingOn(feature, currentSettings()),
    isJudgeOn: () => isJudgeEngineOn(currentSettings()['judge.engine']),
    isAvailable: (feature) =>
      feature === 'tab' || paidBackend === 'modelApi' || !isDefaultPaidOn(feature),
    isDefaultOn: isDefaultPaidOn,
    dailyBudgetUsd: (feature) =>
      paidBackend === 'modelApi' || feature === 'legalExplanation' ? dailyPaid.capUsd() : undefined,
    isKeyStored: () => isKeyStored,
    // "Allow always in this workspace" (M58) needs a workspace to keep it,
    // and never in Restricted Mode.
    canRememberPaidUse: () =>
      vscode.workspace.isTrusted && (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    // Account & usage's Tab row reads the configured budget and the ledger's
    // cross-window day (RVM94HU 23–24); `tab` is read only when it runs.
    tabDay: () => ({
      budgetUsd: currentSettings().tabDailyBudgetUsd,
      todayUsd: tab.todayTotalUsd(),
    }),
    log,
  })
  // The Auto reviewer on Muse Code (M90, PLAN.md D69): dist/museCodeReviewer.js
  // (D6), required on the first review; one side session and one queue for
  // the window, in an empty folder of the extension's own.
  const museCodeReviewer = museCodeReviewerPort({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', MUSE_CODE_REVIEWER_BUNDLE_FILE)
      .fsPath,
    root: path.join(context.globalStorageUri.fsPath, MUSE_CODE_REVIEWER_DIR),
    isOn: () => currentSettings().museCodeAutoReviewer,
    log,
  })
  const judge = judgeWindowPort({
    ledger: dailyPaid.judgeLedger,
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', JUDGE_BUNDLE_FILE).fsPath,
    engine: () => currentSettings()['judge.engine'],
    context: (action) => {
      if (!isProjectTrusted()) return
      for (const controller of controllers.values()) {
        const current = controller.judgeContext(action.sessionId, action.turnId)
        if (current !== undefined)
          return {
            ...current,
            ownerId: String(auth.admissionGeneration),
            confidential: currentSettings().confidentialWorkspace,
          }
      }
      return
    },
    readSettingsText: () => {
      try {
        return readFileSync(museSettingsPath(museConfig()), 'utf8')
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') return
        throw error
      }
    },
    startSession: async (options) => {
      const host = await backend.ensureHost()
      return await host.startSession(options)
    },
    modelApi: (action) => modelApi.judgeConnection(action.sessionId, action.turnId),
    paid,
    emit: (action, event) => {
      for (const controller of controllers.values()) {
        if (controller.boardSession()?.sessionId === action.sessionId)
          controller.postJudge({ type: 'agentEvent', event })
      }
    },
    status: (action, status) => {
      for (const controller of controllers.values()) {
        if (controller.boardSession()?.sessionId === action.sessionId)
          controller.postJudge({ type: 'judgeState', state: status })
      }
    },
    notice: (text) => {
      registry.broadcast({ type: 'notice', level: 'info', text })
    },
    log,
  })
  context.subscriptions.push({
    dispose: () => {
      museCodeReviewer.dispose()
      judge.dispose()
    },
  })
  // Both engines' drivers are dist/voice.js (D6), required on the first recording.
  const voice = voiceLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', VOICE_BUNDLE_FILE).fsPath,
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
      voice,
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
    tab.refreshStatus()
  }
  // Inline completions (Tab) (M94, PLAN.md D73): the secret read waits for
  // the first view, panel, command or Tab request. Activation with no view
  // or panel and Tab off reads no secret, starts no process and requires no
  // lazy bundle; the openers and the view provider below call this, and the
  // shim calls it on the first enable.
  const ensureKeyPresence = deferredRefresh(refreshKeyPresence)
  // Inline completions (Tab) (M94, PLAN.md D73): the shim. With the setting
  // off, no bundle load, no request, no secret read, no process: dist/tab.js
  // loads only for an explicit Tab command or while the setting is on. Only
  // types and the loader come from the Tab side here, so dist/extension.js
  // carries the small status item, but none of the provider, engine (lane C) or
  // the ledger (lane L). Tab is on by default (owner, 2026-10-04): no
  // turn-on price confirmation; the first request asks D48's question with
  // the price and the daily budget, and nothing is sent before the answer.
  const tabRecentEdits = new Map<string, { readonly uri: vscode.Uri; readonly line: number }>()
  const tabIgnoreListeners = new Set<() => void>()
  const tabIgnoreWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{.gitignore,.cursorignore,.continueignore}',
  )
  const tabIgnoreCleared = () => {
    for (const clear of tabIgnoreListeners) {
      clear()
    }
  }
  const tabDisposables = [
    vscode.workspace.onDidChangeTextDocument((event) => {
      const change = event.contentChanges.at(0)
      if (change === undefined || event.document.uri.scheme !== 'file') return
      {
        const key = event.document.uri.toString()
        tabRecentEdits.delete(key)
        tabRecentEdits.set(key, { uri: event.document.uri, line: change.range.start.line })
        if (tabRecentEdits.size > TAB_CONTEXT_FILES) {
          const oldest = tabRecentEdits.keys().next().value
          if (oldest !== undefined) tabRecentEdits.delete(oldest)
        }
      }
    }),
    tabIgnoreWatcher,
    tabIgnoreWatcher.onDidChange(tabIgnoreCleared),
    tabIgnoreWatcher.onDidCreate(tabIgnoreCleared),
    tabIgnoreWatcher.onDidDelete(tabIgnoreCleared),
  ]
  const isTabWorkspaceRoot = (root: string, absolutePath: string): boolean => {
    if (process.platform === 'win32') {
      const file = absolutePath.toLowerCase()
      const folder = root.toLowerCase()
      return file === folder || file.startsWith(`${folder}${path.sep}`)
    }
    return absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`)
  }
  const tab = createTabActivation({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', TAB_BUNDLE_FILE).fsPath,
    log,
    isTabSettingOn: () => currentSettings().modelApiTab,
    tabSettings: () => {
      const settings = currentSettings()
      return {
        tabModel: settings.tabModel,
        tabLanguages: settings.tabLanguages,
        tabMultiline: settings.tabMultiline,
        tabTrigger: settings.tabTrigger,
        tabWithCopilot: settings.tabWithCopilot,
        tabDailyBudgetUsd: settings.tabDailyBudgetUsd,
      }
    },
    isPaidOn: () => paid.gate.isOn('tab'),
    isKeyStored: () => isKeyStored,
    isTrusted: isProjectTrusted,
    ensureKeyPresence,
    updateSetting: async (key, value) => {
      await updateSetting(key, value)
    },
    registerCommand: (id, run) => registerLoggedCommand(log, id, run),
    // Links resolved before a file is read (RVM94HU 12).
    realPath: async (absolutePath) => await canonicalPath(absolutePath),
    registerProvider: (provider) =>
      vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, provider),
    setTabOnContext: (isOn) => {
      void vscode.commands.executeCommand('setContext', CONTEXT_KEYS.tabOn, isOn)
    },
    foreignSetting: (section, key) => vscode.workspace.getConfiguration(section).get(key),
    isCopilotExtensionPresent: () =>
      vscode.extensions.getExtension('GitHub.copilot')?.isActive === true ||
      vscode.extensions.getExtension('GitHub.copilot-chat')?.isActive === true,
    filesExclude: (uri) =>
      tabFilesExcludeTable(vscode.workspace.getConfiguration('files', uri).get('exclude')),
    workspaceRoots: (absolutePath) =>
      (vscode.workspace.workspaceFolders ?? [])
        .map((folder) => folder.uri.fsPath)
        .filter((root) => isTabWorkspaceRoot(root, absolutePath))
        .toSorted((a, b) => b.length - a.length),
    ignoreFileExists: (absolutePath) => {
      try {
        return statSync(absolutePath).isFile()
      } catch {
        return false
      }
    },
    runGit: (args, cwd) =>
      runGit(args, cwd, undefined, undefined, () => {
        if (!isProjectTrusted()) {
          throw new Error(UI_TEXT.tabStatusUntrusted)
        }
      }),
    onIgnoreFilesChanged: (clear) => {
      tabIgnoreListeners.add(clear)
      return {
        dispose: () => {
          tabIgnoreListeners.delete(clear)
        },
      }
    },
    recentEdits: () => {
      const edits: { readonly uri: vscode.Uri; readonly line: number }[] = []
      for (const edit of tabRecentEdits.values()) edits.unshift(edit)
      return edits
    },
    onDidChangeTextDocument: (listener) =>
      vscode.workspace.onDidChangeTextDocument((event) => {
        listener(tabTextChangeEvent(event))
      }),
    activeLanguageId: () => vscode.window.activeTextEditor?.document.languageId,
    knownLanguages: async () => await vscode.languages.getLanguages(),
    confirmCopilotDisable: async (languageId) => {
      const turnOff = fill(UI_TEXT.tabMenuCopilotOff, { language: languageId })
      return (
        (await vscode.window.showWarningMessage(
          fill(UI_TEXT.tabCopilotConfirmTitle, { language: languageId }),
          { modal: true, detail: fill(UI_TEXT.tabCopilotConfirmDetail, { language: languageId }) },
          turnOff,
        )) === turnOff
      )
    },
    disableCopilotFor: async (languageId) => {
      const config = vscode.workspace.getConfiguration('github.copilot')
      const current = config.get<unknown>('enable')
      const table: Record<string, unknown> = {}
      if (typeof current === 'object' && current !== null) {
        for (const [key, val] of Object.entries(current)) {
          table[key] = val
        }
      }
      table[languageId] = false
      await config.update('enable', table, vscode.ConfigurationTarget.Global)
    },
    // The conversation in view opens Account & usage; with none, the sidebar
    // comes forward and opens it (RVM94HU 21).
    openAccountUsage: async () => {
      const surface = registry.active
      if (surface === undefined) {
        await openSidebar()
      } else {
        surface.reveal()
      }
      registry.active?.post({ type: 'openUsage' })
    },
    runCommand: async (command) => {
      await vscode.commands.executeCommand(command)
    },
    table: () => UI_TEXT,
    locale: () => uiLocale(),
    snoozeStore: {
      readSnoozedUntil: () => {
        const end = context.globalState.get<unknown>(TAB_SNOOZE_STATE_KEY)
        return typeof end === 'number' && Number.isFinite(end) ? end : undefined
      },
      writeSnoozedUntil: async (endMs) => {
        await context.globalState.update(TAB_SNOOZE_STATE_KEY, endMs)
      },
      nowMs: () => Date.now(),
    },
    // The bundle builds its engine (lane C) and its spend gate over this
    // window's ledger file (lane L) from these. The key client is the one
    // M44 loads on its first paid use; it is read only on a Tab request.
    services: {
      stream: (body, signal, budget) => keyClient().streamResponse(body, signal, undefined, budget),
      ledgerDirectory: path.join(context.globalStorageUri.fsPath, TAB_LEDGER_DIR),
      windowId: crypto.randomUUID(),
      onSent: () => {
        paid.usage.addTabRequest()
      },
      onUsage: (model, usage) => {
        paid.usage.addTabUsage(model, usage)
      },
    },
    // Account & usage's Tab row follows the ledger's day (RVM94HU 23).
    onTodayTotalChanged: () => {
      broadcastPaidState()
    },
    // D48's question, once per window (Q-M94a): the first request asks with
    // the model's rates and today's budget; Deny snoozes the window.
    consent: {
      requestUse: async () => {
        const settings = currentSettings()
        return await paid.consent.allows({
          feature: 'tab',
          modelId: settings.tabModel,
          budgetUsd: settings.tabDailyBudgetUsd,
        })
      },
    },
  })
  tabDisposables.push({
    dispose: () => {
      tab.dispose()
    },
  })
  // Tab on at startup (the default): the provider is registered now, and
  // the secret read and dist/tab.js wait for the first request (RVM94HU 7).
  tab.refresh()
  for (const disposable of tabDisposables) {
    context.subscriptions.push(disposable)
  }
  // Voice dictation (M9): the OS recogniser behind the composer's microphone.
  const dictation = createDictationSetup(
    {
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      helperDir: path.join(context.extensionPath, DICTATION_HELPER_DIR),
    },
    log,
    voice,
  )
  const backend = new MuseCodeBackendManager({
    shellJobAssembly: () => windowsJobAssembly?.() ?? Promise.resolve(undefined),
    beforeWorkspaceHostStart: async () => {
      await checkpoints.markNativeBackend()
    },
    // The watchdog (CLI recovery): a Muse Code that answers nothing is
    // restarted, at once when no turn runs on it, else when the user says
    // with the Restart of the notice its panel shows.
    unresponsive: {
      isTurnRunning: () => {
        for (const controller of controllers.values()) {
          if (controller.isTurnRunningOn('museCode')) {
            return true
          }
        }
        return false
      },
      restart: () => restartBackend('Muse Code stopped answering', false, true),
      sayRestarted: () => {
        for (const controller of controllers.values()) {
          controller.museCodeStoppedAnswering(true)
        }
      },
      offerRestart: () => {
        for (const controller of controllers.values()) {
          controller.museCodeStoppedAnswering(false)
        }
      },
    },
    log,
    extensionVersion: version,
    getConfiguredBinaryPath: () => currentSettings().museBinaryPath,
    getEnvironmentVariables: () => currentSettings().environmentVariables,
    workspaceRoot,
    getShellSandbox: () => currentSettings().shellSandbox,
    getSandboxNetwork: () => currentSettings().sandboxNetwork,
    userProfileDir: process.env['USERPROFILE'],
    isWorkspaceTrusted: isProjectTrusted,
    getProxySettings: () =>
      readProxySettings(vscode.workspace.getConfiguration(HTTP_SETTINGS_SECTION)),
  })
  // The sandbox-off warning (musecode-write-asks): once per window, in the
  // first Muse Code conversation that starts on a host without the sandbox.
  let hasShownSandboxOffNotice = false
  const shouldWarnSandboxOff = (): boolean => {
    const isFirst = !hasShownSandboxOffNotice
    hasShownSandboxOffNotice = true
    return isFirst
  }
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
   * Stops both hosts (PLAN.md D25), or Muse Code alone for fault recovery.
   * The affected conversations hear it first: a
   * running turn is cancelled, and unless they end (sign-out, shutdown) the
   * next message resumes the same session on the new host.
   */
  const restartBackend = async (
    reason: string,
    isConversationEnding = false,
    isMuseCodeOnly = false,
  ): Promise<void> => {
    log.info(`Restarting ${isMuseCodeOnly ? 'Muse Code' : 'the backends'}: ${reason}`)
    await restartConversationBackends(
      controllers.values(),
      backend,
      modelApi,
      isConversationEnding,
      isMuseCodeOnly,
    )
  }
  /**
   * Muse Code alone, afresh (CLI recovery): a notice's Restart (a fault's,
   * the watchdog's) and "Muse Spark: Restart Muse Code". A running turn is
   * stopped; the new host starts at once, and each conversation resumes
   * with its next message.
   */
  const restartMuseCode = async (reason: string): Promise<void> => {
    await restartBackend(reason, false, true)
    for (const controller of controllers.values()) {
      controller.warmUp()
    }
  }
  /**
   * The CLI in a terminal (`muse logout`, `muse mcp login`, Open in
   * Terminal), with `museSpark.environmentVariables` as `muse serve` gets
   * them, so it reads the same config home (the review of PR #49).
   */
  const runCliInTerminal = async (
    cliPath: string,
    args: readonly string[],
    options: TerminalLaunchOptions,
  ): Promise<void> => {
    await backend.startWorkspaceCommand(() => {
      runInTerminal(
        cliPath,
        args,
        options,
        terminalEnvironment(currentSettings().environmentVariables, process.platform),
      )
    }, nativeStarts.signal)
  }
  // Tool outputs open as read-only documents (M15), the tab named through the
  // URI path as Claude Code names its own ("PowerShell tool output (a1b2c3)");
  // the last OUTPUT_DOCUMENTS_KEPT stay readable after their tab is reopened.
  // An export's preview (M84) and the import preview (M83) open the same way:
  // read-only, never on disk.
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

  // Skills, imports and export (M30): the CLI by absolute path, in the
  // environment `muse serve` gets, from the workspace root.
  const cliFeatures = createCliFeatures({
    editFile: async (fsPath, work) =>
      await withCheckpointEditAt(
        checkpoints,
        log,
        backend.workspaceActionGuard(nativeStarts.signal),
        {
          root: checkpointRoot?.canonicalRoot ?? workspaceRoot,
          displayRoot: workspaceRoot,
          platform: process.platform,
        },
        fsPath,
        work,
      ),
    // Import from other agents (M83): its project writes hold the checkpoint
    // lease and storage guard under the window's guard for this root,
    // and count for the session that was live when the import began.
    agentImport: {
      isActive: () => !nativeStarts.signal.aborted,
      isProjectTrusted,
      isProjectHeld: () => windowHold.isHeld,
      currentRoot: firstFolderPath,
      captureOwner: () => {
        const active = registry.active
        return active === undefined
          ? undefined
          : controllers
              .get(active.id)
              ?.captureExternalEditOwner((session) => modelApi.captureExternalEditOwner(session))
      },
      beginEdit: (file, owner) => modelApi.beginExternalEdit(owner, [file]),
      editProject: async (work) => {
        const check = backend.workspaceActionGuard(nativeStarts.signal, workspaceRoot)
        return await withCheckpointEdit(checkpoints, log, check, async () => await work(check))
      },
      beforeProjectWrite: (absolutePath) => {
        checkpoints.refuseStorageWrite(absolutePath)
      },
      bundle: agentImportLoader({
        bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', AGENT_IMPORT_BUNDLE_FILE)
          .fsPath,
        log,
      }),
    },
    runCli: (args, timeoutMs) => {
      const resolution = backend.resolveLaunch()
      return resolution.ok
        ? backend.startWorkspaceCommand(
            () =>
              runProcess(
                { command: resolution.launch.command, args },
                timeoutMs,
                workspaceRoot,
                backend.childEnvironment(),
                nativeStarts.signal,
                backend.workspaceActionGuard(nativeStarts.signal),
              ),
            nativeStarts.signal,
          )
        : undefined
    },
    // `muse mcp login|logout` (M31): the CLI's own launcher in a terminal,
    // where its browser sign-in and prompts are seen.
    runCliInTerminal: async (args, terminalName) => {
      const resolution = backend.resolveLaunch()
      if (!resolution.ok) {
        return false
      }
      await runCliInTerminal(resolution.launch.cliPath, args, {
        name: terminalName,
        cwd: workspaceRoot,
      })
      return true
    },
    museSettingsPath: () => museSettingsPath(museConfig()),
    workspaceRoot,
    openPreview: openDocument,
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
    isProjectTrusted,
    isProjectHeld: () => windowHold.isHeld,
    openDocument,
    log,
  })
  const conversationGit = conversationGitLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', CONVERSATION_GIT_BUNDLE_FILE)
      .fsPath,
    log,
  })
  const worktrees = createWorktreeFeatures({
    isWorkspaceTrusted: isProjectTrusted,
    workspaceRoot,
    runGit: (args, cwd, timeoutMs, beforeRun) => runGit(args, cwd, timeoutMs, undefined, beforeRun),
    mutationGit: (args, cwd, timeoutMs, beforeRun) =>
      backend.startWorktreeMutation(
        cwd,
        (ownedCwd) => runGit(args, ownedCwd, timeoutMs, undefined, beforeRun),
        nativeStarts.signal,
      ),
    registry: worktreeRegistry,
    log,
  })
  const sandbox = new SandboxSetup({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    resolveLaunch: () => backend.resolveLaunch(),
    run: async (invocation, timeoutMs) =>
      await backend.startWorkspaceCommand(
        async () =>
          await runProcess(
            invocation,
            timeoutMs,
            undefined,
            undefined,
            nativeStarts.signal,
            backend.workspaceActionGuard(nativeStarts.signal),
          ),
        nativeStarts.signal,
      ),
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
    getPlanAccount: async () =>
      subscriptions === undefined &&
      (await context.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) === undefined
        ? undefined
        : await subscriptionFeatures().planAccount(),
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
    runInTerminal: async (cliPath, args) => {
      await runCliInTerminal(cliPath, args, {
        name: UI_TEXT.museLoginTerminalName,
        cwd: undefined,
      })
    },
    installCommand:
      process.platform === 'win32' ? MUSE_INSTALL_COMMANDS.win32 : MUSE_INSTALL_COMMANDS.posix,
    runInstallerInTerminal: async () => {
      await backend.startWorkspaceCommand(() => {
        const isWindows = process.platform === 'win32'
        const systemRoot = process.env['SystemRoot']
        let shellPath: string | undefined = POSIX_TERMINAL_SHELL
        if (isWindows) {
          shellPath =
            systemRoot === undefined
              ? undefined
              : `${systemRoot}${WINDOWS_POWERSHELL_TERMINAL_PATH}`
        }
        const terminal = vscode.window.createTerminal({
          name: UI_TEXT.installStartAction,
          ...(shellPath !== undefined && { shellPath }),
        })
        terminal.show(true)
        terminal.sendText(isWindows ? MUSE_INSTALL_COMMANDS.win32 : MUSE_INSTALL_COMMANDS.posix)
      }, nativeStarts.signal)
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
      paidBackend = message.backend
      broadcastPaidState()
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
    try {
      nativeStarts.abort()
      accountHosts.close()
      await promptHost?.dispose()
      await auth.stopSignIn()
      await restartBackend('the window is closing', true)
    } finally {
      await usageRecording.flush()
    }
  }

  const editorContext = new EditorContextTracker({
    broadcast: (summary) => {
      registry.broadcast({ type: 'editorContext', context: summary })
    },
  })
  const listWorkspaceFiles = createWorkspaceFileLister({
    workspaceRoot: workspaceRoot ?? '',
    respectGitIgnore: () => currentSettings().respectGitIgnore,
    isWorkspaceTrusted: isProjectTrusted,
    runGit,
    findFiles: findWorkspaceFiles,
    log,
  })
  // Best-of-N's git, admitted at the native entry by the same project trust
  // as the rest: none while someone else's pull request holds the window (M71).
  const runBestOfNGit: typeof automaticBestOfNGit = (args, cwd, timeoutMs, input, beforeRun) =>
    automaticBestOfNGit(
      args,
      cwd,
      timeoutMs,
      input,
      Object.assign(
        () => {
          if (!isProjectTrusted()) {
            throw new Error(
              windowHold.isHeld ? UI_TEXT.worktreeHeldShell : UI_TEXT.bestOfNNeedsTrust,
            )
          }
          beforeRun?.()
        },
        { prepare: beforeRun?.prepare },
      ),
    )
  // The C# of both Windows job helpers, shipped beside the bundle (PLAN.md D6).
  const readJobSource = jobSourceReader(context.extensionPath)
  const windowsJobAssembly = windowsJobHelper(shellJobAssembly, storageRoot, readJobSource, log)
  const windowsMcpJob = windowsJobHelper(mcpJobExecutable, storageRoot, readJobSource, log)
  // Amp and OpenCode plugin children (M91b): on Windows, M50's kill-on-close
  // job launcher, prepared afresh after a failure.
  const pluginJobs = pluginContainment({
    shellJobAssembly: windowsJobAssembly,
    platform: process.platform,
    newJobExecutable: () => windowsJobHelper(mcpJobExecutable, storageRoot, readJobSource, log),
    now: () => Date.now(),
    log: (message) => {
      log.warn(message)
    },
  })
  const shellEnvironmentOf = (): NodeJS.ProcessEnv =>
    withTerminalOverrides(
      process.env,
      vscode.workspace
        .getConfiguration(TERMINAL_ENV_SECTION)
        .get<Record<string, string | null>>(TERMINAL_ENV_KEYS[terminalPlatform()]) ?? {},
      process.platform,
      workspaceRoot,
    )
  // The workspace's files and a shell (M7): the Model API backend's tools,
  // and the files the ide server's image tools read and write (M44).
  const toolIo = createToolIo({
    platform: process.platform,
    listFiles: listWorkspaceFiles,
    systemRoot: process.env['SystemRoot'],
    // The user's terminal environment settings apply to the shell tool as
    // they do to VS Code's terminal (PLAN.md D25).
    env: shellEnvironmentOf,
    passEnvironmentVariables: () => currentSettings()['shell.passEnvironmentVariables'],
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
  // The window's tool io: no tool writes the checkpoint storage, and every
  // command is workspace activity. It records nothing: each Model API turn
  // writes through its own io, made over this one (M86, below).
  const checkpointedIo = withCheckpointStorageGuard(toolIo, checkpoints)
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
  const requestPacingOwner = {}
  const keyClient = modelApiClientLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', MODEL_API_BUNDLE_FILE).fsPath,
    log,
    client: {
      pacingOwner: requestPacingOwner,
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
    },
  })
  const ideTools = [diagnostics]
  // Web fetch (M69, PLAN.md D49): resolved, checked and pinned here, for the
  // Model API backend's `web_fetch` and Muse Code's `mcp__ide__webFetch`.
  // The fetch is dist/webFetch.js (D6), required on the first use; HTML is
  // converted on a worker of its own bundle, started for each page.
  const webFetchBundle = webFetchLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', WEB_FETCH_BUNDLE_FILE).fsPath,
    log,
  })
  const webFetch = lazyWebFetcher(
    webFetchBundle,
    log,
    pageConverter(vscode.Uri.joinPath(context.extensionUri, 'dist', PAGE_WORKER_FILE).fsPath, log),
  )
  const askWebFetch = oneQuestionPerUrl(isWebFetchAllowed)
  // The browser check (M81 A1, PLAN.md D49): the Model API backend's
  // `browser_check` and Muse Code's `mcp__ide__browserCheck`, on the pinned
  // headless shell the runtime bundle downloads after the user's consent
  // and verifies, run in the check's own bundle; both bundles load on first
  // use, and every check under way ends with the window. The widened hosts
  // and the runtime setting are the user's machine-scoped settings, read at
  // each use; a change to either, or to trust, is read by checks under way.
  const browserStorage = context.globalStorageUri.fsPath
  const browserChecks = new BrowserChecks({
    checkBundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', BROWSER_CHECK_BUNDLE_FILE)
      .fsPath,
    runtimeBundlePath: vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      BROWSER_RUNTIME_BUNDLE_FILE,
    ).fsPath,
    storageDir: browserStorage,
    log,
    runtimeMode: () => currentSettings().browserCheckRuntime,
    askConsent: runtimeConsent(browserStorage),
    onAdmissionChange: (listener) => {
      const subscriptions = [
        vscode.workspace.onDidChangeConfiguration(listener),
        vscode.workspace.onDidGrantWorkspaceTrust(listener),
      ]
      return () => {
        for (const subscription of subscriptions) {
          subscription.dispose()
        }
      }
    },
  })
  context.subscriptions.push(browserChecks)
  const browserCheck: BrowserCheckHost = {
    check: browserChecks.check,
    extraHosts: () => currentSettings().browserCheckExtraHosts,
    isOffered: () => browserChecks.isOffered(),
  }
  const isIdeBrowserCheckOffered = (): boolean =>
    browserChecks.isOffered() &&
    isIdeWebFetchOffered(vscode.workspace.isTrusted, currentSettings().sandboxNetwork)
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.downloadBrowserCheckRuntime, async () => {
      await downloadBrowserRuntime(browserChecks, isIdeBrowserCheckOffered)
    }),
  )
  const askBrowserCheck = oneQuestionPerUrl(isBrowserCheckAllowed, browserScopeKey)
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
  // Their answers are dist/codeIntel.js (D6), required on the first call.
  const codeIntelBundle = codeIntelLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', CODE_INTEL_BUNDLE_FILE).fsPath,
    log,
  })
  // The deterministic legal scan (M97, PLAN.md D76): dist/legalScan.js (D6),
  // required on the first scan; the tool list stays at activation.
  const paidLegalExplanation = legalExplanationLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', LEGAL_EXPLANATION_BUNDLE_FILE)
      .fsPath,
    log,
  })
  const legalScanBundle = legalScanLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', LEGAL_SCAN_BUNDLE_FILE).fsPath,
    log,
  })
  const runLegalScan: LegalScanRunner = async (input, signal) => {
    if (!vscode.workspace.isTrusted) throw new Error(UI_TEXT.legalScanUntrusted)
    if (workspaceRoot === undefined) throw new Error(UI_TEXT.noWorkspaceReason)
    const handle = await legalScanBundle().runLegalScan({
      workspaceRoot,
      input: { ...input, headerPolicy: input.headerPolicy ?? currentSettings().legalHeaderPolicy },
      signal,
    })
    const enrich = legalScanBundle().enrichInteractiveLegalScan
    if (enrich === undefined) throw new Error(UI_TEXT.legalScanUnavailable)
    return legalScanResultSchema.parse(
      await enrich(handle, {
        isOn: () => currentSettings().legalRegistryLookups && vscode.workspace.isTrusted,
        isNoticed: (host) =>
          context.workspaceState.get<boolean>(`${LEGAL_REGISTRY_NOTICE_KEY}:${host}`) === true,
        notice: async (hosts) => {
          const accept = UI_TEXT.allowOnce
          const answer = await vscode.window.showInformationMessage(
            fillLegalNotice(UI_TEXT.legalRegistryNotice, { hosts: hosts.join(', ') }),
            { modal: true },
            accept,
          )
          return answer === accept
        },
        markNoticed: async (hosts) => {
          for (const host of hosts)
            await context.workspaceState.update(`${LEGAL_REGISTRY_NOTICE_KEY}:${host}`, true)
        },
        fetch: liveFetch,
        signal,
      }),
    )
  }
  const ideServer = new IdeMcpServer(
    () => [
      diagnostics,
      ...ideCodeIntelTools(codeIntel, codeIntelBundle),
      // Read-only and trust-gated, like the code intelligence tools: listed
      // only in a trusted workspace, refused while it is not.
      ...ideLegalScanTools({
        isOffered: () =>
          workspaceRoot !== undefined && isIdeLegalScanOffered(vscode.workspace.isTrusted),
        runScan: runLegalScan,
        log,
      }),
      // The server is attached in Restricted Mode too, and has no session
      // identity: the tool is listed only in a trusted workspace whose
      // sandbox network setting allows the network, and every call asks.
      ...ideWebFetchTools({
        isOffered: () => isIdeWebFetchOffered(isProjectTrusted(), currentSettings().sandboxNetwork),
        checkUrl: lazyPageUrlCheck(webFetchBundle),
        fetchPage: webFetch,
        confirm: askWebFetch,
        log,
      }),
      // The same rule for the browser check, text only for Muse Code (M81),
      // and none while its runtime setting is off.
      ...ideBrowserCheckTools({
        isOffered: isIdeBrowserCheckOffered,
        extraHosts: browserCheck.extraHosts,
        confirm: askBrowserCheck,
        check: browserCheck.check,
        log,
      }),
      ...ideImageTools({
        isOffered: () => isKeyStored && paid.gate.isOn('imageGeneration'),
        keyGeneration: () => auth.admissionGeneration,
        // Muse Code's images are never recorded (M86): the window's io, not a turn's.
        workspace:
          workspaceRoot === undefined
            ? undefined
            : { workspaceRoot, platform: process.platform, io: checkpointedIo },
        client: keyClient,
        confirm: async (plan) => (await paid.consent.allows(imageUseRequest(plan))) === true,
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

  /** A file the extension writes in the user's name, under the lease; never recorded (M86). */
  const writeUserFile = async (check: () => void, fsPath: string, content: string) => {
    await withCheckpointEdit(checkpoints, log, check, async () => {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(fsPath),
        new TextEncoder().encode(content),
      )
    })
  }

  // Edit review (M5) and `/review` (M70: git's changes in the workspace folder,
  // with the pickers for a base branch or a commit the request did not name,
  // the review turn's text and the pane's hunks) come from the review's own
  // bundle, loaded the first time one of them is used.
  const review = lazyReview({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', REVIEW_BUNDLE_FILE).fsPath,
    log,
    workspaceRoot,
    runGit,
    pickOne: showPickOne,
    editReview: {
      platform: process.platform,
      workspaceRoot,
      readFile: readTextFile,
      realPath: canonicalPath,
      hasUnsavedChanges: (fsPath) => toolIo.hasUnsavedChanges(fsPath),
      beginEdit: (file) => modelApi.beginExternalEdit(undefined, [file]),
      // A Revert the user pressed is one operation under the restore lease
      // (M72): read, rebuilt, checked and published there, by the guarded
      // conditional writes, so a save or a swap meanwhile refuses it. A
      // change that lands is the user's and never recorded (M86).
      withAdmission: async (work) => {
        const check = backend.workspaceActionGuard(nativeStarts.signal)
        return await withCheckpointEdit(checkpoints, log, check, async () => await work(check))
      },
      io: createRevertIo({
        io: toolIo,
        platform: process.platform,
        trash: async (fsPath) => {
          await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true })
        },
      }),
      openDiff: async (beforeUri, fsPath, title) => {
        await vscode.commands.executeCommand(
          VSCODE_COMMANDS.diff,
          vscode.Uri.parse(beforeUri),
          vscode.Uri.file(fsPath),
          title,
        )
      },
      log,
    },
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
  // The managed personal agent root (M76, PLAN.md D13): the extension's own
  // folder, since the CLI names none.
  const agentsHome = personalAgentsRoot(museConfig())
  // The bundled skills (M89, PLAN.md D68): the package vendored inside this
  // extension, a skill source on the Model API backend while its setting is
  // on, and installed for Muse Code only by the commands or the panel's
  // one-time offer, through the installer's own bundle.
  const bundledPackageRoot = bundledSkillsPackageRoot(context.extensionPath, process.platform)
  const bundledSkillsBundle = bundledSkillsLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', BUNDLED_SKILLS_BUNDLE_FILE)
      .fsPath,
    log,
  })
  const bundledSkillsPaths = () => ({
    vendorRoot: bundledPackageRoot,
    skillsRoot: personalSkillsRoot(museConfig()),
    sourcesRoot: bundledSkillSourcesRoot(museConfig()),
    // The extension's own skills (M97, PLAN.md D76): installed beside the
    // vendored package through the same mechanism, without touching it.
    extensionSkillsRoot: vscode.Uri.joinPath(context.extensionUri, EXTENSION_SKILLS_DIR).fsPath,
  })
  const bundledSkillsOffer = createBundledSkillsOffer({
    isEnabled: () => currentSettings().bundledSkills,
    state: context.globalState,
    keys: {
      installDeclined: GLOBAL_STATE_KEYS.bundledSkillsInstallDeclined,
      updateDeclined: GLOBAL_STATE_KEYS.bundledSkillsUpdateDeclined,
    },
    status: () => bundledSkillsBundle().bundledSkillsStatus(bundledSkillsPaths()),
  })
  const bundledSkillsCommand = (): BundledSkillsCommandDeps => ({
    bundle: bundledSkillsBundle,
    paths: bundledSkillsPaths,
    platform: process.platform,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message)
    },
    showError: loggedPopups(log).showError,
    isMuseCodeRunning: () => backend.isRunning,
    confirmRestart: async () =>
      (await vscode.window.showInformationMessage(
        UI_TEXT.skillsRestartPrompt,
        UI_TEXT.restartNow,
        UI_TEXT.restartLater,
      )) === UI_TEXT.restartNow,
    restart: () => restartMuseCode('the bundled skills changed'),
    log,
  })
  // What's New after an update (M99, PLAN.md D79): decided at the end of
  // activation, shown once the window is quiet (no turn running, no edit for
  // a moment), its page from its own bundle. The last edit's time tells quiet.
  let lastEditAt = -Infinity
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0 && event.document.uri.scheme !== OUTPUT_CHANNEL_SCHEME) {
        lastEditAt = performance.now()
      }
    }),
  )
  const whatsNew = createWhatsNew({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', WHATS_NEW_BUNDLE_FILE).fsPath,
    pages: {
      extensionUri: context.extensionUri,
      contentPath: vscode.Uri.joinPath(context.extensionUri, 'dist', WHATS_NEW_CONTENT_FILE).fsPath,
      current: version,
      isShownOnUpdate: () => currentSettings().showWhatsNewOnUpdate,
      setShownOnUpdate: (isShown) => updateSetting('showWhatsNewOnUpdate', isShown),
    },
    log,
    state: context.globalState,
    lastSeenKey: GLOBAL_STATE_KEYS.whatsNewLastSeenVersion,
    current: version,
    hasEarlierUse,
    isEnabled: () => currentSettings().showWhatsNewOnUpdate,
    disable: () => updateSetting('showWhatsNewOnUpdate', false),
    claim: (claimed) =>
      hasClaimedVersion(
        path.join(context.globalStorageUri.fsPath, WHATS_NEW_CLAIMS_DIR),
        claimed,
        log,
      ),
    // A loop, not Iterator#some: the extension host's floor is Node 20.
    isBusy: () => {
      for (const controller of controllers.values()) {
        if (BACKEND_KINDS.some((kind) => controller.isTurnRunningOn(kind))) {
          return true
        }
      }
      return false
    },
    msSinceLastEdit: () => performance.now() - lastEditAt,
    notify: (message, ...actions) => vscode.window.showInformationMessage(message, ...actions),
  })
  context.subscriptions.push({
    dispose: () => {
      whatsNew.dispose()
    },
  })
  // Muse Code's memory (M49, PLAN.md D41): one store for the window, which
  // the Model API's memory tools and the Memory view both use, in the data
  // home `muse serve` sees (`museSpark.environmentVariables` included). The
  // model's writes are its turn's, recorded (M86); the view's edits hold the
  // restore lease (M72) and are never recorded.
  const memory = createCheckpointedMemory(toolIo, checkpoints, {
    captureGuard: () => backend.workspaceActionGuard(nativeStarts.signal),
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
  const memoryView = createMemoryFeatures({
    store: memory.viewStore,
    log,
    edit: memory.edit,
  })
  // The model's own writes, recorded per turn for a restore (M86, PLAN.md
  // D63): one io for each turn over the window's, into this window's
  // journal, in the order and under the locks the store's restores share.
  const turnRecorder =
    checkpointRoot === undefined || writeRecording === undefined
      ? undefined
      : writeRecording.recorder({
          io: checkpointedIo,
          memory: memory.turnWrites,
          workspaceRoot: checkpointRoot.canonicalRoot,
          canonicalPath,
          newId: () => crypto.randomUUID(),
          log,
        })
  // Contributor-tier models let Meta train on the traffic: one explicit yes
  // before the model is used, for the user's own choice and for a custom
  // agent's (M76, PLAN.md §9).
  const isContributorModelAllowed = async (modelId: string): Promise<boolean> =>
    (await vscode.window.showWarningMessage(
      `${UI_TEXT.contributorTitle} ${modelId}: ${UI_TEXT.contributorDetail}`,
      { modal: true },
      UI_TEXT.contributorConfirm,
    )) === UI_TEXT.contributorConfirm
  // Plans as files (M79): `.agents/plans/` of the workspace folder, when there is one.
  const plans =
    workspaceRoot === undefined
      ? undefined
      : createPlanFiles({
          workspaceRoot,
          platform: process.platform,
          io: createPlanIo({
            log,
            now: () => Date.now(),
            edit: async (work) => {
              const check = backend.workspaceActionGuard(nativeStarts.signal, workspaceRoot)
              await withCheckpointEdit(checkpoints, log, check, async () => {
                await work(check)
              })
            },
          }),
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
    onServiceFailure: () => {
      notify(
        Array.from(controllers.values(), (controller) => () => {
          controller.modelApiServiceFailed()
        }),
        undefined,
        log,
        'modelApi.serviceFailure',
      )
    },
    judge,
    createProviderClient: async (meta) =>
      subscriptions === undefined &&
      !existsSync(providerConfigFile) &&
      (await context.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) === undefined
        ? meta
        : await subscriptionFeatures().createClient(meta),
    getProviderAccountId: () => subscriptionFeatures().accountId(),
    log,
    // Each Model API turn's unit (M86): its record before it runs, its own
    // recorded writes while it does, then its writes drained, its unit folded
    // and sealed, and its running mark withdrawn.
    beforeTurnRuns: (sessionId, turnId, top) =>
      prepareCheckpointTurn(checkpoints, turnRecorder, sessionId, turnId, log, top),
    afterTurnRuns: (sessionId, turnId, end) =>
      finishCheckpointTurn(checkpoints, turnRecorder, sessionId, turnId, end),
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    io: checkpointedIo,
    listAttemptFiles: (attemptRoot) =>
      createWorkspaceFileLister({
        workspaceRoot: attemptRoot,
        respectGitIgnore: () => currentSettings().respectGitIgnore,
        isWorkspaceTrusted: isProjectTrusted,
        runGit: runBestOfNGit,
        findFiles: () =>
          findRootFiles({
            search: () =>
              vscode.workspace.findFiles(
                new vscode.RelativePattern(attemptRoot, FIND_FILES_GLOB),
                undefined,
                MENTION_INDEX_LIMIT,
              ),
            relativePath: (uri) => {
              const resolved = resolveWorkspacePath(attemptRoot, uri.fsPath, process.platform)
              return resolved.ok ? resolved.relative : undefined
            },
          }),
        log,
      })(),
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
    bundledSkills: {
      packageRoot: bundledPackageRoot,
      firstPartyRoot: firstPartySkillsRoot(context.extensionPath, process.platform),
      isEnabled: () => currentSettings().bundledSkills,
    },
    personalAgentsRoot: agentsHome,
    isWorkspaceTrusted: isProjectTrusted,
    isConfidentialWorkspace: () => currentSettings().confidentialWorkspace,
    confirmContributorModel: isContributorModelAllowed,
    hookSettingsPath: museSettingsPath(museConfig()),
    isHooksEnabled: () => currentSettings().modelApiHooks,
    hookHttpAllowedHosts: () => currentSettings().hookHttpAllowedHosts,
    isHookNetworkAllowed: () =>
      isIdeWebFetchOffered(vscode.workspace.isTrusted, currentSettings().sandboxNetwork),
    // Plugin children get the hook environment (M51) and their tree (M91b).
    pluginHooks: {
      env: () => hookEnvironment(shellEnvironmentOf(), process.platform),
      containment: pluginJobs.containment,
    },
    // Sessions survive the window (PLAN.md D14) in the workspace storage
    // directory; no folder open, no storage, no persistence.
    store:
      context.storageUri === undefined
        ? undefined
        : createFileSessionStore({
            directory: path.join(context.storageUri.fsPath, MODEL_API_SESSIONS_DIR),
            questions: questionsStore,
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
    describeEnvironment: () => {
      const check = backend.workspaceActionGuard(nativeStarts.signal, workspaceRoot)
      return describeEnvironment({
        runGit: async (args, cwd) => {
          const owned = () => {
            check()
            if (
              workspaceRoot === undefined ||
              !isProjectTrusted() ||
              !isSamePath(cwd, workspaceRoot, process.platform)
            ) {
              throw new Error(UI_TEXT.checkpointFailed)
            }
          }
          return await withCheckpointEdit(
            checkpoints,
            log,
            owned,
            async () => await runGit(args, cwd, undefined, undefined, owned),
          )
        },
        workspaceRoot,
        // The git facts carry commit subjects: none from someone else's pull request (M71).
        isWorkspaceTrusted: isProjectTrusted,
        log,
        now: Date.now,
      })
    },
    // An attempt's own branch and change counts, read in its worktree (M77).
    describeAttemptEnvironment: (attemptRoot) =>
      describeEnvironment({
        runGit: runBestOfNGit,
        workspaceRoot: attemptRoot,
        isWorkspaceTrusted: isProjectTrusted,
        log,
        now: Date.now,
      }),
    isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
    notePaidUse: (feature, units, searchPriceUsd) => {
      paid.usage.add(feature, units, searchPriceUsd)
    },
    promptCacheRetention: () => currentSettings().modelApiPromptCacheRetention,
    // The session budget cap and the per-reply usage line (M82), read per
    // request and per reply so a changed setting applies at once.
    sessionBudgetUsd: () => currentSettings().modelApiSessionBudgetUsd,
    paidAuthority: paid.consent.authority,
    reservePaidRequest: async (body, feature, estimatedInputTokens, signal, reservationUsd) => {
      if (reservationUsd === undefined) {
        return await dailyPaid.reserve(body, feature, estimatedInputTokens, signal)
      }
      signal?.throwIfAborted()
      const claim = await dailyPaid.reserveExact(reservationUsd)
      try {
        signal?.throwIfAborted()
        return {
          ...claim,
          check: () => {
            signal?.throwIfAborted()
            claim.check()
          },
        }
      } catch (error: unknown) {
        await claim.settle(Usd.from(0).toAmount())
        throw error
      }
    },
    showReplyUsage: () => currentSettings().modelApiReplyUsage,
    // Muse Code's MCP servers, run by this window for the Model API backend
    // (M50, PLAN.md D42): started in a trusted workspace only, stopped with
    // the host.
    createMcpServers: async (root, newPool) =>
      newPool(
        modelApiMcpPoolDeps({
          beforeWorkspaceProcessStart: () => checkpoints.markNativeBackend(),
          workspaceRoot: root,
          settingsPath: () => museSettingsPath(museConfig()),
          isWorkspaceTrusted: isProjectTrusted,
          clientVersion: version,
          platform: process.platform,
          jobExecutablePath: await windowsMcpJob?.(),
          shellJobAssembly: windowsJobAssembly,
          env: () => process.env,
          fetch: globalThis.fetch.bind(globalThis),
          log,
        }),
      ),
    legalScan: workspaceRoot === undefined ? undefined : runLegalScan,
    ideTools,
    webFetch,
    browserCheck,
    codeIntel: languageServices,
    isRepoMapInPrompt: () => currentSettings().modelApiRepoMap,
    isObservationPackingOn: () => currentSettings().modelApiObservationPacking,
    pacingOwner: requestPacingOwner,
    isAutoCompactionOn: () => currentSettings().modelApiAutoCompaction,
    strictTools: () => currentSettings().modelApiStrictTools,
    parallelReads: () => currentSettings().modelApiParallelReads,
    webSearchMaxPerRequest: () => currentSettings().webSearchMaxPerRequest,
    isShellKeepsDirectoryOn: () => currentSettings().modelApiShellKeepsDirectory,
    allowsPaidUse: async (request, requiresAsking) =>
      await paid.consent.allows(request, requiresAsking),
    isPaidUseRemembered: (feature) => paid.consent.isRemembered(feature),
    noteSubagentUsage: (modelId, usage) => {
      paid.usage.addSubagentUsage(modelId, usage)
    },
    noteReviewerUsage: (modelId, usage) => {
      paid.usage.addReviewerUsage(modelId, usage)
    },
    // M91 prompt/agent hook runs (D70): settled on the hookModels tally line.
    noteHookModelUsage: (modelId, usage) => {
      paid.usage.addHookModelUsage(modelId, usage)
    },
    // The command rules and permission profiles (M78), read at each call.
    permissionSettings: () => permissionSettingsOf(currentSettings()),
    memory: memory.store,
    // The settings are read at each use; a repository cannot set them (D15).
    verify: {
      isDiagnosticsOn: () => currentSettings().diagnosticsAfterEdits,
      checkCommands: () => currentSettings().checkCommands,
      isFormatOnEdit: () => currentSettings().formatOnEdit,
      diagnosticsAfterEdit: (files, signal, canReadFile) =>
        verifyEditor.diagnosticsAfterEdit(files, signal, canReadFile),
      formatAfterEdit: (absolutePath, text) => verifyEditor.formatAfterEdit(absolutePath, text),
    },
    createAttemptVerify: (attemptRoot) => {
      const editor = createVerifyEditor({
        platform: process.platform,
        log,
        workspaceRoot: attemptRoot,
        realPath: canonicalPath,
      })
      return {
        isDiagnosticsOn: () => currentSettings().diagnosticsAfterEdits,
        checkCommands: () => currentSettings().checkCommands,
        isFormatOnEdit: () => currentSettings().formatOnEdit,
        diagnosticsAfterEdit: (files, signal, canReadFile) =>
          editor.diagnosticsAfterEdit(files, signal, canReadFile),
        formatAfterEdit: (absolutePath, text) => editor.formatAfterEdit(absolutePath, text),
        dispose: () => {
          editor.dispose()
        },
      }
    },
    // Its own bundle, loaded when this backend first starts (M57, PLAN.md D6).
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', MODEL_API_BUNDLE_FILE).fsPath,
  })
  // Git and pull requests (M71): VS Code's git extension and GitHub sign-in,
  // made in the conversation Git bundle with the first conversation or the
  // first pull request command (PLAN.md D6), from these primitives.
  // The selected folder as given, not its canonical form: an own pull request's worktree
  // sits beside it and its record names it (the owner capture resolves links itself).
  const gitFeatures = gitFeaturesLoader(conversationGit, {
    workspaceRoot,
    storageRoot,
    hold: windowHold,
    registry: worktreeRegistry,
    workspaceState: context.workspaceState,
    fetch: liveFetch,
    userAgent: `${EXTENSION_NAME}/${version}`,
    runGit,
    // Someone else's pull request: no git checkout; the extension writes its files (M71).
    gitProcess: processGitProcess(),
    env: process.env,
    isCurrent: () => !nativeStarts.signal.aborted,
    // Commit and push run hooks, which can write the workspace: admitted as any such command is (M72).
    admit: (start) => backend.startWorkspaceCommand(start, nativeStarts.signal),
    restartBackends: (reason) => restartBackend(reason),
    holdReleased: () => {
      for (const controller of controllers.values()) {
        controller.worktreeHoldReleased()
      }
    },
    log,
  })
  // The pull request command's refusal when its bundle cannot load.
  const gitPopups = loggedPopups(log)
  const watchedHosts = new WeakSet<AgentHost>()
  let chosenBackend: BackendKind | undefined
  // `Report a Problem` with no conversation open (M93): the dialog opens
  // once the surface it opened is ready to show it.
  let isReportPending = false
  let isHelpPending = false
  const referenceBundle = referenceLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', REFERENCE_BUNDLE_FILE).fsPath,
    log,
  })
  // The report dialog's facts, journal and scrub context (M93, PLAN.md D72):
  // Local facts plus an optional unauthenticated public status read. The CLI's
  // sign-in comes from its credential file's
  // structure (no `account/read`), the key's presence from the secret store.
  const reportSource: ReportDataSource = {
    readFacts: async () => {
      const settings = currentSettings()
      const resolution = backend.resolveLaunch()
      const configuration = vscode.workspace.getConfiguration()
      let serviceStatus
      if (settings.backend === 'modelApi') {
        try {
          serviceStatus = await keyClient().readServiceStatus(
            AbortSignal.timeout(MODEL_API_STATUS_READ_TIMEOUT_MS),
          )
        } catch {
          // An optional public status read cannot prevent the local report.
        }
      }
      return extensionReportFacts({
        ...(serviceStatus !== undefined && { serviceStatus }),
        extensionVersion: version,
        vscodeVersion: vscode.version,
        nodeVersion: process.versions.node,
        platform: process.platform,
        backend: settings.backend,
        sandbox: settings.shellSandbox,
        cli: resolution.ok
          ? { isFound: true, version: backend.installedVersion(resolution.launch.installDir) }
          : { isFound: false, version: undefined },
        credentialFileVerdict: backend.credentialFileVerdict(),
        hasStoredApiKey: (await credentials.getApiKey()) !== undefined,
        hasEnvironmentApiKey: backend.hasEnvironmentKey(),
        changedSettingNames: changedSettingNames(
          manifestSettingNames(context.extension.packageJSON),
          (name) => configuration.inspect(name),
        ),
      })
    },
    readJournal: () => reports.readJournal(),
    readScrub: () =>
      reportScrubContext({
        workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
          (folder) => folder.uri.fsPath,
        ),
        homeDir: homedir(),
        userName: () => userInfo().username,
        hostName: () => hostname(),
      }),
    nowMs: () => Date.now(),
    canUseVscodeReporter: async () => {
      const commands = await vscode.commands.getCommands(true)
      return commands.includes(VSCODE_COMMANDS.openIssueReporter)
    },
  }
  const conversationReports: ConversationReports = {
    source: reportSource,
    io: vscodeReportEditorIo,
    recordWebviewError: (error) => {
      reports.recordWebviewError(error)
    },
    record: (kind, code) => reports.record(kind, code),
  }
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
          // A provider's secret counts as a Model API credential (M95, D74).
          hasStoredKey: async () => await credentials.hasModelApiCredential(),
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
        if (!exit.isExpected) {
          // A fixed word, never the description itself (M93, D72).
          reports.record('backendExit', exitCodeWord(exit.description), { backend: 'museCode' })
        }
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
    // Sessions whose Muse Code event log failed (CLI recovery); a value
    // that does not validate reads as none, as above.
    damagedIds: () => {
      const parsed = damagedIdsSchema.safeParse(
        context.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.damagedSessions) ?? [],
      )
      return parsed.success ? parsed.data : []
    },
    setDamagedIds: async (ids) => {
      await context.workspaceState.update(WORKSPACE_STATE_KEYS.damagedSessions, [...ids])
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
      case 'importFromAgents': {
        await cliFeatures.importFromAgents()
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
      case 'openPullRequestInConversation': {
        await openPullRequestInConversation(gitFeatures, gitPopups.showError)
        break
      }
      case 'openModelApiStatus': {
        await vscode.env.openExternal(vscode.Uri.parse(`${MODEL_API_BASE_URL}/status`))
        break
      }
      case 'restartMuseCode': {
        // A notice's Restart (a D26 fault, or Muse Code not answering): the
        // next message continues the conversation (D25).
        await restartMuseCode('asked for from a notice in the panel')
        break
      }
      // The bundled skills' offer (M89): Install and Update are the same steps.
      case 'installBundledSkills':
      case 'updateBundledSkills': {
        await runBundledSkillsInstall(bundledSkillsCommand())
        break
      }
      case 'declineBundledSkills': {
        await bundledSkillsOffer.decline()
        break
      }
      // M95 (PLAN.md D74, lane U): the first-run screen, the picker's rows
      // and the setup confirmation reach lane K's Models & Agents commands
      // through the registered ids (an explicit error until lane K lands).
      case 'startWithOwnModel': {
        await vscode.commands.executeCommand(COMMAND_IDS.startWithOwnModel)
        break
      }
      case 'addModelProvider': {
        await vscode.commands.executeCommand(COMMAND_IDS.addModelProvider)
        break
      }
      case 'manageModels': {
        await vscode.commands.executeCommand(COMMAND_IDS.modelsAndAgents)
        break
      }
      case 'openUsagePage': {
        await vscode.commands.executeCommand('museSpark.openUsagePage')
        break
      }
      case 'showWhatsNew': {
        whatsNew.show()
        break
      }
    }
  }

  // One per window (M82): a notice two surfaces on one session receive is
  // raised once, and only while the window is unfocused.
  const backgroundNotifier = new BackgroundNotifier({
    isEnabled: () => currentSettings().notifyOnBackgroundTurn,
    isWindowFocused: () => vscode.window.state.focused,
    show: async (message) =>
      (await vscode.window.showInformationMessage(message, UI_TEXT.notifyShowConversation)) ===
      UI_TEXT.notifyShowConversation,
    log,
  })

  // Extension hooks on both backends (M91 lane E, PLAN.md D70): FileChanged,
  // ConfigChange, Setup, Manual and DirectoryAdded fire from the window, so
  // the backend in use does not matter. The runner loads lazily from
  // dist/extensionHooks.js the first time one fires; activation never pays
  // for it, and a window that never fires one never loads it.
  const hookBundle = extensionHooksBundle(
    vscode.Uri.joinPath(context.extensionUri, 'dist', EXTENSION_HOOKS_BUNDLE_FILE).fsPath,
    log,
  )
  const hookChannel = vscode.window.createOutputChannel(`${PRODUCT_NAME} Hooks`)
  let hookRunner: ExtensionHookRunner | undefined
  let hookRunnerLoading: Promise<ExtensionHookRunner | undefined> | undefined
  const createHookRunnerFor = async (
    shouldAnnounceFailure: boolean,
  ): Promise<ExtensionHookRunner | undefined> => {
    if (hookRunner !== undefined) {
      return hookRunner
    }
    let loaded: ExtensionHooksModule
    try {
      loaded = await hookBundle.loadBundle()
    } catch (error: unknown) {
      log.warn(
        `Extension hooks are unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
      if (shouldAnnounceFailure) {
        void vscode.window.showWarningMessage(UI_TEXT.extensionHooksUnavailable)
      }
      return undefined
    }
    const runner = loaded.createExtensionHookRunner(
      {
        io: fileContextIo,
        runHook: (command, payload, cwd, timeoutMs, signal, extraEnvNames) => {
          const run = toolIo.runHook?.bind(toolIo)
          if (run === undefined) throw new Error(UI_TEXT.hooksNotRunnable)
          return run(command, payload, cwd, timeoutMs, signal, extraEnvNames)
        },
        platform: process.platform,
        workspaceRoot: workspaceRoot ?? '',
        settingsPath: museSettingsPath(museConfig()),
        isWorkspaceTrusted: isProjectTrusted,
        isHooksEnabled: () => currentSettings().modelApiHooks,
        now: () => Date.now(),
        isIndexed: (relativePath) => mentions.contains(relativePath),
        notice: (level, text) => {
          registry.broadcast({ type: 'notice', level, text })
        },
        showOutput: (title, text) => {
          hookChannel.appendLine(`--- ${title} ---`)
          hookChannel.append(text.endsWith('\n') ? text : `${text}\n`)
          hookChannel.show(true)
        },
        warn: (message) => {
          log.warn(message)
        },
      },
      UI_TEXT,
      uiLocale(),
    )
    await runner.reload()
    hookRunner = runner
    return runner
  }
  const hookRunnerFor = async (
    shouldAnnounceFailure: boolean,
  ): Promise<ExtensionHookRunner | undefined> => {
    // One in-flight factory preserves the window-wide debounce and process cap.
    hookRunnerLoading ??= createHookRunnerFor(shouldAnnounceFailure)
    const loading = hookRunnerLoading
    try {
      return await loading
    } finally {
      if (hookRunnerLoading === loading) hookRunnerLoading = undefined
    }
  }
  /** The gates before the bundle even loads: untrusted or opted out, nothing fires. */
  const areHooksArmed = (): boolean =>
    workspaceRoot !== undefined && isProjectTrusted() && currentSettings().modelApiHooks
  /** Run with the window's hook runner; failures stay in the log unless announced. */
  const withHookRunner = async (
    run: (runner: ExtensionHookRunner) => Promise<void>,
    shouldAnnounceFailure: boolean,
  ): Promise<void> => {
    if (!areHooksArmed()) {
      return
    }
    const runner = await hookRunnerFor(shouldAnnounceFailure)
    if (runner === undefined) {
      return
    }
    await run(runner)
  }
  /** Run one Manual hook by command or description; false when no hook matches. */
  const runManualHookByName = async (name: string): Promise<{ matched: boolean }> => {
    if (!areHooksArmed()) {
      void vscode.window.showInformationMessage(UI_TEXT.hooksNotRunnable)
      return { matched: false }
    }
    let outcome: { matched: boolean } = { matched: false }
    await withHookRunner(async (runner) => {
      outcome = await runner.runManual(name)
      if (!outcome.matched) {
        void vscode.window.showWarningMessage(fill(UI_TEXT.manualHookNoneNamed, { name }))
      } else if ('failedReason' in outcome && typeof outcome.failedReason === 'string') {
        void vscode.window.showWarningMessage(
          fill(UI_TEXT.manualHookFailed, { name, reason: outcome.failedReason }),
        )
      } else {
        void vscode.window.showInformationMessage(fill(UI_TEXT.manualHookDone, { name }))
      }
    }, true)
    return outcome
  }

  const loadConversation = conversationLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', CONVERSATION_BUNDLE_FILE).fsPath,
    log,
  })
  const controllerFor = (surface: ChatSurface): ConversationController => {
    let controller = controllers.get(surface.id)
    if (controller === undefined) {
      const factory = loadConversation()
      const tasksTab = new TasksPanel(
        hostContext,
        () => {
          if (registry.has(surface)) {
            surface.reveal()
          }
        },
        (released) => {
          if (tasksTabs.get(surface.id) === released) {
            tasksTabs.delete(surface.id)
          }
        },
      )
      tasksTabs.set(surface.id, tasksTab)
      controller = factory.createConversation(
        {
          usageRecording,
          runManualHook: runManualHookByName,
          rewriteMessage: async (text) => {
            const runner = areHooksArmed() ? await hookRunnerFor(false) : undefined
            return await runner?.rewriteMessage(text)
          },
          surface,
          questions: factory.questionsForHost(questionsStore),
          tasksTab,
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
          // One explicit yes per conversation before the model switches; the
          // Model API backend asks the same question for a custom agent's model.
          confirmContributor: isContributorModelAllowed,
          runHostAction,
          // A turn needs the user while the VS Code window is unfocused
          // (M82); the notice's button brings this surface into view, while
          // it is still open.
          notifyAttention: (notice) => {
            backgroundNotifier.notify(notice, () => {
              if (registry.has(surface)) {
                surface.reveal()
              }
            })
          },
          museCodeReviewer,
          judge,
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
          shellSandbox: () => backend.shellSandboxPosture(),
          shouldWarnSandboxOff,
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
          editReview: review.editReview,
          review,
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
          readServiceStatus: () =>
            keyClient().readServiceStatus(AbortSignal.timeout(MODEL_API_STATUS_READ_TIMEOUT_MS)),
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
          museVoice: () => {
            if (
              !paid.gate.isOn('voice') ||
              !usablePaidFeatures(auth.current.backend, isKeyStored).includes('voice')
            )
              return
            if (auth.current.backend === 'modelApi') {
              return currentSettings().dictationEngine === 'system'
                ? undefined
                : { isAvailable: false, reason: UI_TEXT.sessionBudgetVoiceUnavailable }
            }
            return museVoiceSetup
          },
          modelApiSessionBudgetUsd: () => currentSettings().modelApiSessionBudgetUsd,
          voiceAccountId: () => modelApi.accountId(),
          ownedVoiceBudgetScope: async (sessionId) => {
            if (auth.current.backend !== 'modelApi') {
              throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
            }
            const host = await modelApi.ensureHost()
            return await host.getOwnedBudgetScope(sessionId)
          },
          exports: cliFeatures.exports,
          transferFiles: createSessionTransferFiles(),
          reports: conversationReports,
          plans,
          // The palette's paid-feature toggles (M33): on goes through the price confirmation.
          setPaidFeature: async (feature, isOn) => {
            if (isOn) {
              await paid.gate.turnOn(feature)
            } else {
              await paid.gate.turnOff(feature)
            }
          },
          // VS Code's trust and the hold apart (M71), so a refusal says which;
          // the controller asks both before any git (Best-of-N, board, review).
          isWorkspaceTrusted: () => vscode.workspace.isTrusted,
          isWorktreeHeld: () => windowHold.isHeld,
          createGit: conversationGitFactory(conversationGit, gitFeatures),
          onForegroundTasksChanged: refreshTaskContext,
          isScheduledPaidOn: () => paid.gate.isOn('scheduledPrompts'),
          confirmScheduledRun: async (job, modelId) =>
            await paid.consent.allows({ feature: 'scheduledPrompts', prompt: job.prompt, modelId }),
          allowsPaidUse: async (request) => await paid.consent.allows(request),
          forgetPaidUse: async () => {
            await paid.consent.forget()
          },
          checkpoints,
          // Text files and notebooks open with unsaved changes, by absolute path (M72).
          unsavedPaths: () =>
            [...vscode.workspace.textDocuments, ...vscode.workspace.notebookDocuments]
              .filter((document) => document.isDirty && document.uri.scheme === FILE_SCHEME)
              .map((document) => document.uri.fsPath),
          confirmFileAction: async (title, detail, action) =>
            (await vscode.window.showWarningMessage(title, { modal: true, detail }, action)) ===
            action,
          // Muse Code checks its own edits (M68): its checks run through its own
          // shell, so none are named while Restricted Mode runs no shell (D13).
          // The diagnostics sentence only for a session that has the ide server.
          verifyGuidance: (hasIdeServer) => {
            const settings = currentSettings()
            return verifyGuidance(
              settings.diagnosticsAfterEdits && hasIdeServer,
              isProjectTrusted() ? settings.checkCommands : [],
            )
          },
          bundledSkillsOffer: () => bundledSkillsOffer.next(),
          // The session board's pending prompts, shared by every surface (M77).
          pendingPrompts: boardPrompts,
          boardSessions: () => {
            const sessions: BoardSession[] = []
            for (const active of controllers.values()) {
              const session = active.boardSession()
              if (session !== undefined) sessions.push(session)
            }
            return sessions
          },
          focusBoardSession: (sessionId, backendKind) => {
            for (const active of controllers.values()) {
              if (active.revealBoardSession(sessionId, backendKind)) return true
            }
            return false
          },
          // The deterministic legal scan (M97, PLAN.md D76): dist/legalScan.js
          // (D6) on the first scan; the Plan hold stays in the host review bundle.
          legalScan: runLegalScan,
          legalExplanation: async (report, signal) => {
            if (!isKeyStored) throw new Error(UI_TEXT.legalExplainUnavailable)
            return await paidLegalExplanation(
              report,
              {
                gate: paid.gate,
                consent: paid.consent,
                reserve: dailyPaid.reserve,
                capUsd: dailyPaid.capUsd,
                keyDigest: () => modelApi.accountId(),
                usage: paid.usage,
                stream: (body, active, guard) =>
                  modelApi.streamLegalExplanation(body, active, guard),
              },
              signal,
            )
          },
          legalMarkdown: (report) => {
            const render = legalScanBundle().renderLegalMarkdown
            if (render === undefined) throw new Error(UI_TEXT.legalScanUnavailable)
            return render(report)
          },
          legalFixApplier: createLegalFixApplier({
            prepare: async (findings) => {
              if (workspaceRoot === undefined || !vscode.workspace.isTrusted) return []
              const prepare = legalScanBundle().prepareLegalFixes
              if (prepare === undefined) throw new Error(UI_TEXT.legalFixRefusedUnavailable)
              return await prepare(workspaceRoot, findings)
            },
            ...legalFixFileEdits({
              workspaceRoot,
              platform: process.platform,
              io: toolIo,
              withAdmission: async (check, canPublish) => {
                const workspaceCheck = backend.workspaceActionGuard(nativeStarts.signal)
                const assertCanWrite = () => {
                  workspaceCheck()
                  check()
                }
                return await withCheckpointEdit(
                  checkpoints,
                  log,
                  assertCanWrite,
                  async () => await canPublish(assertCanWrite),
                )
              },
            }),
            approveOwnership: async (paths) =>
              (await vscode.window.showWarningMessage(
                fill(UI_TEXT.legalFixOwnership, { paths: paths.join(', ') }),
                { modal: true },
                UI_TEXT.legalFixApply,
              )) === UI_TEXT.legalFixApply,
          }),
          createLegalHold: (holdDeps) => review.createHold(holdDeps),
          bestOfNCoordinator,
          bestOfNWorkspaceEdits: (session) => {
            const owner =
              session === undefined ? undefined : modelApi.captureExternalEditOwner(session)
            return async (root, paths) => {
              const files: EditedFile[] = []
              for (const file of paths) {
                const checked = await confineWorkspacePath(root, file, process.platform, {
                  realPath: canonicalPath,
                })
                if (
                  !checked.ok ||
                  isProtectedPath(checked.relative) ||
                  isProtectedPath(checked.canonical) ||
                  checked.relative !== checked.canonical
                ) {
                  throw new Error(UI_TEXT.bestOfNTargetChanged)
                }
                files.push({ relative: checked.canonical, absolute: checked.checkedAbsolute })
              }
              return modelApi.beginExternalEdit(owner, files)
            }
          },
          modelApiAccountId: () => modelApi.accountId(),
          noteBestOfNRequest: () => {
            paid.usage.addBestOfNRequest()
          },
          noteBestOfNUsage: (modelId, usage) => {
            paid.usage.addBestOfNUsage(modelId, usage)
          },
          bestOfNBudgetScope: (sessionId) => modelApi.bestOfNBudgetScope(sessionId),
          openBestOfNWorktree: async (absolutePath) => {
            await vscode.commands.executeCommand(
              VSCODE_COMMANDS.openFolder,
              vscode.Uri.file(absolutePath),
              { forceNewWindow: true },
            )
          },
          runGit,
          runBestOfNGit,
          isPaidFeatureOn: (feature) => paid.gate.isOn(feature),
          notePaidUse: (feature, units, searchPriceUsd) => {
            paid.usage.add(feature, units, searchPriceUsd)
          },
          buildAttemptHost: (worktreeRoot, admitRequest, noteUsage, budgetScope) =>
            modelApi.buildAttemptHost(worktreeRoot, admitRequest, noteUsage, budgetScope),
          realPath: canonicalPath,
          now: () => Date.now(),
          log,
        },
        UI_TEXT,
        uiLocale(),
      )
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
      readyPromptSurfaces.add(surface)
      promptHost?.ready(surface)
      const controller = controllerFor(surface)
      controller.surfaceReady(attachmentEpoch)
      if (isHelpPending) {
        isHelpPending = false
        surface.post({ type: 'openHelp' })
      }
      // `Report a Problem` opened this surface (M93): its dialog now has a page to show in.
      if (isReportPending) {
        isReportPending = false
        void controller.openReport().catch(logRejection(log, 'the problem report'))
      }
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
      if (isReferenceRequest(message)) {
        void (async () => {
          const reference = referenceBundle().createReference(l10n.table, l10n.locale)
          await reference.handle(message, {
            readNls: async () => {
              const file =
                l10n.locale === 'en' ? 'package.nls.json' : `package.nls.${l10n.locale}.json`
              const text = await readUiTableFile(context.extensionUri.fsPath, [file])
              const parsed: unknown = JSON.parse(text)
              return parsed
            },
            currentValue: (key) => vscode.workspace.getConfiguration().get(key),
            openSetting: async (key) => {
              await vscode.commands.executeCommand(VSCODE_COMMANDS.openSettings, `@id:${key}`)
            },
            runCommand: async (command) => {
              await vscode.commands.executeCommand(command)
            },
            post: (reply) => {
              surface.post(reply)
            },
          })
        })().catch((error: unknown) => {
          logRejection(log, 'help reference')(error)
          surface.post({ type: 'referenceValues', model: '', values: {}, nls: {}, error: true })
        })
        return
      }
      if (message.type === 'sharingAction') {
        void (async () => {
          try {
            await sharing().handle(surface, message)
          } catch (error: unknown) {
            logRejection(log, 'sharing action')(error)
          }
        })()
        return
      }
      void controllerFor(surface).handle(message)
    },
  }

  registry.onRemoved((surface) => {
    promptHost?.close(surface)
    controllers.get(surface.id)?.dispose()
    controllers.delete(surface.id)
    tasksTabs.get(surface.id)?.release()
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

  // The sidebar's view provider, wrapped for Tab's deferred secret read.
  const chatViewProvider = new ChatViewProvider(hostContext, registry)
  const openSidebar = () => {
    // Tab's deferred secret read (M94): the first view, panel or command.
    void ensureKeyPresence()
    return vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`)
  }
  /** A conversation where the setting says new ones open. */
  const openConversation = async (): Promise<void> => {
    void ensureKeyPresence()
    if (currentSettings().preferredLocation === 'sidebar') {
      await openSidebar()
      return
    }
    openChatPanel(hostContext, registry)
  }
  // Sharing loads on first use or when the user changes its machine sync consent.
  const sharing = () =>
    (promptHost ??= promptBundleLoader(
      `${context.extensionUri.fsPath}/dist/${PROMPT_BUNDLE_FILE}`,
      log,
    )().createPromptHost(
      {
        context,
        workspaceRoot,
        credentials,
        settings: currentSettings,
        registry,
        openConversation,
        ready: readyPromptSurfaces,
        controllers,
        webFetch: webFetchBundle,
        log,
      },
      UI_TEXT,
      uiLocale(),
    ))
  const syncPrompts = async () => {
    try {
      await sharing().run('synchronise')
    } catch (error: unknown) {
      logRejection(log, 'prompt sync')(error)
    }
  }
  if (
    vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect<boolean>(PROMPT_SYNC_SETTING)
      ?.globalValue
  )
    void syncPrompts()
  for (const id of Object.values(PROMPT_COMMAND_IDS))
    context.subscriptions.push(
      registerLoggedCommand(log, id, (input: unknown) => sharing().run(id, input)),
    )
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
  // Extension hooks on both backends (M91 lane E): every workspace file for
  // FileChanged, the three project config files for ConfigChange, the user's
  // own spark-hooks.json for a silent snapshot reload (it has no
  // workspace-relative path, so it never fires ConfigChange).
  const hookFileWatcher = vscode.workspace.createFileSystemWatcher('**/*')
  const hookConfigWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{.muse/hooks.json,.muse/spark-hooks.json}',
  )
  const hookUserWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(museSettingsPath(museConfig()))),
      'spark-hooks.json',
    ),
  )
  const onHookWorkspaceFile = (uri: vscode.Uri): void => {
    if (!areHooksArmed()) {
      return
    }
    void withHookRunner((runner) => runner.noteWorkspaceFile(uri.fsPath), false).catch(
      logRejection(log, 'FileChanged hook'),
    )
  }
  const onHookConfigFile = (uri: vscode.Uri): void => {
    if (!areHooksArmed()) {
      return
    }
    let reason: 'settings' | 'hooks' | 'spark-hooks' = 'settings'
    if (uri.path.endsWith('.muse/spark-hooks.json')) {
      reason = 'spark-hooks'
    } else if (uri.path.endsWith('.muse/hooks.json')) {
      reason = 'hooks'
    }
    void withHookRunner((runner) => runner.noteConfigFile(uri.fsPath, reason), false).catch(
      logRejection(log, 'ConfigChange hook'),
    )
  }
  const onHookUserFile = (): void => {
    if (!areHooksArmed()) {
      return
    }
    void withHookRunner((runner) => runner.reload(), false).catch(logRejection(log, 'hook reload'))
  }

  // Models & Agents (M95 lane K, PLAN.md D74, D6): the panel bundle and the
  // lane-P/T seam load on the first Models action; activation keeps only
  // these registrations and the loaders. Until lanes P and I merge, the
  // seam load refuses and each command says the panel is unavailable.
  /** Asks the conversation to set the composer's model (its refusal stands). */
  const setComposerModel = async (modelRef: string): Promise<void> => {
    if (registry.active === undefined) {
      await openConversation()
    }
    const surface = registry.active
    const confirm = modelsPanelBundle().setComposerModelConfirmed
    if (surface === undefined || confirm === undefined) {
      throw new Error(UI_TEXT.actionFailed)
    }
    await confirm(surface, modelRef, () =>
      controllerFor(surface).handle({ type: 'setModel', modelId: modelRef }),
    )
  }
  /** `museSpark.suggestedProvider` as written: a preset id at most. */
  const suggestedProviderSetting = (): string => {
    const raw: unknown = vscode.workspace
      .getConfiguration(SETTINGS_SECTION)
      .get('suggestedProvider')
    return typeof raw === 'string' ? raw : ''
  }
  let modelsFeatures: ModelsPanelFeatures | undefined
  const ensureModelsFeatures = (): ModelsPanelFeatures => {
    if (modelsFeatures === undefined) {
      const bundle = modelsPanelBundle()
      const seam = providersSeamBundle()
      modelsFeatures = bundle.createModelsPanelFeatures(
        {
          connectChatGpt: () => subscriptionFeatures().connectChatGpt(),
          connectCopilot: () => subscriptionFeatures().connectCopilot(),
          removeSubscription: (id) => subscriptionFeatures().removeSubscription(id),
          isConfidential: () => currentSettings().confidentialWorkspace,
          secrets: context.secrets,
          extensionUri: context.extensionUri,
          l10n,
          log,
          globalState: context.globalState,
          suggestedProviderSetting,
          isRemote: vscode.env.remoteName !== undefined,
          setComposerModel,
          onKeyUsage: (snapshot) => {
            usageRecording.limit({
              backend: 'modelApi',
              provider: 'openrouter',
              source: 'openRouter',
              observedAt: Date.now(),
              windows: [],
              account: {
                usedUsd: snapshot.usedThisMonth,
                period: 'month',
                ...(snapshot.limit !== undefined && { limitUsd: snapshot.limit }),
                ...(snapshot.remaining !== undefined && { remainingUsd: snapshot.remaining }),
              },
            })
          },
          onWizardSaved: async (outcome) => {
            await auth.refresh()
            const surface = registry.active
            if (surface !== undefined) {
              bundle.publishProviderSetup?.(outcome, surface)
            }
          },
        },
        seam,
      )
    }
    return modelsFeatures
  }

  // Lane E's editor command adapter; lane S supplies the lazy shared service.
  const usageBundle = usagePanelLoader({
    bundlePath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'usagePanel.js').fsPath,
    log,
  })
  let usagePanel: Promise<UsagePanel> | undefined
  const openUsagePage = async (): Promise<void> => {
    usagePanel ??= (async () => {
      const panel = await usageBundle().createUsagePanel({
        extensionUri: context.extensionUri,
        l10n,
        log,
        beforeRead: () => usageRecording.flush(),
        budgetStorageFolder: context.globalStorageUri.fsPath,
        live: {
          readBudgets: async () => [
            ...(await dailyPaid.readToday()),
            ...(await modelApi.readUsageBudgets()),
          ],
          readLiveLimits: () => Promise.resolve(usageRecording.limits?.() ?? []),
          providerConsoles: () => [],
        },
        openModels: (provider, model) => {
          ensureModelsFeatures().openPanel({
            section: 'models',
            presetId: model === undefined ? provider : `${provider}/${model}`,
          })
          return Promise.resolve()
        },
      })
      context.subscriptions.push(panel)
      return panel
    })()
    try {
      const panel = await usagePanel
      panel.open()
    } catch (error: unknown) {
      usagePanel = undefined
      throw error
    }
  }

  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  usageStatus.text = `$(graph) ${UI_TEXT.usagePageTitle}`
  usageStatus.tooltip = UI_TEXT.openUsagePage
  usageStatus.command = COMMAND_IDS.openUsagePage
  usageStatus.show()
  context.subscriptions.push(usageStatus)

  void recoverProviderRemovals(
    context.globalState.get(GLOBAL_STATE_KEYS.providerPendingRemovals),
    ensureModelsFeatures,
    log,
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
    // Extension hooks on both backends (M91 lane E): the workspace watcher
    // feeds FileChanged, the config files ConfigChange, folder changes
    // DirectoryAdded. The index refreshes first so the runner's
    // gitignored/excluded check answers for the file as it is now; the
    // runner drops the rest before any process starts.
    hookFileWatcher,
    hookChannel,
    hookFileWatcher.onDidChange(onHookWorkspaceFile),
    hookFileWatcher.onDidCreate(onHookWorkspaceFile),
    hookFileWatcher.onDidDelete(onHookWorkspaceFile),
    hookConfigWatcher,
    hookConfigWatcher.onDidChange(onHookConfigFile),
    hookConfigWatcher.onDidCreate(onHookConfigFile),
    hookConfigWatcher.onDidDelete(onHookConfigFile),
    hookUserWatcher,
    hookUserWatcher.onDidChange(onHookUserFile),
    hookUserWatcher.onDidCreate(onHookUserFile),
    hookUserWatcher.onDidDelete(onHookUserFile),
    vscode.workspace.onDidChangeWorkspaceFolders((event) => {
      for (const folder of event.added) {
        void withHookRunner((runner) => runner.noteDirectoryAdded(folder.uri.fsPath), false).catch(
          logRejection(log, 'DirectoryAdded hook'),
        )
      }
    }),
    editorContext,
    {
      dispose: () => {
        ideServer.close()
      },
    },
    vscode.window.onDidChangeActiveTextEditor(() => {
      editorContext.update(editorSnapshot)
      // Tab's language-off and snooze states follow the active editor (M94).
      tab.refreshStatus()
    }),
    vscode.window.onDidChangeWindowState((state) => {
      // A timed snooze is enforced live by the provider; the bar catches up
      // when the window is focused (M94).
      if (state.focused) {
        tab.refreshStatus()
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      editorContext.update(editorSnapshot)
    }),
    vscode.workspace.registerTextDocumentContentProvider(MUSE_EDIT_SCHEME, {
      provideTextDocumentContent: (uri) => review.editReview.provide(uri.path),
    }),
    fileWatcher.onDidCreate(() => {
      mentions.invalidate()
    }),
    fileWatcher.onDidDelete(() => {
      mentions.invalidate()
    }),
    vscode.window.registerWebviewViewProvider(
      CHAT_VIEW_ID,
      {
        resolveWebviewView: (view) => {
          // Tab's deferred secret read (M94): a restored sidebar view is a
          // first view with no command or panel open behind it.
          void ensureKeyPresence()
          chatViewProvider.resolveWebviewView(view)
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SETTINGS_SECTION}.${PROMPT_SYNC_SETTING}`))
        void syncPrompts()
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        void withHookRunner((runner) => runner.noteSettingsChange(), false).catch(
          logRejection(log, 'ConfigChange hook'),
        )
      }
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        registry.broadcast({ type: 'settingsChanged', settings: hostContext.getSettings() })
        for (const controller of controllers.values()) {
          controller.refreshDictation()
          if (event.affectsConfiguration(`${SETTINGS_SECTION}.confidentialWorkspace`)) {
            controller.confidentialWorkspaceChanged()
          }
        }
      }
      // Checkpoints on or off: every panel's menus follow (M72).
      if (event.affectsConfiguration(TURN_CHECKPOINTS_SETTING)) {
        for (const controller of controllers.values()) {
          controller.checkpointsChanged()
        }
      }
      // A paid feature turned on anywhere asks for its price once (D30).
      if (paid.affects(event)) {
        void paid.gate.review().catch(logRejection(log, 'paid feature review'))
      }
      // Inline completions on or off, and the status bar follows the
      // settings, the editors and the spend (M94).
      if (event.affectsConfiguration(`${SETTINGS_SECTION}.modelApiTab`)) {
        tab.refresh()
      } else if (event.affectsConfiguration(SETTINGS_SECTION)) {
        tab.refreshStatus()
      }
      // Account & usage shows the configured budget (RVM94HU 24).
      if (event.affectsConfiguration(`${SETTINGS_SECTION}.tabDailyBudgetUsd`)) {
        broadcastPaidState()
      }
      // The bundled skills on or off: the Model API catalogue follows (M89).
      if (event.affectsConfiguration(BUNDLED_SKILLS_SETTING)) {
        onSkillFilesChanged()
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
        if (isSubscriptionConnecting) return
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
      // Checkpoints run from now on, and what was queued while untrusted is cleaned up (M72).
      void checkpoints.maintain().catch(logRejection(log, 'checkpoint cleanup'))
      for (const controller of controllers.values()) {
        controller.checkpointsChanged()
      }
      // A trusted workspace activates (M91 lane E): its root reads as a
      // DirectoryAdded, on both backends.
      void withHookRunner((runner) => runner.noteDirectoryAdded(workspaceRoot ?? ''), false).catch(
        logRejection(log, 'DirectoryAdded hook'),
      )
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
    registerLoggedCommand(log, 'museSpark.openUsagePage', openUsagePage),
    registerLoggedCommand(
      log,
      COMMAND_IDS.openTasks,
      forActiveConversation(async (controller) => {
        await controller.handle({ type: 'hostAction', action: 'openTasksTab' })
      }),
    ),
    registerLoggedCommand(log, COMMAND_IDS.newConversation, async () => {
      const surface = registry.active
      if (surface === undefined) {
        await openConversation()
        return
      }
      surface.reveal()
      await controllerFor(surface).handle({ type: 'clearConversation' })
    }),
    registerLoggedCommand(log, COMMAND_IDS.connectChatGpt, () =>
      subscriptionFeatures().connectChatGpt(),
    ),
    registerLoggedCommand(log, COMMAND_IDS.connectCopilot, () =>
      subscriptionFeatures().connectCopilot(),
    ),
    registerLoggedCommand(log, COMMAND_IDS.signOut, async () => {
      await auth.signOut()
      void vscode.window.showInformationMessage(UI_TEXT.signedOutNotice)
    }),
    registerLoggedCommand(log, COMMAND_IDS.openInTerminal, async () => {
      await openMuseTerminal({
        resolveCli,
        runInTerminal: runCliInTerminal,
        workspaceRoot,
        showWarning: (message) => {
          void vscode.window.showWarningMessage(message)
        },
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.createRulesFile, async () => {
      const check = backend.workspaceActionGuard(nativeStarts.signal)
      await createRulesFile({
        workspaceRoot,
        // `muse init` reads the project: not while the window is held (M71).
        isWorkspaceTrusted: isProjectTrusted,
        fileExists: isExistingPath,
        writeFile: (fsPath, content) => writeUserFile(check, fsPath, content),
        openFile: async (fsPath) => {
          await vscode.window.showTextDocument(vscode.Uri.file(fsPath))
        },
        runInit: () => {
          check()
          const resolution = backend.resolveLaunch()
          return workspaceRoot !== undefined && resolution.ok
            ? backend.startWorkspaceCommand(() => {
                check()
                return runProcess(
                  { command: resolution.launch.command, args: MUSE_INIT_ARGS },
                  MUSE_INIT_TIMEOUT_MS,
                  workspaceRoot,
                  backend.childEnvironment(),
                  nativeStarts.signal,
                  check,
                )
              }, nativeStarts.signal)
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
    registerLoggedCommand(log, COMMAND_IDS.openHelp, async () => {
      const surface = registry.active
      if (surface === undefined) {
        isHelpPending = true
        await openConversation()
        return
      }
      surface.reveal()
      surface.post({ type: 'openHelp' })
    }),
    // Report a problem (M93, PLAN.md D72): the dialog over the journal and
    // local facts, in the conversation in view or one opened for it.
    registerLoggedCommand(log, COMMAND_IDS.reportProblem, async () => {
      const surface = registry.active
      if (surface === undefined) {
        isReportPending = true
        await openConversation()
        return
      }
      surface.reveal()
      await controllerFor(surface).openReport()
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
                nativeStarts.signal,
                backend.workspaceActionGuard(nativeStarts.signal),
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
              undefined,
              undefined,
              nativeStarts.signal,
              backend.workspaceActionGuard(nativeStarts.signal),
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
          isShellSandboxed: posture.isSandboxed,
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
    ...(['next', 'previous'] as const).map((direction) =>
      registerLoggedCommand(
        log,
        direction === 'next' ? COMMAND_IDS.nextOpenQuestion : COMMAND_IDS.previousOpenQuestion,
        () => {
          const surface = registry.active
          if (surface === undefined) return
          surface.reveal()
          controllers.get(surface.id)?.jumpToOpenQuestion(direction)
        },
      ),
    ),
    registerLoggedCommand(log, COMMAND_IDS.toggleFocusView, async () => {
      await runHostAction('toggleFocusView')
    }),
    registerLoggedCommand(
      log,
      COMMAND_IDS.toggleThinking,
      forActiveConversation((controller) => controller.toggleThinking()),
    ),
    registerLoggedCommand(
      log,
      COMMAND_IDS.legalScan,
      forActiveConversation((controller) => controller.handle({ type: 'requestLegalScan' })),
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
    registerLoggedCommand(log, COMMAND_IDS.retryPluginHooks, () => {
      pluginJobs.reset()
      void vscode.window.showInformationMessage(UI_TEXT.pluginHooksRetried)
    }),
    // A fresh `muse serve` without a window reload (CLI recovery): a running
    // turn is stopped, and each conversation resumes with its next message.
    registerLoggedCommand(log, COMMAND_IDS.restartMuseCode, async () => {
      await restartMuseCode('asked for from the command palette')
      // Said in VS Code: the palette may run it with no panel open.
      void vscode.window.showInformationMessage(UI_TEXT.museCodeRestarted)
    }),
    // M89 (PLAN.md D68): the bundled skills into Muse Code's folders, and out.
    registerLoggedCommand(log, COMMAND_IDS.installBundledSkills, () =>
      runBundledSkillsInstall(bundledSkillsCommand()),
    ),
    registerLoggedCommand(log, COMMAND_IDS.removeBundledSkills, () =>
      runBundledSkillsRemove(bundledSkillsCommand()),
    ),
    registerLoggedCommand(log, COMMAND_IDS.showWhatsNew, () => {
      whatsNew.show()
    }),
    registerLoggedCommand(log, COMMAND_IDS.manageSkills, () => cliFeatures.manageSkills()),
    registerLoggedCommand(log, COMMAND_IDS.importSkills, () => cliFeatures.importSkills()),
    registerLoggedCommand(log, COMMAND_IDS.importFromAgents, () => cliFeatures.importFromAgents()),
    registerLoggedCommand(log, COMMAND_IDS.mcpServers, () => cliFeatures.showMcpServers()),
    registerLoggedCommand(log, COMMAND_IDS.hooks, () => cliFeatures.showHooks()),
    registerLoggedCommand(log, COMMAND_IDS.memory, () => memoryView.showMemory()),
    registerLoggedCommand(log, COMMAND_IDS.newWorktree, () => worktrees.newWorktree()),
    registerLoggedCommand(log, COMMAND_IDS.removeWorktree, () => worktrees.removeWorktree()),
    registerLoggedCommand(log, COMMAND_IDS.openPullRequestInConversation, () =>
      openPullRequestInConversation(gitFeatures, gitPopups.showError),
    ),
    registerLoggedCommand(log, COMMAND_IDS.exportConversation, async () => {
      const surface = registry.active
      if (surface === undefined) {
        void vscode.window.showInformationMessage(UI_TEXT.exportNothing)
        return
      }
      await controllerFor(surface).handle({ type: 'exportConversation', format: 'markdown' })
    }),
    // Import and share (M84): listed only while a Muse panel is in view.
    registerLoggedCommand(
      log,
      COMMAND_IDS.importSession,
      forActiveConversation((controller) => controller.handle({ type: 'importSession' })),
    ),
    registerLoggedCommand(
      log,
      COMMAND_IDS.openShareFile,
      forActiveConversation((controller) => controller.handle({ type: 'openShareFile' })),
    ),
    // M95 (PLAN.md D74) lane K: the wizard opened at "Pick a provider" (with
    // the workspace's suggested preset chosen, when it names one), the panel,
    // and the quick-pick fast path. Loading a missing bundle refuses with an
    // explicit error, never an empty success.
    registerLoggedCommand(log, COMMAND_IDS.startWithOwnModel, () => {
      const features = ensureModelsFeatures()
      features.openPanel({
        wizard: true,
        section: 'providers',
        presetId: features.suggestedPreset(),
      })
    }),
    registerLoggedCommand(log, COMMAND_IDS.modelsAndAgents, () => {
      ensureModelsFeatures().openPanel()
    }),
    registerLoggedCommand(log, COMMAND_IDS.addModelProvider, async () => {
      await ensureModelsFeatures().runQuickPick()
    }),
    // Setup and Manual hooks (M91 lane E): the user starts them, on both
    // backends. Observation; the bounded output is shown in the hooks
    // channel, a failure as a warning with the hook's reason.
    registerLoggedCommand(log, COMMAND_IDS.runSetupHooks, async () => {
      if (!areHooksArmed()) {
        void vscode.window.showInformationMessage(UI_TEXT.hooksNotRunnable)
        return
      }
      const runner = await hookRunnerFor(true)
      if (runner === undefined) {
        return
      }
      const result = await runner.runSetup('init')
      if (result.ran === 0) {
        void vscode.window.showInformationMessage(UI_TEXT.setupHooksNone)
      } else if (result.failedReason === undefined) {
        void vscode.window.showInformationMessage(plural(UI_TEXT.setupHooksRan, result.ran))
      } else {
        void vscode.window.showWarningMessage(
          fill(UI_TEXT.setupHooksFailed, { reason: result.failedReason }),
        )
      }
    }),
    registerLoggedCommand(log, COMMAND_IDS.runHook, async () => {
      if (!areHooksArmed()) {
        void vscode.window.showInformationMessage(UI_TEXT.hooksNotRunnable)
        return
      }
      const runner = await hookRunnerFor(true)
      if (runner === undefined) {
        return
      }
      await runner.reload()
      const hooks = runner.listManual()
      if (hooks.length === 0) {
        void vscode.window.showInformationMessage(UI_TEXT.manualHookNone)
        return
      }
      const picked = await vscode.window.showQuickPick(
        hooks.map((hook) => ({
          label: hook.description ?? hook.command,
          description: hook.description === undefined ? hook.source : hook.command,
          detail: hook.source,
          command: hook.command,
        })),
        { placeHolder: UI_TEXT.manualHookPick },
      )
      if (picked === undefined) {
        return
      }
      const name = picked.label
      const result = await runner.runManual(picked.command)
      if (!result.matched) {
        void vscode.window.showInformationMessage(UI_TEXT.manualHookNone)
      } else if (result.failedReason === undefined) {
        void vscode.window.showInformationMessage(fill(UI_TEXT.manualHookDone, { name }))
      } else {
        void vscode.window.showWarningMessage(
          fill(UI_TEXT.manualHookFailed, { name, reason: result.failedReason }),
        )
      }
    }),
  )
  void withHookRunner((runner) => runner.noteDirectoryAdded(workspaceRoot ?? ''), false).catch(
    logRejection(log, 'DirectoryAdded hook'),
  )
  void whatsNew.check().catch(logRejection(log, 'What’s New'))
  log.info(`Activated in ${String(Math.round(performance.now() - activationStartedAt))} ms`)
  // The flight recorder starts once activation is done (M93, D6): it sets
  // this window's marker and prunes. When the last activation of some window
  // ended without its deactivate, it is offered once, now that the command
  // can answer; its marker is already consumed, so a dismissal is remembered.
  setTimeout(() => {
    void reports
      .start()
      .then(async (shouldOffer) => {
        if (!shouldOffer) {
          return
        }
        const choice = await vscode.window.showWarningMessage(
          UI_TEXT.reportCrashOffer,
          UI_TEXT.reportCrashAction,
          UI_TEXT.reportCrashDismiss,
        )
        if (choice === UI_TEXT.reportCrashAction) {
          await vscode.commands.executeCommand(COMMAND_IDS.reportProblem)
        }
      })
      .catch(logRejection(log, 'the crash report offer'))
  }, 0)
}
