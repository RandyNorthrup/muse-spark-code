import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
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
  return lazyBundleLoader({
    bundlePath: path.join(__dirname, 'reportingNetwork.js'),
    log,
    isBundle,
    label: 'report network sources',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
}
