// The estimator as the activation bundle sees it (M117, PLAN.md D6):
// dist/estimator.js, built from estimatorEntry.ts and required the first
// time an estimate runs. Only types come from the entry here: a value
// imported from there would carry the engine back into dist/extension.js,
// which the bundle-split gate (scripts/check-bundle-split.mjs) refuses.
//
// There is no fallback without it: an estimate that cannot load its bundle
// is refused with the reason, the log has the cause, and the next estimate
// tries again.
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as EstimatorEntry from './estimatorEntry'

type EstimatorRun = EstimatorEntry.EstimatorRun
type EstimatorSourcePorts = EstimatorEntry.EstimatorSourcePorts

/** Whether a required module is the estimator bundle (PLAN.md §8). */
export function isEstimatorBundle(value: unknown): value is typeof EstimatorEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createEstimatorRun' in value &&
    typeof value.createEstimatorRun === 'function'
  )
}

export interface LazyEstimatorDeps {
  /** dist/estimator.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** The milestone bindings; each refuses with its handoff until it merges. */
  readonly ports: () => EstimatorSourcePorts
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The estimator's run, the bundle required the first time any of it is used
 * and kept from then on. A missing or corrupt bundle throws
 * `estimateUnavailable` and is tried again on the next use.
 */
export function lazyEstimator(deps: LazyEstimatorDeps): EstimatorRun {
  let run: EstimatorRun | undefined
  const loaded = (): EstimatorRun => {
    if (run !== undefined) return run
    const { bundlePath, loadBundle = requireFile } = deps
    let bundle: unknown
    try {
      bundle = loadBundle(bundlePath)
    } catch (error: unknown) {
      deps.log.error(`The estimator ${bundlePath} could not be loaded: ${describe(error)}`)
      throw new Error(UI_TEXT.estimateUnavailable, { cause: error })
    }
    if (!isEstimatorBundle(bundle)) {
      deps.log.error(`${bundlePath} does not export the estimator`)
      if (deps.loadBundle === undefined) forgetFile(bundlePath)
      throw new Error(UI_TEXT.estimateUnavailable)
    }
    run = bundle.createEstimatorRun(deps.ports(), UI_TEXT, uiLocale())
    return run
  }
  return {
    estimate: async (request, signal) => await loaded().estimate(request, signal),
    startWave: async (input) => await loaded().startWave(input),
    price: (price) => loaded().price(price),
    // Read from the bundle so the handoff name has one source of truth; the
    // panel only asks after an estimate already loaded it.
    get provisionWaiting() {
      return loaded().provisionWaiting
    },
  }
}

export type { EstimatorRun, EstimatorSourcePorts }
