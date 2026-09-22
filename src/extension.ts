// Extension host entry point. Kept to registration and adapter wiring; the
// behaviour lives in src/host (VS Code adapters) and src/core (pure logic).

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { MentionSource } from './core/mention'
import { insertMentionReference } from './host/commands/insertMention'
import { toggleInputFocus } from './host/commands/focusInput'
import { toggleFocusView } from './host/commands/toggleFocusView'
import { createLogger } from './host/logger'
import { readSettings, toSettingsSnapshot } from './host/settings'
import { ChatViewProvider } from './host/views/ChatViewProvider'
import { openChatPanel } from './host/views/chatPanel'
import { SurfaceRegistry } from './host/views/surfaceRegistry'
import type { WebviewHostContext } from './host/views/webviewSetup'
import {
  CHAT_VIEW_ID,
  COMMAND_IDS,
  CONTEXT_KEYS,
  PRODUCT_NAME,
  SETTINGS_SECTION,
  VSCODE_COMMANDS,
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

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel(PRODUCT_NAME, { log: true })
  const log = createLogger(channel)
  const { version } = packageManifestSchema.parse(context.extension.packageJSON)
  log.info(
    `Activating ${PRODUCT_NAME} ${version} (VS Code ${vscode.version}, Node ${process.versions.node}, ${process.platform})`,
  )

  const registry = new SurfaceRegistry()
  let isInputFocused = false
  const currentSettings = () =>
    readSettings(vscode.workspace.getConfiguration(SETTINGS_SECTION), log)

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
  }

  const openSidebar = () => vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`)

  context.subscriptions.push(
    channel,
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
