// The extension's own question before Muse Code's browser check (M81,
// PLAN.md D49): a native modal naming the URL, asked for every call,
// whatever mode Muse Code runs in (its approval covers using the tool; this
// one covers the extension starting a browser on the user's machine). When
// the host is beyond loopback and the user's setting, it says so: allowing
// then widens this one check to that host. Closing it is Reject.

import * as vscode from 'vscode'
import type { BrowserCheckScope } from '../../core/browser/browserTool'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export async function isBrowserCheckAllowed(
  url: string,
  { widenedHost }: BrowserCheckScope,
): Promise<boolean> {
  const allow: vscode.MessageItem = { title: UI_TEXT.allowOnce }
  const reject: vscode.MessageItem = { title: UI_TEXT.reject, isCloseAffordance: true }
  const detail =
    widenedHost === undefined
      ? UI_TEXT.browserCheckConfirmDetail
      : `${fill(UI_TEXT.browserCheckConfirmDetailWiden, { host: widenedHost })}\n\n${UI_TEXT.browserCheckConfirmDetail}`
  const answer = await vscode.window.showWarningMessage(
    fill(UI_TEXT.browserCheckConfirmTitle, { url }),
    { modal: true, detail },
    allow,
    reject,
  )
  return answer === allow
}
