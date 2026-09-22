// Sidebar surface: the `museSpark.chatView` WebviewView contributed in
// package.json. The editor-tab surface lives in chatPanel.ts; both share
// configureWebview.

import type * as vscode from 'vscode'
import type { SurfaceRegistry } from './surfaceRegistry'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

export const SIDEBAR_SURFACE_ID = 'sidebar'

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public constructor(
    private readonly context: WebviewHostContext,
    private readonly registry: SurfaceRegistry,
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    const surface = configureWebview(view.webview, this.context, {
      id: SIDEBAR_SURFACE_ID,
      reveal: () => {
        view.show(false)
      },
    })
    const registration = this.registry.add(surface)
    view.onDidDispose(() => {
      registration.dispose()
      surface.dispose()
    })
  }
}
