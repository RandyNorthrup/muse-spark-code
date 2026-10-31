// dist/vaultExecHost.js (D243): the headless exec stack — the headless
// registration/session and the feeder host port — loaded by the vault
// runtime binding on the first headless `--vault` open and by the exec
// entry for `vault_run`, so neither measured bundle carries it.
export { openHeadlessVault } from './headlessSession'
export { createHeadlessVaultExecService } from './vaultExecHost'
export { setUiText } from '../../shared/l10n/text'
