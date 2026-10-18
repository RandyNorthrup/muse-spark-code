import path from 'node:path'
import { fixedMessageLog, lazyBundleLoader } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type * as NetworkBundle from './network'
import type { Logger } from '../../host/logger'
type Bundle = typeof NetworkBundle
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReportingNetwork' in value &&
    typeof value.createReportingNetwork === 'function'
  )
}
export function reportingNetworkLoader(log: Logger): () => Bundle {
  const reportUi = UI_TEXT.reportUi

  return lazyBundleLoader({
    bundlePath: path.join(__dirname, 'reportingNetwork.js'),
    // The bundle path and the loader's raw error never reach the log: only
    // fixed words do, so a private install path cannot leak through a load
    // failure (RVREPORTJOIN P2-6).
    log: fixedMessageLog({
      log,
      loadFailed: 'The report network bundle could not be loaded',
      wrongShape: 'The report network bundle does not export the report network sources',
    }),
    isBundle,
    label: 'report network sources',
    unavailable: () => reportUi.generationFailed,
  })
}
