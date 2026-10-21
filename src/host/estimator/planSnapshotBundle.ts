import { EstimateDiagnosticError } from '../../core/estimator/diagnostic'
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
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as PlanSnapshotSource from './planSnapshotSource'

type SnapshotSource = typeof PlanSnapshotSource.createPlanSnapshotSource
type SnapshotTextInstaller = typeof PlanSnapshotSource.installPlanSnapshotText
type CheckSource = typeof PlanSnapshotSource.createPlanCheckSource

/** Whether a required module is the snapshot bundle (PLAN.md §8). */
export function isPlanSnapshotBundle(value: unknown): value is {
  readonly createPlanSnapshotSource: SnapshotSource
  readonly installPlanSnapshotText: SnapshotTextInstaller
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlanSnapshotSource' in value &&
    typeof value.createPlanSnapshotSource === 'function' &&
    'installPlanSnapshotText' in value &&
    typeof value.installPlanSnapshotText === 'function'
  )
}

/** Whether a required module is the plan-check bundle (PLAN.md §8). */
export function isPlanCheckBundle(value: unknown): value is {
  readonly createPlanCheckSource: CheckSource
  readonly installPlanSnapshotText: SnapshotTextInstaller
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlanCheckSource' in value &&
    typeof value.createPlanCheckSource === 'function' &&
    'installPlanSnapshotText' in value &&
    typeof value.installPlanSnapshotText === 'function'
  )
}

/** The required snapshot bundle, or a refusal naming the bundle file. */
function requireSnapshotBundle(deps: PlanSnapshotLoaderDeps): unknown {
  const { bundlePath, loadBundle = requireFile } = deps
  try {
    return loadBundle(bundlePath)
  } catch (error: unknown) {
    deps.log.error(`The plan snapshot ${bundlePath} could not be loaded: ${describe(error)}`)
    throw new EstimateDiagnosticError('estimate-unavailable', UI_TEXT.estimateUnavailable)
  }
}

export interface PlanSnapshotLoaderDeps {
  /** dist/planSnapshot.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** The workspace root holding PLAN.md; empty refuses every snapshot. */
  readonly root: string
  /** Acquired by the source on every estimate; never cached with the bundle. */
  readonly networkPolicy?: PlanSnapshotSource.PlanSnapshotSourceDeps['networkPolicy']
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
The goal's snapshot from the loader's root, the bundle required the first
time it is asked for and kept from then on. A missing or corrupt bundle
throws `estimateUnavailable` (the log has the cause) and is tried again on
the next call.
*/
export function planSnapshotLoader(
  deps: PlanSnapshotLoaderDeps,
): (goal: EstimateGoal, asOf: string, signal?: AbortSignal) => Promise<unknown> {
  let source:
    ((goal: EstimateGoal, asOf: string, signal?: AbortSignal) => Promise<unknown>) | undefined
  return async (goal, asOf, signal) => {
    if (source === undefined) {
      const { bundlePath } = deps
      const bundle = requireSnapshotBundle(deps)
      if (!isPlanSnapshotBundle(bundle)) {
        deps.log.error(`${bundlePath} does not export the plan snapshot`)
        if (deps.loadBundle === undefined) {
          forgetFile(bundlePath)
        }
        throw new EstimateDiagnosticError('estimate-unavailable', UI_TEXT.estimateUnavailable)
      }
      // Each bundle keeps its own language state: the snapshot bundle gets
      // the caller's table before it reads anything.
      bundle.installPlanSnapshotText(UI_TEXT, uiLocale())
      source = bundle.createPlanSnapshotSource({
        root: deps.root,
        ...(deps.networkPolicy !== undefined && { networkPolicy: deps.networkPolicy }),
      })
    }
    return await source(goal, asOf, signal)
  }
}

/**
Every estimator plan problem in the loader's root, the bundle required
the first time it is asked for and kept from then on. Evidence-free: no
git, no `gh`, no network. Empty means every goal is forecastable.
*/
export function planCheckLoader(
  deps: PlanSnapshotLoaderDeps,
): (signal?: AbortSignal) => Promise<string[]> {
  let check: ((signal?: AbortSignal) => Promise<string[]>) | undefined
  return async (signal) => {
    if (check === undefined) {
      const { bundlePath } = deps
      const bundle = requireSnapshotBundle(deps)
      if (!isPlanCheckBundle(bundle)) {
        deps.log.error(`${bundlePath} does not export the plan check`)
        if (deps.loadBundle === undefined) {
          forgetFile(bundlePath)
        }
        throw new EstimateDiagnosticError('estimate-unavailable', UI_TEXT.estimateUnavailable)
      }
      // Each bundle keeps its own language state: the snapshot bundle gets
      // the caller's table before it reads anything.
      bundle.installPlanSnapshotText(UI_TEXT, uiLocale())
      check = bundle.createPlanCheckSource({ root: deps.root })
    }
    return await check(signal)
  }
}
