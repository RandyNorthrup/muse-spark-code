// Extension host entry point. Kept to registration only; behaviour lives in
// src/host (VS Code adapters) and src/core (backend-agnostic logic).

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { ChatViewProvider } from './host/views/ChatViewProvider'
import { openChatPanel } from './host/views/chatPanel'
import type { WebviewHostContext } from './host/views/webviewSetup'
import { CHAT_VIEW_ID, COMMAND_IDS, PRODUCT_NAME } from './shared/constants'

// `context.extension.packageJSON` is typed `any` by VS Code; validate the one
// field we read instead of trusting it.
const packageManifestSchema = z.object({ version: z.string() })

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel(PRODUCT_NAME, { log: true })
  const { version } = packageManifestSchema.parse(context.extension.packageJSON)
  log.info(
    `Activating ${PRODUCT_NAME} ${version} (VS Code ${vscode.version}, Node ${process.versions.node})`,
  )

  const hostContext: WebviewHostContext = {
    extensionUri: context.extensionUri,
    extensionVersion: version,
    log,
  }

  context.subscriptions.push(
    log,
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, new ChatViewProvider(hostContext), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInNewTab, () => {
      openChatPanel(hostContext)
    }),
    vscode.commands.registerCommand(COMMAND_IDS.openInSidebar, () =>
      vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`),
    ),
  )
}
