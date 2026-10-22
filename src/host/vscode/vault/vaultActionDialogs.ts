// The vault's explicit-action dialogs (RVAPP-CM1091D5 BYTES): the native
// Add/Edit editor wrapper and the Reset, Setup/recovery-code and Import
// Keep/Delete prompts. They load on first use as part of dist/vaultActions.js,
// never with the opening bundle; only the small confirm/remove/copy/error
// channel stays in vaultPanelEntry.ts.
import * as vscode from 'vscode'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { VaultItem, VaultItemMetadata } from '../../../shared/vault'
import { generateEd25519Key, importSshKey, type SoftwareSshKey } from '../../../core/vault/ssh/keys'
import { sshFailure } from '../../../core/vault/ssh/wire'
import type { VaultPanelHostDeps } from '../../vault/vaultPanelHost'
import { editVaultItem, type VaultNativeInput } from '../../vault/vaultNativeEditor'

export interface VaultActionDialogDeps {
  readonly now: () => number
}

type SshKeyResult = Awaited<ReturnType<VaultNativeInput['sshKey']>>

/**
The key module's own fixed refusal (an unreadable or unusable key file).
Exact match only: anything else keeps its cause instead of asking for a
passphrase over an unrelated failure.
*/
function isSshRefusal(error: unknown): boolean {
  return error instanceof Error && error.message === UI_TEXT.vault.noAccess
}

/** S owns generation and import; this VS Code side only picks the source. */
async function vscodeSshKey(): Promise<SshKeyResult> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: UI_TEXT.vault.generateSshKey, id: 'generate' },
      { label: UI_TEXT.vault.importSshKeyFile, id: 'import' },
    ],
    { ignoreFocusOut: true },
  )
  if (picked === undefined) return null
  // The private bytes transfer to the controller, which wipes after the
  // transaction; every failure below wipes before it throws or stops.
  const toMaterial = (key: SoftwareSshKey): Exclude<SshKeyResult, null> => ({
    material: {
      kind: 'sshKey',
      storage: 'software',
      privateKey: key.privateKey,
      algorithm: key.algorithm,
    },
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
  })
  if (picked.id === 'generate') return toMaterial(generateEd25519Key())
  const [target] = (await vscode.window.showOpenDialog({ canSelectMany: false })) ?? []
  if (target?.scheme !== 'file') return null
  let raw: Uint8Array | undefined
  try {
    raw = await vscode.workspace.fs.readFile(target)
  } catch (error: unknown) {
    // Only a filesystem failure names the key file; anything else keeps its cause.
    if (!(error instanceof vscode.FileSystemError)) throw error
    throw sshFailure()
  }
  const fileBytes = Buffer.from(raw)
  raw.fill(0)
  try {
    try {
      return toMaterial(importSshKey(Buffer.from(fileBytes)))
    } catch (error: unknown) {
      // An encrypted file fails without its passphrase: ask once, then stop.
      // Anything but the key module's own refusal keeps its cause.
      if (!isSshRefusal(error)) throw error
      const entered = await vscode.window.showInputBox({
        prompt: UI_TEXT.vault.sshKeyPassphrase,
        password: true,
        ignoreFocusOut: true,
      })
      if (entered === undefined || entered === '') return null
      const passphrase = Buffer.from(entered, 'utf8')
      try {
        return toMaterial(importSshKey(Buffer.from(fileBytes), passphrase))
      } catch (retryError: unknown) {
        if (!isSshRefusal(retryError)) throw retryError
        throw sshFailure()
      } finally {
        passphrase.fill(0)
      }
    }
  } finally {
    fileBytes.fill(0)
  }
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
      // broker names one; no trailing blank line without one (RVCM109LEASEB).
      const detail = UI_TEXT.vault.resetWarning + (warning ? '\n\n' + warning : '')
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
            sshKey: vscodeSshKey,
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
