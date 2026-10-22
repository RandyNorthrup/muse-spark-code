// Every named vault refusal's own sentence (RVAPP-CM1091D5 P2-3): the panel
// and the terminal share this list, so a refusal keeps its sentence on both
// and only an unnamed failure stays "No access". Exact match only: no
// foreign text can quote a full sentence. A function, not a module-level
// list: UI_TEXT is read when the shown language is installed, never at load.
import { UI_TEXT } from './constants'
import { fill, formatDateTime, formatNumber } from './l10n/text'
import type { VaultBrokerResponse } from './vaultProtocol'

/** The writer a busy refusal names, without the error class that names it. */
export type VaultWriterFacts = NonNullable<
  Extract<VaultBrokerResponse['response'], { kind: 'refused' }>['writer']
>

/**
The holder-detail sentence behind a busy refusal: the same words
`VaultWriterError` carries, shared crypto-free so the agent bundle can
name a holder without loading the write-only crypto.
*/
export function vaultWriterDetail(writer: VaultWriterFacts): string {
  const text = UI_TEXT.vault
  if (writer.kind === 'held') {
    const detail = fill(writer.otherMachine ? text.busyOtherMachine : text.busyHolder, {
      pid: formatNumber(writer.pid),
      since: formatDateTime(writer.acquiredAt),
    })
    return writer.machineLabel ? writer.machineLabel + ': ' + detail : detail
  }
  return text[writer.kind]
}

/**
Every named vault refusal's sentence key, with the refusal it names:
the panel and the terminal read the same installed sentences.
*/
const REFUSAL_SENTENCE_KEYS = [
  'locked', // protocol refusal `locked`
  'setupNeeded', // `uncreated`
  'setupExists', // `exists`
  'itemConflict', // `conflict`: an item or path collision, never setup
  'deleteConflict', // `deleteConflict`: a Delete refused after import
  'busy', // `busy`
  'rollback', // `rollback`
  'storeUnavailable', // `storeUnavailable`
  'sourceGone', // `sourceGone`: the file is gone, nothing to retry
  'sourceUnreadable', // `sourceUnreadable`: unreadable source, receipt kept
  'sourceUnavailable', // `sourceUnavailable`: location away, receipt kept
  'operationFailed', // `invalid`, `io`
  'useChanged', // a guard below
  'approvalExpired', // a guard below
  'editConflict', // the panel's draft guard: a change landed after the draft
] as const

/** Every named vault refusal's own sentence. */
export function vaultRefusalSentences(): readonly string[] {
  return REFUSAL_SENTENCE_KEYS.map((key) => UI_TEXT.vault[key])
}
