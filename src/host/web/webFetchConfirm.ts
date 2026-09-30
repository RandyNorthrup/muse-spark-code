// The extension's own question before Muse Code's web fetch (M69, PLAN.md
// D49): a native modal naming the host and the URL, asked for every call,
// whatever mode Muse Code runs in (its approval covers using the tool; this
// one covers the extension sending the request from the user's machine).
// Closing it is Reject.

import * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export async function isWebFetchAllowed(url: string, host: string): Promise<boolean> {
  const allow: vscode.MessageItem = { title: UI_TEXT.allowOnce }
  const reject: vscode.MessageItem = { title: UI_TEXT.reject, isCloseAffordance: true }
  const answer = await vscode.window.showWarningMessage(
    fill(UI_TEXT.webFetchConfirmTitle, { host }),
    { modal: true, detail: fill(UI_TEXT.webFetchConfirmDetail, { url, host }) },
    allow,
    reject,
  )
  return answer === allow
}
