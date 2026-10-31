import { estimateFailureText } from '../../../shared/estimateDiagnostic'
// Shared wiring for both webview surfaces (sidebar view and editor panel):
// options, HTML with a fresh CSP nonce and document id (M107), the inbound message handler, and the
// `ChatSurface` handle (chatSurface.ts) the rest of the host uses to talk back.

import * as vscode from 'vscode'
import { failureForLog } from '../../../core/backends/musecode/logText'
import { UI_TEXT, WEBVIEW_SCRIPT_FILE, WEBVIEW_STYLE_FILE } from '../../../shared/constants'
import {
  type HostToWebviewMessage,
  parseWebviewToHostMessage,
  isEstimatorWebviewMessage,
  type SettingsSnapshot,
} from '../../../shared/protocol'
import { composerPlaceholderFor } from '../../views/composerPlaceholder'
import { buildWebviewHtml, createNonce } from '../../html'
import type { UiTable } from '../../l10n'
import type { Logger } from '../../logger'
import type { ChatSurface, ConversationMessage } from '../../views/chatSurface'
import { mintFocusRequest, shouldDeliverFocusInput } from '../../views/focusGate'
import { webviewBundleErrorHtml, type WebviewBundleResolution } from '../../views/webviewBundle'
import { resolveWebviewBundleDir, WebviewBundleError } from '../../views/webviewBundleRoot'
import { webviewErrorLog } from '../../views/webviewErrors'

export interface WebviewHostContext {
  readonly extensionUri: vscode.Uri
  /** The machine's storage for the verified webview copy (VSIXWEB A). */
  readonly globalStoragePath: string
  /** The verified webview copy (VSIXWEB A), resolved in the activation bundle. */
  readonly resolveWebviewBundle: () => WebviewBundleResolution
  /** The display language's table, installed at activation, for every webview's HTML (D33). */
  readonly l10n: UiTable
  readonly log: Logger
  readonly getSettings: () => SettingsSnapshot
  readonly onInputFocusChanged: (surface: ChatSurface, isFocused: boolean) => void
  /** The webview mounted and received `init`; push the conversation state. */
  readonly onSurfaceReady: (surface: ChatSurface, attachmentEpoch?: number) => void
  readonly onConversationMessage: (surface: ChatSurface, message: ConversationMessage) => void
}

export interface SurfaceOptions {
  readonly id: string
  readonly isSideChat?: boolean
  /** The session id a deserialized panel stored; undefined for a new surface. */
  readonly restoredSessionId: string | undefined
  readonly reveal: () => void
  /**
  Whether this surface is the active one for a focus decision (panel-focus
  F3): the panel's `active`, the sidebar's `visible`. Absent in tests,
  where every surface counts as active.
  */
  readonly isVisible?: () => boolean
  readonly isActive?: () => boolean
  readonly markUnread: () => void
  readonly setTitle: (title: string) => void
  /** The document gained focus (M25): the surface the keybindings act on. */
  readonly onFocused: (surface: ChatSurface) => void
}

/**
Whether a message ends the restore a panel is owed (M25): a session is
live on the surface (its history went out, or a new one started), or the
conversation was cleared (from the panel or a keybinding).
*/
function isRestoreEnding(message: HostToWebviewMessage): boolean {
  return (
    message.type === 'historyLoaded' ||
    message.type === 'conversationCleared' ||
    (message.type === 'sessionInfo' && message.sessionId !== undefined)
  )
}

function buildInitMessage(context: WebviewHostContext, isSideChat: boolean): HostToWebviewMessage {
  return {
    type: 'init',
    emptyStateHint: UI_TEXT.emptyStateHint,
    composerPlaceholder: composerPlaceholderFor(process.platform),
    settings: isSideChat
      ? { ...context.getSettings(), initialPermissionMode: 'plan' }
      : context.getSettings(),
    ...(isSideChat && { sideChat: true }),
  }
}

/**
A surface with no verified bundle behind it (VSIXWEB A): the panel shows
the fixed sentence, messages drop, and revealing still brings the failure
into view. Reload and dispose stay quiet; a fresh surface (a reopened
panel) retries the bundle.
*/
function inertSurface(options: SurfaceOptions): ChatSurface {
  return {
    id: options.id,
    isSideChat: options.isSideChat === true,
    documentId: '',
    post() {
      // No verified bundle behind the surface: outbound messages drop.
    },
    reveal: () => {
      options.reveal()
    },
    markUnread() {
      // Nothing unread or titled without a document.
    },
    setTitle() {
      // Nothing unread or titled without a document.
    },
    reload() {
      // A reopened panel retries the bundle; the dead document never rebuilds.
    },
    takeRestoredSessionId: () => options.restoredSessionId,
    dispose() {
      // Nothing subscribed, so nothing to stop.
    },
  }
}

/**
Configures `webview` and starts handling its messages. Disposing the
returned surface stops the message handling; callers tie it to the owning
view's or panel's `onDidDispose`.
*/
export function configureWebview(
  webview: vscode.Webview,
  context: WebviewHostContext,
  options: SurfaceOptions,
): ChatSurface {
  // The verified webview copy (VSIXWEB A): a packaged install extracts it
  // once per archive digest into global storage, the source tree serves its
  // loose files. A missing, damaged or unwritable extraction shows the
  // fixed sentence and drops messages, never unverified files.
  let bundleRoot: vscode.Uri
  try {
    bundleRoot = vscode.Uri.file(
      resolveWebviewBundleDir({
        extensionPath: context.extensionUri.fsPath,
        globalStoragePath: context.globalStoragePath,
      }),
    )
  } catch (error: unknown) {
    if (!(error instanceof WebviewBundleError)) throw error
    context.log.error(`Chat webview bundle failed: ${failureForLog(error)}`)
    webview.options = { enableScripts: true, localResourceRoots: [] }
    webview.html = webviewBundleErrorHtml(UI_TEXT.webviewBundleUnavailable, context.l10n.locale)
    return inertSurface(options)
  }
  webview.options = { enableScripts: true, localResourceRoots: [bundleRoot] }
  // M107: each build names its document; the id it returns is the only current one.
  const buildDocument = (): string => {
    const documentId = createNonce()
    webview.html = buildWebviewHtml({
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_SCRIPT_FILE))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_STYLE_FILE))
        .toString(),
      cspSource: webview.cspSource,
      nonce: createNonce(),
      l10n: context.l10n,
      documentId,
    })
    return documentId
  }
  let documentId = buildDocument()

  let restoredSessionId = options.restoredSessionId
  let isFocused = false
  let isActive = true
  let estimatorGeneration = 0
  // When the person last revealed this surface: a `focusInput` posted just
  // after still delivers while the reveal's own focus propagates.
  let revealedAt: number | undefined
  const surface: ChatSurface = {
    id: options.id,
    isApprovalPresent: () =>
      isFocused && options.isVisible?.() === true && (options.isActive?.() ?? true),
    isSideChat: options.isSideChat === true,
    get documentId() {
      return documentId
    },
    post(message) {
      if (message.type === 'conversationCleared' || message.type === 'historyLoaded')
        estimatorGeneration++
      if (isRestoreEnding(message)) {
        restoredSessionId = undefined
      }
      // The single host gate every sender's `focusInput` passes through
      // (panel-focus F3): Focus Input, the deferred mention flush, and any
      // later asker. The ask is owned (it carries the minted token) only
      // while its panel is the active one; otherwise it is dropped here,
      // never held.
      let outbound = message
      if (message.type === 'focusInput') {
        const now = Date.now()
        if (!shouldDeliverFocusInput(options.isActive?.() ?? true, revealedAt, now)) {
          return
        }
        outbound = { ...message, ...mintFocusRequest(now, () => globalThis.crypto.randomUUID()) }
      }
      void webview.postMessage(outbound)
    },
    reveal: () => {
      revealedAt = Date.now()
      options.reveal()
    },
    markUnread: options.markUnread,
    setTitle: options.setTitle,
    reload: () => {
      documentId = buildDocument()
    },
    takeRestoredSessionId() {
      return restoredSessionId
    },
    dispose() {
      isActive = false
      estimatorGeneration++
      subscription.dispose()
    },
  }

  const logWebviewError = webviewErrorLog(context.log, Date.now)
  const subscription = webview.onDidReceiveMessage((raw: unknown) => {
    if (isEstimatorWebviewMessage(raw)) {
      const generation = estimatorGeneration
      void import('../../../shared/estimatorProtocol')
        .then((parser) => {
          if (!isActive || generation !== estimatorGeneration) return
          const parsed = parser.parseEstimatorToHostMessage(raw)
          if (!parsed.ok) {
            context.log.warn(`Dropped malformed webview message: ${parsed.error}`)
            surface.post({
              type: 'estimatorFailure',
              diagnostic: { estimateDiagnostic: 'invalid-input' },
            })
            surface.post({
              type: 'estimatorStarted',
              diagnostic: { estimateDiagnostic: 'invalid-input' },
            })
            return
          }
          context.onConversationMessage(surface, parsed.message)
        })
        .catch((error: unknown) => {
          if (!isActive || generation !== estimatorGeneration) {
            context.log.warn(`Estimator boundary unavailable: ${failureForLog(error)}`)
            return
          }
          context.log.error(`Estimator boundary unavailable: ${failureForLog(error)}`)
          surface.post({
            type: 'estimatorFailure',
            diagnostic: { estimateDiagnostic: 'estimate-unavailable' },
          })
          surface.post({
            type: 'estimatorStarted',
            diagnostic: { estimateDiagnostic: 'estimate-unavailable' },
          })
          surface.post({
            type: 'notice',
            level: 'warning',
            text: estimateFailureText({ estimateDiagnostic: 'estimate-unavailable' }),
          })
        })
      return
    }
    const parsed = parseWebviewToHostMessage(raw)
    if (!parsed.ok) {
      context.log.warn(`Dropped malformed webview message: ${parsed.error}`)
      return
    }
    const { message } = parsed
    if (message.type === 'clearConversation') estimatorGeneration++
    switch (message.type) {
      case 'ready': {
        surface.post(buildInitMessage(context, surface.isSideChat === true))
        context.onSurfaceReady(surface, message.attachmentEpoch)
        break
      }
      case 'inputFocusChanged': {
        context.onInputFocusChanged(surface, message.focused)
        break
      }
      case 'surfaceFocused': {
        isFocused = message.focused ?? true
        if (isFocused) options.onFocused(surface)
        break
      }
      case 'webviewError': {
        logWebviewError(message)
        break
      }
      default: {
        context.onConversationMessage(surface, message)
      }
    }
  })

  return surface
}
