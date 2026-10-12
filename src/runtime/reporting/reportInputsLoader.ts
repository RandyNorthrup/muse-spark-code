import type * as InputsBundle from './reportInputsEntry'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'

type Bundle = typeof InputsBundle
function isBundle(value: unknown): value is Bundle {
  const bundle = value as Partial<Bundle> | null
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof bundle?.createSessionReportReader === 'function' &&
    typeof bundle.createUsageReportReader === 'function' &&
    typeof bundle.keybindingsManifestReader === 'function' &&
    typeof bundle.createAccountsReportReader === 'function' &&
    typeof bundle.createSecurityReportReader === 'function' &&
    typeof bundle.readStoredReportSession === 'function' &&
    typeof bundle.readUsageReportJournal === 'function' &&
    typeof bundle.createReportJournalReader === 'function' &&
    typeof bundle.readHostReportSession === 'function'
  )
}

export function reportInputsLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  const reportUi = UI_TEXT.reportUi

  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'report session, usage, accounts and security inputs',
    unavailable: () => reportUi.generationFailed,
  })
}
