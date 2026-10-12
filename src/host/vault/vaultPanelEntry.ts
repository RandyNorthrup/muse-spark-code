import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { type UiText } from '../../shared/l10n/en'
import { fill, setUiText } from '../../shared/l10n/text'
import { VaultBrokerClient } from '../../core/vault/broker/client'
import { VaultManageSession } from '../../core/vault/broker/manageClient'
import { discoverAmbientFiles } from '../../core/vault/migrate/ambient'
import { agentDataFolder } from '../../runtime/dataFolder'
import { vaultClientPlatform, type VaultClientPlatform } from '../../runtime/vault/clientPlatform'
import { VaultBrokerProcess } from './brokerProcess'
import { VaultPanelHost, type VaultPanelHostDeps, type VaultPanelService } from './vaultPanelHost'
import { vaultPanelService } from './vaultPanelService'
import { editVaultItem, type VaultNativeInput } from './vaultNativeEditor'

import { VAULT_COMMANDS, type VaultWindowControls } from './vaultPanelBundle'

export interface VaultPanelEntryDeps extends Omit<
  VaultPanelHostDeps,
  | 'editItem'
  | 'confirmRemove'
  | 'copyPublicKey'
  | 'status'
  | 'showError'
  | 'service'
  | 'showRecoveryCode'
  | 'importDone'
  | 'confirmReset'
> {
  /** dist/ beside the running bundle (the broker and its native helpers). */
  readonly distDir: string
  readonly openPanel: () => Promise<void>
  readonly sshKey: VaultNativeInput['sshKey']
  /** A test's service; the window's own is the broker-backed one built here. */
  readonly service?: VaultPanelService
}

/** The broker-backed service over the platform's connection, and a probe that proves it is up. */
function brokerService(distDir: string): {
  service: VaultPanelService
  probe: () => Promise<void>
} {
  // The same per-user vault every editor and the ACP agent open (D89.1).
  const dataDir = agentDataFolder({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  })
  const hostId = randomBytes(VAULT_LIMITS.idBytes).toString('hex')
  const hostSession = randomBytes(VAULT_LIMITS.idBytes).toString('hex')
  let connection: Promise<{ platform: VaultClientPlatform; broker: VaultBrokerProcess }> | undefined
  const connect = async () => {
    connection ??= (async () => {
      const platform = await vaultClientPlatform({ dataDir, distDir })
      return { platform, broker: new VaultBrokerProcess(platform.discovery, platform.process) }
    })()
    let ready: Awaited<typeof connection>
    try {
      ready = await connection
    } catch (error: unknown) {
      connection = undefined
      throw error
    }
    return await VaultBrokerClient.open(
      await ready.broker.get(),
      hostId,
      hostSession,
      ready.platform.peers,
    )
  }
  return {
    service: vaultPanelService(new VaultManageSession(connect), {
      ambientFiles: () => discoverAmbientFiles(homedir()),
    }),
    probe: async () => {
      const client = await connect()
      client.close()
    },
  }
}

/** W loads dist/vault.js on first need, then binds C/B/P/M and M95's panel to this factory. */
export function createVaultPanelHost(
  deps: VaultPanelEntryDeps,
  table: UiText,
  locale: string,
): { host: VaultPanelHost } & VaultWindowControls {
  setUiText(table, locale)
  const broker = deps.service === undefined ? brokerService(deps.distDir) : undefined
  const service = deps.service ?? broker?.service
  if (service === undefined) throw new Error(UI_TEXT.vault.brokerBlocked)
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  status.text = `$(lock) ${UI_TEXT.vault.lock}`
  status.tooltip = UI_TEXT.vault.unlocked
  status.command = VAULT_COMMANDS.lock
  const host = new VaultPanelHost({
    ...deps,
    service,
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
    confirmReset: async (word, signal) => {
      // Step 1: what a reset erases, stated plainly; step 2: the typed word.
      const proceed = await vscode.window.showWarningMessage(
        UI_TEXT.vault.resetVault,
        { modal: true, detail: UI_TEXT.vault.resetWarning },
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
      // Until a platform lane binds the broker, refuse exactly as 0.17.0 does.
      await broker?.probe()
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
