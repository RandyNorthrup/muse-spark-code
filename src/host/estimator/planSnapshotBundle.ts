// The plan snapshot as the activation bundle sees it (M117 C-M117-1,
// PLAN.md D6): dist/planSnapshot.js, built from planSnapshotEntry.ts and
// required the first time an estimate needs a plan snapshot. Only a type
// comes from the source here: a value imported from there would carry the
// plan reader back into dist/extension.js, which the bundle-split gate
// (scripts/check-bundle-split.mjs) refuses.
//
// There is no fallback without it: an estimate without its snapshot refuses
// with the reason, the log has the cause, and the next estimate tries again.
import type { EstimateGoal } from '../../shared/estimate'
import { UI_TEXT } from '../../shared/constants'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as PlanSnapshotSource from './planSnapshotSource'

type SnapshotSource = typeof PlanSnapshotSource.createPlanSnapshotSource

/** Whether a required module is the snapshot bundle (PLAN.md §8). */
export function isPlanSnapshotBundle(value: unknown): value is {
  readonly createPlanSnapshotSource: SnapshotSource
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlanSnapshotSource' in value &&
    typeof value.createPlanSnapshotSource === 'function'
  )
}

export interface PlanSnapshotLoaderDeps {
  /** dist/planSnapshot.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** The workspace root holding PLAN.md; empty refuses every snapshot. */
  readonly root: string
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The goal's snapshot from the loader's root, the bundle required the first
 * time it is asked for and kept from then on. A missing or corrupt bundle
 * throws `estimateUnavailable` (the log has the cause) and is tried again on
 * the next call.
 */
export function planSnapshotLoader(
  deps: PlanSnapshotLoaderDeps,
): (goal: EstimateGoal, asOf: string) => Promise<unknown> {
  let source: ((goal: EstimateGoal, asOf: string) => Promise<unknown>) | undefined
  return async (goal, asOf) => {
    if (source === undefined) {
      const { bundlePath, loadBundle = requireFile } = deps
      let bundle: unknown
      try {
        bundle = loadBundle(bundlePath)
      } catch (error: unknown) {
        deps.log.error(`The plan snapshot ${bundlePath} could not be loaded: ${describe(error)}`)
        throw new Error(UI_TEXT.estimateUnavailable, { cause: error })
      }
      if (!isPlanSnapshotBundle(bundle)) {
        deps.log.error(`${bundlePath} does not export the plan snapshot`)
        if (deps.loadBundle === undefined) {
          forgetFile(bundlePath)
        }
        throw new Error(UI_TEXT.estimateUnavailable)
      }
      source = bundle.createPlanSnapshotSource({ root: deps.root })
    }
    return await source(goal, asOf)
  }
}
