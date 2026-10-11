// Editor-tab surface ("Open in New Tab"). Each panel is an independent
// conversation, mirroring the Claude Code extension's tab model: the tab is
// named after the conversation and carries an unread mark while something
// happened behind it (M6). After a window reload VS Code rebuilds the panel
// through the serializer registered in extension.ts and hands back the
// state the webview stored (its session id), so the tab resumes its
// conversation (PLAN.md D15). A tab becomes the surface the keybindings act
// on when it turns active or its document takes focus (M25).

import * as vscode from 'vscode'
import { plural } from '../../shared/l10n/text'
import { CHAT_PANEL_VIEW_TYPE, UI_TEXT } from '../../shared/constants'
import { parsePersistedState } from '../../shared/protocol'
import { observeOpenQuestionCount } from './ChatViewProvider'
import type { SurfaceRegistry } from './surfaceRegistry'
import { configureWebview, type WebviewHostContext } from './webviewSetup'

function attachChatPanel(
  panel: vscode.WebviewPanel,
  context: WebviewHostContext,
  registry: SurfaceRegistry,
  restoredSessionId: string | undefined,
  isSideChat = false,
  onDisposed?: () => void,
  surfaceId = `panel:${globalThis.crypto.randomUUID()}`,
): void {
  // A restored panel keeps the title VS Code saved, unread mark included.
  let title = panel.title.startsWith(UI_TEXT.unreadMark)
    ? panel.title.slice(UI_TEXT.unreadMark.length)
    : panel.title
  let isUnread = false
  let openCount = 0
  const applyTitle = () => {
    const counted =
      openCount === 0 ? title : `${title} · ${plural(UI_TEXT.openQuestionsTabCount, openCount)}`
    panel.title = isUnread ? `${UI_TEXT.unreadMark}${counted}` : counted
  }
  const surface = configureWebview(panel.webview, context, {
    id: surfaceId,
    restoredSessionId,
    isSideChat,
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
      title = isSideChat ? `${UI_TEXT.sideChatTitle}: ${name}` : name
      applyTitle()
    },
    onFocused: (focused) => {
      registry.setActive(focused)
    },
  })
  observeOpenQuestionCount(surface, restoredSessionId, (count) => {
    openCount = count
    applyTitle()
  })
  const registration = registry.add(surface)
  registry.setActive(surface)
  panel.onDidChangeViewState((event) => {
    if (!event.webviewPanel.active) {
      return
    }
    registry.setActive(surface)
    if (!isUnread) {
      return
    }
    isUnread = false
    applyTitle()
  })
  panel.onDidDispose(() => {
    registration.dispose()
    surface.dispose()
    onDisposed?.()
  })
}

export interface NewChatPanelOptions {
  /** The new surface's id, when a caller must know it before the panel is ready (M107 Show). */
  readonly surfaceId?: string
  readonly sessionId?: string
  readonly isSideChat?: boolean
  readonly onDisposed?: () => void
}

export function openChatPanel(
  context: WebviewHostContext,
  registry: SurfaceRegistry,
  options: NewChatPanelOptions = {},
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    CHAT_PANEL_VIEW_TYPE,
    options.isSideChat === true ? UI_TEXT.sideChatTitle : UI_TEXT.untitledConversation,
    vscode.ViewColumn.Beside,
    { retainContextWhenHidden: true },
  )
  attachChatPanel(
    panel,
    context,
    registry,
    options.sessionId,
    options.isSideChat,
    options.onDisposed,
    options.surfaceId,
  )
  return panel
}

/**
 * A panel VS Code rebuilt after a window reload: wired like a new one, and
 * resuming the session the webview had stored, if the state is one of ours.
 */
export function restoreChatPanel(
  panel: vscode.WebviewPanel,
  state: unknown,
  context: WebviewHostContext,
  registry: SurfaceRegistry,
): void {
  const persisted = parsePersistedState(state)
  attachChatPanel(panel, context, registry, persisted.sessionId, persisted.sideChat)
}
