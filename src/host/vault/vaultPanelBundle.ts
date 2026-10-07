// Activation imports this shim only. W supplies the lazy dist/vault.js factory
// (the panel host and the native editor); no service, schema, broker, broker
// client, native slot entry or status item loads before first use.
import { type Disposable } from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { VaultPanelEntryDeps } from './vaultPanelEntry'
import type { VaultPanelHost, VaultPanelService } from './vaultPanelHost'

export const VAULT_COMMANDS = { open: 'museSpark.vault', lock: 'museSpark.lockVault' } as const
export const VAULT_LOCK_KEYBINDING = {
  command: VAULT_COMMANDS.lock,
  key: 'ctrl+alt+shift+l',
  mac: 'cmd+alt+shift+l',
} as const
export interface VaultWindowControls {
  open(): Promise<void>
  lock(): Promise<void>
  dispose(): void
}
/** Both commands remain available even before the vault has an item. */
export function registerVaultCommands(
  register: (id: string, action: () => Promise<void>) => Disposable,
  load: () => VaultWindowControls,
): Disposable {
  let controls: VaultWindowControls | undefined
  const current = () => {
    controls ??= load()
    return controls
  }
  const commands = [
    register(VAULT_COMMANDS.open, async () => {
      await current().open()
    }),
    register(VAULT_COMMANDS.lock, async () => {
      await current().lock()
    }),
  ]
  return {
    dispose: () => {
      for (const command of commands) command.dispose()
      controls?.dispose()
    },
  }
}

/**
 * What dist/vault.js exports: the panel factory. Only types come from the
 * panel's side here: a value imported from there would carry the host, the
 * editor and the broker client back into dist/extension.js, which the
 * bundle-split gate refuses.
 */
export interface VaultBundle {
  readonly createVaultPanelHost: (
    deps: VaultPanelEntryDeps,
    table: UiText,
    locale: string,
  ) => { host: VaultPanelHost } & VaultWindowControls
}

/** Whether a required module exports the panel factory. */
export function isVaultBundle(value: unknown): value is VaultBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createVaultPanelHost' in value &&
    typeof value.createVaultPanelHost === 'function'
  )
}

export interface VaultBundleLoaderDeps {
  /** dist/vault.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
 * The bundle, required the first time it is asked for and kept from then on.
 * A missing or corrupt bundle throws `vault.brokerBlocked` and is tried again
 * on the next call (the log has the cause, never a credential).
 */
export function vaultBundleLoader(deps: VaultBundleLoaderDeps): () => VaultBundle {
  return lazyBundleLoader({
    ...deps,
    log: {
      trace: (message) => {
        deps.log.trace(message)
      },
      info: (message) => {
        deps.log.info(message)
      },
      warn: (message) => {
        deps.log.warn(message)
      },
      error: (message) => {
        deps.log.error(
          message.includes('does not export')
            ? 'The vault bundle does not export the panel'
            : 'The vault bundle could not be loaded',
        )
      },
    },
    isBundle: isVaultBundle,
    label: 'vault bundle',
    unavailable: () => UI_TEXT.vault.brokerBlocked,
  })
}

export interface VaultControlsDeps extends VaultBundleLoaderDeps {
  /**
   * The panel's broker-backed service. W has no implementation yet (the C/B/P/M
   * adapter over the broker channel is an open handoff in
   * docs/certification/m109.md): while it is missing the commands refuse
   * closed with `vault.brokerBlocked` instead of opening an empty vault.
   */
  readonly service: VaultPanelService | undefined
}

/**
 * The window controls, or an explicit refusal while the service is missing.
 * `connect` supplies the entry's live host bindings (panel opener, native
 * prompts, clock, webview publisher) and runs only once the service exists,
 * so activation registers no placeholder for them.
 */
export function loadVaultControls(
  deps: VaultControlsDeps,
  connect: () => Omit<VaultPanelEntryDeps, 'service'>,
): VaultWindowControls {
  if (deps.service === undefined) {
    deps.log.error('The vault panel needs its broker-backed service; refusing closed')
    throw new Error(UI_TEXT.vault.brokerBlocked)
  }
  const bundle = vaultBundleLoader(deps)()
  return bundle.createVaultPanelHost({ service: deps.service, ...connect() }, UI_TEXT, uiLocale())
}
