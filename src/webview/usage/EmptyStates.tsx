import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { plural } from '../../shared/l10n/text'
import type { UsagePageState } from '../../shared/usagePage'
import type { PostUsage } from './display'

export function EmptyStates({
  state,
  post,
}: {
  readonly state: UsagePageState
  readonly post: PostUsage
}) {
  return (
    <>
      {state.history.enabled ? null : (
        <section>
          <h2>{USAGE_TEXT.historyOffTitle}</h2>
          <p>{USAGE_TEXT.historyOffDetail}</p>
          <button
            type="button"
            disabled={state.capabilities?.setHistory === false}
            onClick={() => {
              post({ type: 'usage/setHistory', enabled: true })
            }}
          >
            {USAGE_TEXT.enableHistory}
          </button>
        </section>
      )}
      {state.totals.records === 0 ? (
        <section>
          <h2>{state.history.recordCount === 0 ? USAGE_TEXT.emptyTitle : USAGE_TEXT.emptyRange}</h2>
          <p>{USAGE_TEXT.emptyDetail}</p>
        </section>
      ) : null}
      {state.history.newerVersionRecords > 0 ? (
        <p role="status">{plural(USAGE_TEXT.newerRecords, state.history.newerVersionRecords)}</p>
      ) : null}
      {state.history.tornLines > 0 ? (
        <p role="status">{plural(USAGE_TEXT.tornLines, state.history.tornLines)}</p>
      ) : null}
    </>
  )
}
