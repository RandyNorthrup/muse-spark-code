import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../lazyBundle'
import type { createReportingCheckJournal } from '../../runtime/reporting/engine'

type JournalFactory = typeof createReportingCheckJournal
interface CheckBundle {
  readonly createReportingCheckJournal: JournalFactory
}
function isBundle(value: unknown): value is CheckBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReportingCheckJournal' in value &&
    typeof value.createReportingCheckJournal === 'function'
  )
}
export function reportingCheckJournal(
  deps: Pick<LazyBundleLoaderOptions<CheckBundle>, 'bundlePath' | 'log'> & {
    readonly context: Parameters<JournalFactory>[0]
  },
): ReturnType<JournalFactory> {
  const load = lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'report check journal',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
  let journal: ReturnType<JournalFactory> | undefined
  const get = () => (journal ??= load().createReportingCheckJournal(deps.context))
  return { commit: () => get().commit(), append: (record) => get().append(record) }
}
