// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import { execFile, type ExecFileException } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { selectBackend } from './core/backendSelection'
import { personalSkillsRoot } from './core/context/skills'
import { renderSupportReport } from './core/support/report'
import type { CliInvocation } from './core/backends/musecode/sandbox'
import { type DiagnosticEntry, type DiagnosticSeverity, diagnosticsTool } from './core/diagnostics'
import type { EditorContext } from './core/editorContext'
import type { MentionSource } from './core/mention'
import { MentionIndex } from './core/mentionIndex'
import { AuthService } from './host/auth/authService'
import { CredentialStore, isValidModelApiKey } from './host/auth/credentialStore'
import { ModelApiBackendManager } from './host/backend/modelApiBackendManager'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { type ProcessResult, SandboxSetup } from './host/backend/sandboxSetup'
import { createFileSessionStore } from './host/backend/fileSessionStore'
import { createToolIo } from './host/backend/toolIo'
import { EditorContextTracker } from './host/editor/editorContextTracker'
import { EditReview } from './host/editor/editReview'
import { IdeMcpServer } from './host/ide/ideMcpServer'
import { insertMentionReference } from './host/commands/insertMention'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import {
  ConversationController,
  type FileAccess,
  type PickedFile,
  type SessionMemory,
} from './host/conversation/conversationController'
import { createLogger } from './host/logger'
import { pickMentionFile } from './host/mention/mentionQuickPick'
import { createWorkspaceFileLister } from './host/mention/workspaceFiles'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider, SIDEBAR_SURFACE_ID } from './host/views/ChatViewProvider'
import { openChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface, WebviewHostContext } from './host/views/webviewSetup'
import { createDictationSetup } from './host/voice/dictationHost'
import {
  BACKEND_SETTING,
  HAS_APPROVAL_UI,
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
  GIT_OUTPUT_MAX_BYTES,
  GLOBAL_STATE_KEYS,
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  MUSE_EDIT_SCHEME,
  MUSE_LOGIN_TERMINAL_NAME,
  PRODUCT_NAME,
  SEARCH_WORKER_FILE,
  SETTINGS_SECTION,
  SHELL_SANDBOX_SETTING,
  UI_TEXT,
  VSCODE_COMMANDS,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
  WORKSPACE_STATE_KEYS,
} from './shared/constants'
import type { HostAction } from './shared/protocol'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })
// `workspaceState` values are whatever an earlier version stored.
const archivedIdsSchema = z.array(z.string())
const lastSessionSchema = z.object({ sessionId: z.string(), at: z.number() })

// `git ls-files` on a large monorepo can exceed Node's 1 MiB default.
const QUICK_PICK_LIMIT = 50
const execFileAsync = promisify(execFile)

function activeSelection(): MentionSource | undefined {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined) {
    return undefined
  }
  return {
    relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
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

/** Every diagnostic VS Code holds, as plain entries for the IDE tool. */
function collectDiagnostics(): readonly DiagnosticEntry[] {
  return vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) =>
    diagnostics.map((diagnostic): DiagnosticEntry => ({
      path: relativePathInWorkspace(uri) ?? uri.fsPath,
      severity: DIAGNOSTIC_SEVERITIES[diagnostic.severity] ?? 'error',
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
      message: diagnostic.message,
      source: diagnostic.source,
    })),
  )
}

async function readTextFile(fsPath: string): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)))
  } catch {
    return undefined
  }
}

function quoteForShell(value: string): string {
  return `"${value.replaceAll('"', String.raw`\"`)}"`
}

/**
 * Runs the CLI where the user can see and interact with it. On Windows the
 * terminal is pinned to Windows PowerShell (the CLI's own shim shell) so the
 * call syntax is known; elsewhere the user's default shell runs the launcher.
 */
function runInTerminal(cliPath: string, args: readonly string[]): void {
  const isWindows = process.platform === 'win32'
  const systemRoot = process.env['SystemRoot']
  const terminal = vscode.window.createTerminal({
    name: MUSE_LOGIN_TERMINAL_NAME,
    ...(isWindows &&
      systemRoot !== undefined && {
        shellPath: `${systemRoot}${WINDOWS_POWERSHELL_TERMINAL_PATH}`,
      }),
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

function relativePathInWorkspace(uri: vscode.Uri): string | undefined {
  return vscode.workspace.getWorkspaceFolder(uri) === undefined
    ? undefined
    : vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/')
}

async function findWorkspaceFiles(): Promise<readonly string[]> {
  const uris = await vscode.workspace.findFiles(FIND_FILES_GLOB, undefined, MENTION_INDEX_LIMIT)
  return uris.map((uri) => vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/'))
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
  })
  return stdout
}

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
function runProcess(invocation: CliInvocation, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(
      invocation.command,
      [...invocation.args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: CLI_OUTPUT_MAX_BYTES },
      (error, stdout, stderr) => {
        resolve({ exitCode: exitCodeOf(error), stdout, stderr })
      },
    )
  })
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
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

  const credentials = new CredentialStore(context.secrets)
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
  })
  /** Stops both hosts and the conversations on them; the next message respawns. */
  const restartBackend = async (): Promise<void> => {
    for (const controller of controllers.values()) {
      controller.dispose()
    }
    await Promise.all([backend.dispose(), modelApi.dispose()])
  }
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
        const resolution = backend.resolveLaunch()
        return resolution.ok
          ? { ok: true, cliPath: resolution.launch.cliPath }
          : {
              ok: false,
              reason: `${resolution.reason} Searched: ${resolution.searched.join(', ')}`,
            }
      },
      credentialFileExists: () => backend.credentialFileExists(),
      hasEnvironmentKey: () => backend.hasEnvironmentKey(),
      getBackendMode: () => currentSettings().backend,
      restartBackend,
    },
    credentials,
    runInTerminal,
    promptForApiKey,
    broadcast: (message) => {
      registry.broadcast(message)
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
    [diagnosticsTool({ getDiagnostics: collectDiagnostics, workspaceRoot })],
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
  const editReview = new EditReview({
    platform: process.platform,
    workspaceRoot: workspaceRoot ?? '',
    readFile: readTextFile,
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
  const skillsHome = personalSkillsRoot({
    platform: process.platform,
    homeDir: homedir(),
    xdgConfigHome: process.env['XDG_CONFIG_HOME'],
  })
  const modelApi = new ModelApiBackendManager({
    log,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
    io: createToolIo({
      platform: process.platform,
      listFiles: listWorkspaceFiles,
      systemRoot: process.env['SystemRoot'],
      env: process.env,
      searchWorkerPath: vscode.Uri.joinPath(context.extensionUri, 'dist', SEARCH_WORKER_FILE)
        .fsPath,
    }),
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
          }),
  })
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
    host.onExit((description) => {
      for (const active of controllers.values()) {
        active.hostExited(description)
      }
    })
    return host
  }

  // Session history memory (M6): archived ids and the last session, per
  // workspace, in the extension's own `workspaceState`.
  const sessions: SessionMemory = {
    archivedIds: () =>
      archivedIdsSchema.parse(
        context.workspaceState.get<unknown>(WORKSPACE_STATE_KEYS.archivedSessions) ?? [],
      ),
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
    toRelativePath: (uri) => relativePathInWorkspace(vscode.Uri.parse(uri)),
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
        ideMcpEndpoint: () => ideServer.current,
        newAttachmentId: () => crypto.randomUUID(),
        sessions,
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
      if (auth.current.status === 'checking') {
        void auth.refresh().then(() => controller.restoreRecentSession())
      } else {
        void controller.restoreRecentSession()
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
    { dispose: () => void restartBackend() },
    vscode.window.registerWebviewViewProvider(
      CHAT_VIEW_ID,
      new ChatViewProvider(hostContext, registry),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        registry.broadcast({ type: 'settingsChanged', settings: hostContext.getSettings() })
      }
      // A host keeps its sandbox posture for life, and the backend choice
      // is made per host: drop them so the next message spawns afresh.
      const isBackendSetting = event.affectsConfiguration(BACKEND_SETTING)
      if (isBackendSetting) {
        void restartBackend().then(() => auth.refresh())
        return
      }
      if (!event.affectsConfiguration(SHELL_SANDBOX_SETTING) || !backend.isRunning) {
        return
      }
      void restartBackend()
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.sandboxRestartNotice })
    }),
    // Trust is a host-lifetime posture like the sandbox (PLAN.md D13): the
    // hosts restart so the next message loads the rules and skills.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void restartBackend()
      registry.broadcast({ type: 'notice', level: 'info', text: UI_TEXT.trustGrantedNotice })
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInNewTab, () => {
      openChatPanel(hostContext, registry)
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
          hasStoredApiKey: (await credentials.getApiKey()) !== undefined,
          hasEnvironmentApiKey: backend.hasEnvironmentKey(),
          dictation: dictation.isAvailable
            ? { isAvailable: true }
            : { isAvailable: false, reason: dictation.reason },
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
