// Sidebar surface: the `museSpark.chatView` WebviewView contributed in
// package.json. The editor-tab surface lives in chatPanel.ts; both share
// configureWebview. The view becomes the surface the keybindings act on when
// it is shown or its document takes focus (M25).

import type * as vscode from 'vscode'
import { plural } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import type { ChatSurface } from './chatSurface'
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
    let openCount = 0
    let isUnread = false
    const applyBadge = () => {
      const unread = isUnread
        ? { tooltip: UI_TEXT.unreadTooltip, value: UNREAD_BADGE_VALUE }
        : undefined
      view.badge =
        openCount > 0
          ? { tooltip: plural(UI_TEXT.openQuestionsCount, openCount), value: openCount }
          : unread
    }
    const surface = configureWebview(view.webview, this.context, {
      id: SIDEBAR_SURFACE_ID,
      restoredSessionId: undefined,
      reveal: () => {
        view.show(false)
      },
      // The unread dot of Claude Code's sidebar: a badge on the view while it
      // is hidden, cleared as soon as it is shown again (M6).
      markUnread: () => {
        if (view.visible) {
          return
        }

        isUnread = true
        applyBadge()
      },
      setTitle: (title) => {
        view.description = title === UI_TEXT.untitledConversation ? '' : title
      },
      onFocused: (focused) => {
        this.registry.setActive(focused)
      },
    })
    observeOpenQuestionCount(surface, undefined, (count, isCleared) => {
      openCount = count
      if (isCleared) isUnread = false
      applyBadge()
    })
    const registration = this.registry.add(surface)
    view.onDidChangeVisibility(() => {
      if (!view.visible) {
        return
      }
      isUnread = false
      applyBadge()
      this.registry.setActive(surface)
    })
    view.onDidDispose(() => {
      registration.dispose()
      surface.dispose()
    })
  }
}

/** One session-aware count observer shared by sidebar and editor tabs. */
export function observeOpenQuestionCount(
  surface: ChatSurface,
  initialSessionId: string | undefined,
  onChange: (count: number, isCleared: boolean) => void,
): void {
  let sessionId = initialSessionId
  const post = surface.post.bind(surface)
  surface.post = (message) => {
    switch (message.type) {
      case 'sessionInfo':
      case 'historyLoaded':
      case 'surfaceState': {
        if (sessionId !== message.sessionId) {
          sessionId = message.sessionId
          onChange(0, false)
        }
        break
      }
      case 'conversationCleared': {
        sessionId = undefined
        onChange(0, true)
        break
      }
      case 'openQuestions': {
        if (message.snapshot.sessionId !== sessionId) break
        onChange(
          message.snapshot.questions.filter((question) => question.state === 'open').length,
          false,
        )
        break
      }
      default: {
        break
      }
    }
    post(message)
  }
}
