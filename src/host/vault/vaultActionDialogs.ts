// The vault's explicit-action dialogs (RVAPP-CM1091D5 BYTES): the native
// Add/Edit editor wrapper and the Reset, Setup/recovery-code and Import
// Keep/Delete prompts. They load on first use as part of dist/vaultActions.js,
// never with the opening bundle; only the small confirm/remove/copy/error
// channel stays in vaultPanelEntry.ts.
import * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { VaultItem, VaultItemMetadata } from '../../shared/vault'
import type { VaultPanelHostDeps } from './vaultPanelHost'
import { editVaultItem, type VaultNativeInput } from './vaultNativeEditor'

export interface VaultActionDialogDeps {
  readonly now: () => number
  readonly sshKey: VaultNativeInput['sshKey']
}

export function vaultActionDialogs(
  deps: VaultActionDialogDeps,
): Pick<VaultPanelHostDeps, 'importDone' | 'confirmReset' | 'showRecoveryCode' | 'editItem'> {
  return {
    importDone: async (names) => {
      // Names and kinds only: never a value (lead decision, C-M109-1).
      const choice = await vscode.window.showInformationMessage(
        fill(UI_TEXT.vault.importedSummary, { names: names.join(', ') }),
        { modal: true, detail: UI_TEXT.vault.importKeepOrDelete },
        UI_TEXT.vault.keepFile,
        UI_TEXT.vault.deleteFile,
      )
      return choice === UI_TEXT.vault.deleteFile ? 'delete' : 'keep'
    },
    confirmReset: async (word, signal, warning) => {
      // Step 1: what a reset erases, stated plainly; step 2: the typed word.
      // An unknown writer's holder facts ride beside the warning when the
      // broker names one (the lease line's confirmed-recovery warning).
      const detail =
        warning === undefined
          ? UI_TEXT.vault.resetWarning
          : [UI_TEXT.vault.resetWarning, warning].join('\n\n')
      const proceed = await vscode.window.showWarningMessage(
        UI_TEXT.vault.resetVault,
        { modal: true, detail },
        UI_TEXT.vault.resetContinue,
      )
      if (proceed !== UI_TEXT.vault.resetContinue || signal.aborted) return null
      const prompt = fill(UI_TEXT.vault.resetTypeWord, { word })
      const typed = await vscode.window.showInputBox({
        prompt,
        ignoreFocusOut: true,
        validateInput: (value) => (value === word ? null : prompt),
      })
      return typed ?? null
    },
    showRecoveryCode: async (code, signal) => {
      // Shown once, with Copy and I Saved It, before the vault exists (lead decision 8).
      while (!signal.aborted) {
        const choice = await vscode.window.showWarningMessage(
          UI_TEXT.vault.recoveryWarning,
          { modal: true, detail: fill(UI_TEXT.vault.recoveryShownOnce, { code }) },
          UI_TEXT.vault.copyCode,
          UI_TEXT.vault.savedIt,
        )
        if (choice !== UI_TEXT.vault.copyCode) return choice === UI_TEXT.vault.savedIt
        await vscode.env.clipboard.writeText(code)
      }
      return false
    },
    editItem: async (
      current: VaultItemMetadata | undefined,
      signal: AbortSignal,
    ): Promise<VaultItem | VaultItemMetadata | null> => {
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
  }
}
