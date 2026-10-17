import * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { type UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { VaultPanelHost, type VaultPanelHostDeps } from './vaultPanelHost'
import { editVaultItem, type VaultNativeInput } from './vaultNativeEditor'

import { VAULT_COMMANDS, type VaultWindowControls } from './vaultPanelBundle'

export interface VaultPanelEntryDeps extends Omit<
  VaultPanelHostDeps,
  'editItem' | 'confirmRemove' | 'copyPublicKey' | 'status' | 'showError'
> {
  readonly openPanel: () => Promise<void>
  readonly sshKey: VaultNativeInput['sshKey']
}

/** W loads dist/vault.js on first need, then binds C/B/P/M and M95's panel to this factory. */
export function createVaultPanelHost(
  deps: VaultPanelEntryDeps,
  table: UiText,
  locale: string,
): { host: VaultPanelHost } & VaultWindowControls {
  setUiText(table, locale)
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  status.text = `$(lock) ${UI_TEXT.vault.lock}`
  status.tooltip = UI_TEXT.vault.unlocked
  status.command = VAULT_COMMANDS.lock
  const host = new VaultPanelHost({
    ...deps,
    editItem: async (current, signal) => {
      const cancellation = new vscode.CancellationTokenSource()
      const abort = () => {
        cancellation.cancel()
      }
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await editVaultItem(
          {
            input: async (options) =>
              await vscode.window.showInputBox(
                { ...options, ignoreFocusOut: true },
                cancellation.token,
              ),
            pick: async (options) => {
              const picked = await vscode.window.showQuickPick(
                [...options],
                { ignoreFocusOut: true },
                cancellation.token,
              )
              return picked?.id
            },
            sshKey: deps.sshKey,
            now: deps.now,
          },
          current,
          signal,
        )
      } finally {
        signal.removeEventListener('abort', abort)
        cancellation.dispose()
      }
    },
    confirmRemove: async (item) =>
      (await vscode.window.showWarningMessage(
        `${UI_TEXT.vault.remove}: ${item.label}`,
        { modal: true },
        UI_TEXT.vault.remove,
      )) === UI_TEXT.vault.remove,
    copyPublicKey: async (key) => {
      await vscode.env.clipboard.writeText(key)
    },
    showError: (message) => {
      void vscode.window.showErrorMessage(message)
    },
    status: (unlocked) => {
      if (unlocked) status.show()
      else status.hide()
    },
  })
  return {
    host,
    open: async () => {
      await deps.openPanel()
      await host.refresh()
    },
    lock: async () => {
      await host.lock()
    },
    dispose: () => {
      host.dispose()
      status.dispose()
    },
  }
}
