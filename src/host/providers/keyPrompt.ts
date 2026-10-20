// The provider key's password box (M95 lane K, PLAN.md D74): **Enter
// key…** opens VS Code's password box. Any non-blank key is accepted: the
// provider judges it through the free key test, never its looks. The key
// never enters the webview, and this module never logs it.

import type * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export interface ProviderKeyPrompt {
  /** The preset's name, as the box names it. */
  readonly providerName: string
  /** The address the credential is sent to, and no other. */
  readonly origin: string
  /** Where the key comes from, shown as the box's hint. */
  readonly keyHint: string
}

/**
Asks for a provider's key in the password box. The trimmed key, or
undefined when the box was dismissed or accepted empty.
*/
export async function promptForProviderKey(
  showInputBox: typeof vscode.window.showInputBox,
  prompt: ProviderKeyPrompt,
): Promise<string | undefined> {
  const entered = await showInputBox({
    title: fill(UI_TEXT.providerKeyPrompt, { provider: prompt.providerName }),
    prompt: fill(UI_TEXT.keyStoredNote, { origin: prompt.origin }),
    placeHolder: prompt.keyHint,
    password: true,
    ignoreFocusOut: true,
  })
  if (entered === undefined) {
    return undefined
  }
  const key = entered.trim()
  return key === '' ? undefined : key
}
