// Sidebar surface: the `museSpark.chatView` WebviewView contributed in
// package.json. The editor-tab surface lives in chatPanel.ts; both share
// configureWebview.

import type * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import type { SurfaceRegistry } from './surfaceRegistry'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

export const SIDEBAR_SURFACE_ID = 'sidebar'
const UNREAD_BADGE_VALUE = 1

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public constructor(
    private readonly context: WebviewHostContext,
    private readonly registry: SurfaceRegistry,
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    const surface = configureWebview(view.webview, this.context, {
      id: SIDEBAR_SURFACE_ID,
      restoredSessionId: undefined,
      reveal: () => {
        view.show(false)
      },
      // The unread dot of Claude Code's sidebar: a badge on the view while it
      // is hidden, cleared as soon as it is shown again (M6).
      markUnread: () => {
        if (!view.visible) {
          view.badge = { tooltip: UI_TEXT.unreadTooltip, value: UNREAD_BADGE_VALUE }
        }
      },
      setTitle: (title) => {
        view.description = title === UI_TEXT.untitledConversation ? '' : title
      },
    })
    const registration = this.registry.add(surface)
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        view.badge = undefined
      }
    })
    view.onDidDispose(() => {
      registration.dispose()
      surface.dispose()
    })
  }
}
