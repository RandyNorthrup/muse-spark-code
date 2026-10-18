// Activation imports this shim only. W supplies the lazy dist/vault.js factory
// (the panel host and the native editor); no service, schema, broker, broker
// client, native slot entry or status item loads before first use.
import { type Disposable } from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import { fixedMessageLog, lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type {
  ModelsVaultBinding,
  ModelsVaultBindingDeps,
  WindowVaultControlsDeps,
} from './vaultPanelEntry'

export const VAULT_COMMANDS = { open: 'museSpark.vault', lock: 'museSpark.lockVault' } as const
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
 * What dist/vault.js exports: the window and panel factories. Only types
 * come from the panel's side here: a value imported from there would carry
 * the host, the editor and the broker client back into dist/extension.js,
 * which the bundle-split gate refuses.
 */
export interface VaultBundle {
  /**
   * The window commands without a second host: open reveals the panel's
   * vault section, lock works through one broker-backed service alone.
   */
  readonly createWindowVaultControls: (
    deps: WindowVaultControlsDeps,
    table: UiText,
    locale: string,
  ) => VaultWindowControls
  /** The Models & Agents panel's vault section binding (C-M109-1 P1). */
  readonly createModelsVaultBinding: (
    deps: ModelsVaultBindingDeps,
    table: UiText,
    locale: string,
  ) => ModelsVaultBinding
}

/** Whether a required module exports the panel factories. */
export function isVaultBundle(value: unknown): value is VaultBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createWindowVaultControls' in value &&
    typeof value.createWindowVaultControls === 'function' &&
    'createModelsVaultBinding' in value &&
    typeof value.createModelsVaultBinding === 'function'
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
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The vault bundle could not be loaded',
      wrongShape: 'The vault bundle does not export the panel',
    }),
    isBundle: isVaultBundle,
    label: 'vault bundle',
    unavailable: () => UI_TEXT.vault.brokerBlocked,
  })
}

export interface VaultControlsDeps extends VaultBundleLoaderDeps {
  /** dist/ beside the running bundle: the bundle builds its broker-backed service from it. */
  readonly distDir: string
}

/**
 * The window controls, or an explicit refusal while the panel binding is
 * missing. `connect` supplies the panel opener; the bundle itself builds
 * the broker-backed service the lock command needs (C-M109-1), so
 * activation loads no client. Until the Models & Agents panel mounts the
 * vault section, the caller passes undefined and both commands report
 * `vault.brokerDisabled`.
 */
export function loadVaultControls(
  deps: VaultControlsDeps,
  connect: (() => Omit<WindowVaultControlsDeps, 'distDir'>) | undefined,
): VaultWindowControls {
  if (connect === undefined) {
    deps.log.error('The vault panel is not mounted in this window; refusing closed')
    throw new Error(UI_TEXT.vault.brokerDisabled)
  }
  const bundle = vaultBundleLoader(deps)()
  return bundle.createWindowVaultControls(
    { distDir: deps.distDir, ...connect() },
    UI_TEXT,
    uiLocale(),
  )
}
