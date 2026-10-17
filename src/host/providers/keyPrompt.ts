// The provider key's password box (M95 lane K, PLAN.md D74): **Enter
// key…** opens VS Code's password box with the preset's shape checked as it
// is typed. The key never enters the webview, and this module never logs it.

import type * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export interface ProviderKeyPrompt {
  /** The preset's name, as the box names it. */
  readonly providerName: string
  /** The address the credential is sent to, and no other. */
  readonly origin: string
  /** The key's documented shape, shown as the box's hint. */
  readonly keyHint: string
  /** The preset's live shape check, run as the key is typed. */
  isKeyShape(value: string): boolean
}

/**
 * Asks for a provider's key in the password box. The trimmed key, or
 * undefined when the box was dismissed or accepted empty.
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
    validateInput: (value) =>
      prompt.isKeyShape(value.trim())
        ? undefined
        : fill(UI_TEXT.providerKeyInvalid, { provider: prompt.providerName }),
  })
  if (entered === undefined) {
    return undefined
  }
  const key = entered.trim()
  return key === '' ? undefined : key
}
