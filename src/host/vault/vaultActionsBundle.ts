// The second lazy vault bundle (RVAPP-CM1091D5 BYTES): dist/vaultActions.js
// beside the running bundle, required the first time an explicit vault
// action needs it (Add/Edit, Reset, Setup, Import prompts, write crypto).
// Only types and this loader stay in dist/vault.js, the way vaultPanelBundle.ts
// stays at activation for the opening bundle.
import { UI_TEXT } from '../../shared/constants'
import type { VaultItem } from '../../shared/vault'
import { fixedMessageLog, lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { VaultActionDialogDeps } from './vaultActionDialogs'
import type { VaultPanelHostDeps } from './vaultPanelHost'

/**
What dist/vaultActions.js exports. Only values read here may be used from
dist/vault.js: a value imported from there directly would carry the
editor, the dialogs and the write crypto back into the opening bundle,
which the bundle-split gate refuses.
*/
export interface VaultActionsBundle {
  readonly vaultActionDialogs: (
    deps: VaultActionDialogDeps,
  ) => Pick<VaultPanelHostDeps, 'importDone' | 'confirmReset' | 'showRecoveryCode' | 'editItem'>
  readonly encodeVaultMaterial: (material: VaultItem['material']) => Buffer
}

/** Whether a required module exports the vault's action factories. */
export function isVaultActionsBundle(value: unknown): value is VaultActionsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'vaultActionDialogs' in value &&
    typeof value.vaultActionDialogs === 'function' &&
    'encodeVaultMaterial' in value &&
    typeof value.encodeVaultMaterial === 'function'
  )
}

export interface VaultActionsLoaderDeps {
  /** dist/vaultActions.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
The actions bundle, required the first time it is asked for and kept from
then on. A missing or corrupt bundle throws the operation failure sentence
and is tried again on the next call (the log names the bundle, never a
credential).
*/
export function vaultActionsLoader(deps: VaultActionsLoaderDeps): () => VaultActionsBundle {
  return lazyBundleLoader({
    ...deps,
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The vault actions bundle could not be loaded',
      wrongShape: 'The vault actions bundle does not export the actions',
    }),
    isBundle: isVaultActionsBundle,
    label: 'vault actions bundle',
    unavailable: () => UI_TEXT.vault.operationFailed,
  })
}
