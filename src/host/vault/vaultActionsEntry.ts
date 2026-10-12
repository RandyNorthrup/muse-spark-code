// dist/vaultActions.js (RVAPP-CM1091D5 BYTES): the vault's explicit-action
// code the opening bundle (dist/vault.js) does not carry — the native
// Add/Edit editor, the crypto used only by write, and the Reset,
// Setup/recovery-code and Import Keep/Delete dialogs. Loaded on the first
// action that needs it through vaultActionsLoader; a missing bundle refuses
// with the operation failure sentence and logs the bundle name.
export { vaultActionDialogs, type VaultActionDialogDeps } from './vaultActionDialogs'
export { encodeVaultMaterial } from '../../core/vault/crypto'
