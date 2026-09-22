// Editor-tab surface ("Open in New Tab"). Each panel is an independent
// conversation, mirroring the Claude Code extension's tab model.

import * as vscode from 'vscode'
import { CHAT_PANEL_VIEW_TYPE, UI_TEXT } from '../../shared/constants'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

export function openChatPanel(context: WebviewHostContext): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    CHAT_PANEL_VIEW_TYPE,
    UI_TEXT.untitledConversation,
    vscode.ViewColumn.Beside,
    { retainContextWhenHidden: true },
  )
  const messages = configureWebview(panel.webview, context)
  panel.onDidDispose(() => {
    messages.dispose()
  })
  return panel
}
