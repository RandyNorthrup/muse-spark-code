import type * as InputsBundle from './reportInputsEntry'
import {
  fixedMessageLog,
  lazyBundleLoader,
  type LazyBundleLoaderOptions,
} from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'

type Bundle = typeof InputsBundle
function isBundle(value: unknown): value is Bundle {
  const bundle = value as Partial<Bundle> | null
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof bundle?.createSessionReportReader === 'function' &&
    typeof bundle.createEstimateReportReader === 'function' &&
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
    // The bundle path and the loader's raw error never reach the log: only
    // fixed words do, so a private install path cannot leak through a load
    // failure (RVREPORTJOIN P2-6).
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The report inputs bundle could not be loaded',
      wrongShape: 'The report inputs bundle does not export the report inputs',
    }),
    isBundle,
    label: 'report session, usage, accounts and security inputs',
    unavailable: () => reportUi.generationFailed,
  })
}
