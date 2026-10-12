// Every named vault refusal's own sentence (RVAPP-CM1091D5 P2-3): the panel
// and the terminal share this list, so a refusal keeps its sentence on both
// and only an unnamed failure stays "No access". Exact match only: no
// foreign text can quote a full sentence. A function, not a module-level
// list: UI_TEXT is read when the shown language is installed, never at load.
import { UI_TEXT } from './constants'

/** Every named vault refusal's own sentence. */
export function vaultRefusalSentences(): readonly string[] {
  return [
    UI_TEXT.vault.locked, // protocol refusal `locked`
    UI_TEXT.vault.setupNeeded, // `uncreated`
    UI_TEXT.vault.setupExists, // `exists`
    UI_TEXT.vault.itemConflict, // `conflict`: an item or path collision, never setup
    UI_TEXT.vault.deleteConflict, // `deleteConflict`: a Delete refused after import
    UI_TEXT.vault.busy, // `busy`
    UI_TEXT.vault.rollback, // `rollback`
    UI_TEXT.vault.storeUnavailable, // `storeUnavailable`
    UI_TEXT.vault.sourceGone, // `sourceGone`: the file is gone, nothing to retry
    UI_TEXT.vault.sourceUnreadable, // `sourceUnreadable`: unreadable source, receipt kept
    UI_TEXT.vault.sourceUnavailable, // `sourceUnavailable`: location away, receipt kept
    UI_TEXT.vault.operationFailed, // `invalid`, `io`
    UI_TEXT.vault.useChanged, // a guard below
    UI_TEXT.vault.approvalExpired, // a guard below
  ]
}
