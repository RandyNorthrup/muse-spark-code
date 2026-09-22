// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import { execFile, type ExecFileException } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { CliInvocation } from './core/backends/musecode/sandbox'
import type { MentionSource } from './core/mention'
import { MentionIndex } from './core/mentionIndex'
import { AuthService } from './host/auth/authService'
import { CredentialStore, isValidModelApiKey } from './host/auth/credentialStore'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { type ProcessResult, SandboxSetup } from './host/backend/sandboxSetup'
import { insertMentionReference } from './host/commands/insertMention'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import {
  ConversationController,
  type FileAccess,
  type PickedFile,
} from './host/conversation/conversationController'
import { createLogger } from './host/logger'
import { pickMentionFile } from './host/mention/mentionQuickPick'
import { createWorkspaceFileLister } from './host/mention/workspaceFiles'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider } from './host/views/ChatViewProvider'
import { openChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface, WebviewHostContext } from './host/views/webviewSetup'
import {
  HAS_APPROVAL_UI,
  CHAT_VIEW_ID,
  CLI_OUTPUT_MAX_BYTES,
  COMMAND_IDS,
  CONTEXT_KEYS,
  DEFAULT_MODEL_ID,
  FIND_FILES_GLOB,
  GIT_OUTPUT_MAX_BYTES,
  GLOBAL_STATE_KEYS,
  MENTION_INDEX_LIMIT,
  MENTION_INDEX_TTL_MS,
  MUSE_LOGIN_TERMINAL_NAME,
  PRODUCT_NAME,
  SETTINGS_SECTION,
  UI_TEXT,
  VSCODE_COMMANDS,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
} from './shared/constants'
import type { HostAction } from './shared/protocol'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })

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
  const backend = new MuseCodeBackendManager({
    log,
    extensionVersion: version,
    getConfiguredBinaryPath: () => currentSettings().museBinaryPath,
    getEnvironmentVariables: () => currentSettings().environmentVariables,
    getApiKey: () => credentials.getApiKey(),
    workspaceRoot,
  })
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
      restartBackend: async () => {
        for (const controller of controllers.values()) {
          controller.dispose()
        }
        await backend.dispose()
      },
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

  const mentions = new MentionIndex({
    listFiles: createWorkspaceFileLister({
      workspaceRoot: workspaceRoot ?? '',
      respectGitIgnore: () => currentSettings().respectGitIgnore,
      runGit,
      findFiles: findWorkspaceFiles,
      log,
    }),
    now: () => Date.now(),
    ttlMs: MENTION_INDEX_TTL_MS,
    limit: MENTION_INDEX_LIMIT,
    log,
  })

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
    }
  }

  const controllerFor = (surface: ChatSurface): ConversationController => {
    let controller = controllers.get(surface.id)
    if (controller === undefined) {
      controller = new ConversationController({
        surface,
        auth,
        ensureHost: async () => {
          const host = await backend.ensureHost()
          host.onExit((description) => {
            for (const active of controllers.values()) {
              active.hostExited(description)
            }
          })
          return host
        },
        workspaceRoot,
        modelId: DEFAULT_MODEL_ID,
        initialPermissionMode: currentSettings().initialPermissionMode,
        hasApprovalUi: HAS_APPROVAL_UI,
        openExternal: (url) => {
          void vscode.env.openExternal(vscode.Uri.parse(url))
        },
        mentions: { search: (query, limit) => mentions.search(query, limit) },
        files,
        isBypassAllowed: () => currentSettings().allowDangerouslySkipPermissions,
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
        newAttachmentId: () => crypto.randomUUID(),
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
      controllerFor(surface).surfaceReady()
      if (auth.current.status === 'checking') {
        void auth.refresh()
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

  context.subscriptions.push(
    channel,
    fileWatcher,
    fileWatcher.onDidCreate(() => {
      mentions.invalidate()
    }),
    fileWatcher.onDidDelete(() => {
      mentions.invalidate()
    }),
    { dispose: () => void backend.dispose() },
    vscode.window.registerWebviewViewProvider(
      CHAT_VIEW_ID,
      new ChatViewProvider(hostContext, registry),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        registry.broadcast({ type: 'settingsChanged', settings: hostContext.getSettings() })
      }
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInNewTab, () => {
      openChatPanel(hostContext, registry)
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInSidebar, openSidebar),
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
