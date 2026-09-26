// The handle the rest of the host talks to one chat UI through (the sidebar
// view or an editor panel). It carries no VS Code type, so the conversation
// controller and the commands that take a surface run in any host (M61,
// PLAN.md D60); webviewSetup.ts makes VS Code's.

import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/protocol'

/** Messages about the conversation itself, routed to the surface's controller. */
export type ConversationMessage = Exclude<
  WebviewToHostMessage,
  | { type: 'ready' }
  | { type: 'inputFocusChanged' }
  | { type: 'surfaceFocused' }
  | { type: 'webviewError' }
>

/** One chat UI instance (the sidebar view or one editor panel). */
export interface ChatSurface {
  readonly id: string
  post(message: HostToWebviewMessage): void
  /** Bring the surface into view and give it keyboard focus. */
  reveal(): void
  /** The conversation needs the user (turn done, approval, question): mark it when hidden (M6). */
  markUnread(): void
  /** The conversation's name, shown on the tab or beside the view name (M6). */
  setTitle(title: string): void
  /** Rebuild the document with a fresh nonce (the error boundary's Reload, M11). */
  reload(): void
  /**
   * The session a panel held before the window reloaded (D15), until it is
   * live here (its history went to the webview, or another session started)
   * or the user clears the conversation (M25): every `ready` until then may
   * try the resume again, so a failed one is not the end of the conversation.
   */
  takeRestoredSessionId(): string | undefined
  /** Stop handling the surface's messages. */
  dispose(): void
}
