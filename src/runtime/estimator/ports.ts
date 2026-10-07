// The capacity estimator's headless bindings (M117, PLAN.md D97): the same
// refusing ports the extension assembles, with this machine as the fleet.
// The snapshot, board, broker and catalog bindings belong to unmerged
// milestones (M113, M96, M109, M110) and refuse with their handoff names
// until those merge; price lookups stay off outside the editor (M80, D65).
// History appends arrive with M115's lane-finished trigger.
import { createAcpEstimate, type AcpEstimatePort } from '../../acp/estimate'
import { lazyEstimator, type EstimatorSourcePorts } from '../../host/estimator/estimatorBundle'
import { localFleet } from '../../host/estimator/localFleet'
import type { Logger } from '../../host/logger'
import { fill, UI_TEXT } from '../../shared/l10n/text'

export interface RuntimeEstimatorDeps {
  /** dist/estimator.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function missing(dependency: string): never {
  throw new Error(fill(UI_TEXT.estimateWaiting, { dependency }))
}

/** The milestone bindings; each refuses with its handoff until it merges. */
export function runtimeEstimatorPorts(): EstimatorSourcePorts {
  return {
    snapshot: () => missing('M117-W-M113-plan-reader'),
    fleet: (lanes) => Promise.resolve(localFleet(lanes)),
    history: () => Promise.resolve([]),
    candidatePool: (lanes) => Promise.resolve(localFleet(lanes)),
    board: () => ({
      audit: () => missing('M117-W-M96-board'),
      start: () => missing('M117-W-M96-board'),
    }),
    prices: () => ({
      cached: () => missing('M117-W-M113-catalog'),
      store: () => missing('M117-W-M113-catalog'),
      fetchPublic: () => missing('M117-W-M113-catalog'),
    }),
    priceLookup: () => ({
      enabled: false,
      networkAllowed: false,
      maxAgeMs: 0,
      catalogUrls: [],
    }),
  }
}

/** The ACP agent's `/estimate`: headless estimates over the local fleet. */
export function createRuntimeEstimate(deps: RuntimeEstimatorDeps): AcpEstimatePort {
  const estimator = lazyEstimator({
    bundlePath: deps.bundlePath,
    log: deps.log,
    ports: runtimeEstimatorPorts,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
  })
  return createAcpEstimate({
    // Outside the editor there is no workspace preference: headless runs
    // optimize for cost under their budget (M80, PLAN.md D65).
    context: () => ({ asOf: new Date().toISOString(), optimize: 'cost' }),
    runner: () => ({
      estimate: (request, signal) => estimator.estimate(request, signal),
    }),
    money: { price: (price) => estimator.price(price) },
  })
}
