// Sidebar surface: the `museSpark.chatView` WebviewView contributed in
// package.json. The editor-tab surface lives in chatPanel.ts; both share
// configureWebview.

import type * as vscode from 'vscode'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public constructor(private readonly context: WebviewHostContext) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    const messages = configureWebview(view.webview, this.context)
    view.onDidDispose(() => {
      messages.dispose()
    })
  }
}
