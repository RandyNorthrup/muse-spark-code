// The estimator history as the activation bundle sees it (M117 C-M117-2,
// PLAN.md D6): dist/estimateHistory.js, built from historyEntry.ts and
// required the first time an estimate reads its history. Only types come
// from the entry here: a value imported from there would carry the journal
// and its record rules back into dist/extension.js, which the bundle-split
// gate (scripts/check-bundle-split.mjs) refuses.
//
// A missing or corrupt bundle refuses the estimate with its own safe
// detail: a load failure never reads as an empty history.
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { fixedMessageLog, namedBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as HistoryEntry from './historyEntry'
import type { FileHistoryPorts } from './historyStore'

export interface HistoryLoaderDeps {
  /** dist/estimateHistory.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** The journal directory under the agent data folder. */
  readonly directory: string
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
History ports whose journal loads with its bundle on the first read. One
journal serves both ports, so the skipped snapshot belongs to the same
listing the records came from; a failed load is tried again next time.
*/
export function lazyHistoryPorts(deps: HistoryLoaderDeps): FileHistoryPorts {
  const load = namedBundleLoader<typeof HistoryEntry>({
    ...deps,
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The estimate history bundle could not be loaded',
      wrongShape: 'The estimate history bundle could not be loaded',
    }),
    names: ['fileHistoryPorts'],
    label: 'estimate history',
    unavailable: () => fill(UI_TEXT.estimateFailed, { detail: 'history-bundle-unavailable' }),
  })
  let ports: FileHistoryPorts | undefined
  const current = (): FileHistoryPorts => (ports ??= load().fileHistoryPorts(deps.directory))
  return {
    history: async () => await current().history(),
    skipped: async () => await current().skipped(),
  }
}
