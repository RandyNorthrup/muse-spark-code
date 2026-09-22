// Editor-tab surface ("Open in New Tab"). Each panel is an independent
// conversation, mirroring the Claude Code extension's tab model: the tab is
// named after the conversation and carries an unread mark while something
// happened behind it (M6).

import * as vscode from 'vscode'
import { CHAT_PANEL_VIEW_TYPE, UI_TEXT } from '../../shared/constants'
import type { SurfaceRegistry } from './surfaceRegistry'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

export function openChatPanel(
  context: WebviewHostContext,
  registry: SurfaceRegistry,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    CHAT_PANEL_VIEW_TYPE,
    UI_TEXT.untitledConversation,
    vscode.ViewColumn.Beside,
    { retainContextWhenHidden: true },
  )
  let title: string = UI_TEXT.untitledConversation
  let isUnread = false
  const applyTitle = () => {
    panel.title = isUnread ? `${UI_TEXT.unreadMark}${title}` : title
  }
  const surface = configureWebview(panel.webview, context, {
    id: `panel:${globalThis.crypto.randomUUID()}`,
    reveal: () => {
      panel.reveal(undefined, false)
    },
    markUnread: () => {
      if (panel.active) {
        return
      }
      isUnread = true
      applyTitle()
    },
    setTitle: (name) => {
      title = name
      applyTitle()
    },
  })
  const registration = registry.add(surface)
  registry.setActive(surface)
  panel.onDidChangeViewState((event) => {
    if (!isUnread || !event.webviewPanel.active) {
      return
    }
    isUnread = false
    applyTitle()
  })
  panel.onDidDispose(() => {
    registration.dispose()
    surface.dispose()
  })
  return panel
}
