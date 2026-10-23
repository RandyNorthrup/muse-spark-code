import { createInsightsReader, type InsightsReaderDeps } from '../usage/traceLogs'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeUsageInsightsDeps extends InsightsReaderDeps {
  readonly assertCurrent: () => void
  /** The actual CLI trace source is available and admitted for this owner. */
  readonly canReadTraceLogs: () => boolean
}

/** Owns the existing bounded/cached trace reader; other providers use their actual usage source. */
export function createRuntimeUsageInsights(deps: RuntimeUsageInsightsDeps) {
  const lifetime = runtimeFeatureLifetime(() => {
    deps.assertCurrent()
    if (!deps.canReadTraceLogs()) throw new Error('MHP_USAGE_INSIGHTS_UNAVAILABLE')
  })
  const reader = createInsightsReader(deps)
  return {
    read: () => lifetime.track(() => reader.read()),
    dispose: lifetime.dispose,
  }
}
