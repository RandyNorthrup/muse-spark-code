import * as vscode from 'vscode'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  SETTINGS_SECTION,
  UI_TEXT,
  VAULT_ACTIONS_BUNDLE_FILE,
  VAULT_LIMITS,
} from '../../shared/constants'
import { vaultRefusalSentences } from '../../shared/vaultRefusals'
import { type VaultHostMessage } from '../../shared/hostApi/vaultMessages'
import { type UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { VaultManageSession } from '../../core/vault/broker/manageClient'
import { discoverAmbientFiles } from '../../core/vault/migrate/ambient'
import { agentDataFolder } from '../../runtime/dataFolder'
import { vaultClientPlatform, type VaultClientPlatform } from '../../runtime/vault/clientPlatform'
import type { Logger } from '../logger'
import { VaultBrokerProcess } from './brokerProcess'
import { VaultPanelHost, type VaultPanelHostDeps, type VaultPanelService } from './vaultPanelHost'
import { vaultPanelService } from './vaultPanelService'
import { type VaultActionsBundle, vaultActionsLoader } from './vaultActionsBundle'
import { VAULT_COMMANDS, type VaultWindowControls } from './vaultPanelBundle'
import { isVaultEnabled } from './vaultSwitch'

/**
 * README's legacy vault switch, resolved live where the vault runs. A
 * switched-off vault refuses before any service is built, on the
 * broker-backed path alone; a test's injected service bypasses it.
 */
function throwWhenSwitchedOff(
  service: VaultPanelService | undefined,
  log: Logger,
  table: UiText,
): void {
  if (
    service === undefined &&
    !isVaultEnabled(vscode.workspace.getConfiguration(SETTINGS_SECTION), log)
  ) {
    throw new Error(table.vault.switchedOff)
  }
}

/** The broker-backed service over the platform's connection, and a probe that proves it is up. */
function brokerService(
  distDir: string,
  actions: () => VaultActionsBundle,
): {
  service: VaultPanelService
  probe: () => Promise<void>
  dispose: () => void
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
      const platform = await vaultClientPlatform({ dataDir, distDir, hostId, hostSession })
      return { platform, broker: new VaultBrokerProcess(platform.discovery, platform.process) }
    })()
    let ready: Awaited<typeof connection>
    try {
      ready = await connection
    } catch (error: unknown) {
      connection = undefined
      throw error
    }
    return await ready.broker.connect(
      hostId,
      hostSession,
      ready.platform.peers,
      ready.platform.dial,
    )
  }
  return {
    dispose: () => {
      void connection?.then(
        ({ platform }) => platform.dispose?.(),
        () => {
          /* The command already reports a failed platform load. */
        },
      )
    },
    service: vaultPanelService(
      new VaultManageSession(connect, (material) => actions().encodeVaultMaterial(material)),
      {
        ambientFiles: () => discoverAmbientFiles(homedir()),
      },
    ),
    probe: async () => {
      const client = await connect()
      client.close()
    },
  }
}

/** The native prompts and error channel every vault host shares. */
function nativeHostDeps(deps: {
  readonly now: () => number
  /** The second lazy bundle; required only when an action needs it. */
  readonly actions: () => VaultActionsBundle
}): Omit<VaultPanelHostDeps, 'service' | 'publish' | 'status'> {
  // The Reset, Setup/recovery-code, Import and Add/Edit dialogs live in the
  // actions bundle and load on first use; each call below requires it then.
  // SSH key generation and import compose inside the dialogs (S owns the key
  // formats; the dialogs own the VS Code source picker).
  const dialogs = () => deps.actions().vaultActionDialogs({ now: deps.now })
  return {
    now: deps.now,
    importDone: (names) => dialogs().importDone(names),
    confirmReset: (word, signal, warning) => dialogs().confirmReset(word, signal, warning),
    showRecoveryCode: (code, signal) => dialogs().showRecoveryCode(code, signal),
    editItem: (current, signal) => dialogs().editItem(current, signal),
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
  }
}

export interface ModelsVaultBindingDeps {
  /** dist/ beside the running bundle (the broker and its native helpers). */
  readonly distDir: string
  readonly now: () => number
  /** Into the Models & Agents panel's webview (an already parsed host message). */
  readonly publish: (message: VaultHostMessage) => void
  /** A test's service; the window's own is the broker-backed one built here. */
  readonly service?: VaultPanelService
  /** Names the actions bundle in the log when it cannot be loaded. */
  readonly log: Logger
  /** A test's actions module; the window's own is required from dist. */
  readonly loadActionsBundle?: ((file: string) => unknown) | undefined
}

export interface ModelsVaultBinding {
  readonly handle: (raw: unknown) => Promise<void>
  readonly refresh: () => Promise<void>
  readonly dispose: () => void
}

/** The lock status item every vault host shows while unlocked. */
function lockStatusItem(): vscode.StatusBarItem {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
  status.text = `$(lock) ${UI_TEXT.vault.lock}`
  status.tooltip = UI_TEXT.vault.unlocked
  status.command = VAULT_COMMANDS.lock
  return status
}

/**
 * What both factories resolve the same way: the broker-backed service (or
 * a test's), the lock item and its writer. The broker connection stays
 * lazy; without a reachable broker every use refuses with
 * `vault.brokerBlocked`.
 */
function serviceAndStatus(deps: {
  readonly distDir: string
  readonly service?: VaultPanelService | undefined
  readonly actions: () => VaultActionsBundle
}): {
  service: VaultPanelService
  statusItem: vscode.StatusBarItem
  status: (isUnlocked: boolean) => void
  /** The broker's readiness probe; trivial while a test owns the service. */
  probe: () => Promise<void>
  /** Disposes the broker-backed service's platform; no-op while a test owns the service. */
  disposeBroker: () => void
} {
  const broker = deps.service === undefined ? brokerService(deps.distDir, deps.actions) : undefined
  const service = deps.service ?? broker?.service
  if (service === undefined) throw new Error(UI_TEXT.vault.brokerBlocked)
  const statusItem = lockStatusItem()
  return {
    service,
    statusItem,
    status: (unlocked) => {
      if (unlocked) statusItem.show()
      else statusItem.hide()
    },
    probe: () => broker?.probe() ?? Promise.resolve(),
    disposeBroker: () => broker?.dispose(),
  }
}

/**
 * The vault section's binding for the Models & Agents panel (C-M109-1 P1):
 * the same broker-backed host the window uses, publishing into the panel's
 * webview instead. The panel owns it while its tab lives; the lock status
 * item behaves as the window's does. The broker connection stays lazy, so
 * without a reachable broker every use refuses with `vault.brokerBlocked`
 * (surfaced as the host's operation failure); the panel hides the section
 * because it is given no factory.
 */
/**
 * What both factories open with: the installed table, the live vault switch
 * and the lazily required actions bundle. One preamble, so the two factories
 * cannot drift apart on the refusal order.
 */
function switchedOnActions(
  deps: {
    readonly distDir: string
    readonly service?: VaultPanelService | undefined
    readonly log: Logger
    readonly loadActionsBundle?: ((file: string) => unknown) | undefined
  },
  table: UiText,
  locale: string,
): () => VaultActionsBundle {
  setUiText(table, locale)
  throwWhenSwitchedOff(deps.service, deps.log, table)
  return vaultActionsLoader({
    bundlePath: path.join(deps.distDir, VAULT_ACTIONS_BUNDLE_FILE),
    log: deps.log,
    loadBundle: deps.loadActionsBundle,
  })
}

export function createModelsVaultBinding(
  deps: ModelsVaultBindingDeps,
  table: UiText,
  locale: string,
): ModelsVaultBinding {
  const actions = switchedOnActions(deps, table, locale)
  const { service, statusItem, status, disposeBroker } = serviceAndStatus({ ...deps, actions })
  const host = new VaultPanelHost({
    ...nativeHostDeps({ now: deps.now, actions }),
    service,
    publish: deps.publish,
    status,
  })
  return {
    handle: (raw) => host.handle(raw),
    refresh: () => host.refresh(),
    dispose: () => {
      host.dispose()
      disposeBroker()
      statusItem.dispose()
    },
  }
}

export interface WindowVaultControlsDeps {
  /** dist/ beside the running bundle (the broker and its native helpers). */
  readonly distDir: string
  /** Reveals the Models & Agents vault section, whose binding owns the host. */
  readonly openPanel: () => Promise<void>
  /** A test's service; the window's own is the broker-backed one built here. */
  readonly service?: VaultPanelService | undefined
  /** Names the actions bundle in the log when it cannot be loaded. */
  readonly log: Logger
  /** A test's actions module; the window's own is required from dist. */
  readonly loadActionsBundle?: ((file: string) => unknown) | undefined
}

/**
 * The window commands without a second host: open reveals the Models &
 * Agents vault section, whose own binding owns the window's single host,
 * subscription and lock item; lock works without the panel through one
 * broker-backed service alone. A refusal keeps its fixed sentence; anything
 * else stays the generic failure, never native text.
 */
export function createWindowVaultControls(
  deps: WindowVaultControlsDeps,
  table: UiText,
  locale: string,
): VaultWindowControls {
  const actions = switchedOnActions(deps, table, locale)
  const broker = deps.service === undefined ? brokerService(deps.distDir, actions) : undefined
  const service = deps.service ?? broker?.service
  if (service === undefined) throw new Error(UI_TEXT.vault.brokerBlocked)
  return {
    open: () => deps.openPanel(),
    lock: async () => {
      try {
        await service.lock()
      } catch (error: unknown) {
        const named = vaultRefusalSentences()
        deps.log.warn('Vault lock command failed')
        await vscode.window.showErrorMessage(
          error instanceof Error && named.includes(error.message)
            ? error.message
            : UI_TEXT.vault.operationFailed,
        )
      }
    },
    dispose: () => {
      broker?.dispose()
    },
  }
}
