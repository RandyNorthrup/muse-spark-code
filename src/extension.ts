// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { MentionSource } from './core/mention'
import { AuthService } from './host/auth/authService'
import { CredentialStore, isValidModelApiKey } from './host/auth/credentialStore'
import { MuseCodeBackendManager } from './host/backend/museCodeBackendManager'
import { insertMentionReference } from './host/commands/insertMention'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import { ConversationController } from './host/conversation/conversationController'
import { createLogger } from './host/logger'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider } from './host/views/ChatViewProvider'
import { openChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { ChatSurface, WebviewHostContext } from './host/views/webviewSetup'
import {
  CHAT_VIEW_ID,
  COMMAND_IDS,
  CONTEXT_KEYS,
  DEFAULT_MODEL_ID,
  M2_APPROVAL_MODE,
  MUSE_LOGIN_TERMINAL_NAME,
  PRODUCT_NAME,
  SETTINGS_SECTION,
  UI_TEXT,
  VSCODE_COMMANDS,
  WINDOWS_POWERSHELL_TERMINAL_PATH,
} from './shared/constants'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })

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
        approvalMode: M2_APPROVAL_MODE,
        openExternal: (url) => {
          void vscode.env.openExternal(vscode.Uri.parse(url))
        },
        log,
      })
      controllers.set(surface.id, controller)
    }
    return controller
  }

  const hostContext: WebviewHostContext = {
    extensionUri: context.extensionUri,
    extensionVersion: version,
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
    onOpenNewTab: () => {
      openChatPanel(hostContext, registry)
    },
    onSurfaceReady: (surface) => {
      controllerFor(surface).surfaceReady()
      if (auth.current.status === 'checking') {
        void auth.refresh()
      }
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

  context.subscriptions.push(
    channel,
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
      await toggleFocusView({
        isFocusViewEnabled: () => currentSettings().focusView,
        setFocusViewEnabled: (isEnabled) =>
          vscode.workspace
            .getConfiguration(SETTINGS_SECTION)
            .update('focusView', isEnabled, vscode.ConfigurationTarget.Global),
      })
    }),
  )
}
