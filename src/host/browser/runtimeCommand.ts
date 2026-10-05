// "Download Browser Check Runtime" (M81 A1, design spec v4 §4.1): prepares
// and verifies the pinned runtime through the same lazy runtime entry and
// preparation lifetime as a check (browserChecks.ts), never a second
// installer, and never opens a page. Native, cancellable progress; the
// outcome in the user's language. Refused before any download in Restricted
// Mode, under a restricted network setting, or with the runtime setting off.

import * as vscode from 'vscode'
import { browserRefusal } from '../../core/browser/browserTool'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { BrowserChecks } from './browserChecks'

export async function downloadBrowserRuntime(
  checks: BrowserChecks,
  isOffered: () => boolean,
): Promise<void> {
  if (!isOffered()) {
    void vscode.window.showWarningMessage(UI_TEXT.browserCheckNotOffered)
    return
  }
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: UI_TEXT.browserRuntimePreparing,
      cancellable: true,
    },
    async (_progress, token) => {
      const stop = new AbortController()
      const subscription = token.onCancellationRequested(() => {
        stop.abort()
      })
      try {
        return await checks.prepareOnly(stop.signal, () => (isOffered() ? 'ok' : 'notOffered'))
      } finally {
        subscription.dispose()
      }
    },
  )
  if (result.ok) {
    void vscode.window.showInformationMessage(
      fill(UI_TEXT.browserRuntimeReady, { version: result.runtime.version }),
    )
    return
  }
  void vscode.window.showWarningMessage(browserRefusal({ kind: result.reason }).user)
}
