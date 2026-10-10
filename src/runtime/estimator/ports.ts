// The capacity estimator's headless bindings (M117, PLAN.md D97): the same
// ports the extension assembles, with this machine as the fleet. The
// snapshot reads the working directory's PLAN.md with its git and `gh`
// evidence through the shared core adapter; the board, broker and catalog
// bindings belong to unmerged milestones (M96, M109, M110) and refuse with
// their handoff names until those merge; price lookups stay off outside the
// editor (M80, D65). History appends arrive with M115's lane-finished trigger.
import path from 'node:path'
import { createAcpEstimate, type AcpEstimatePort } from '../../acp/estimate'
import { lazyEstimator, type EstimatorSourcePorts } from '../../host/estimator/estimatorBundle'
import { estimatorSourcePorts } from '../../host/estimator/localFleet'
import { planSnapshotLoader } from '../../host/estimator/planSnapshotBundle'
import { runEstimateCommand } from './command'
import type { Logger } from '../../host/logger'
import { PLAN_SNAPSHOT_BUNDLE_FILE } from '../../shared/constants'

export interface RuntimeEstimatorDeps {
  /** dist/estimator.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

export interface RuntimeEstimatorPortsDeps {
  /** dist/planSnapshot.js beside the running bundle. */
  readonly snapshotBundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The milestone bindings; board, broker and catalog refuse until they merge. */
export function runtimeEstimatorPorts(deps: RuntimeEstimatorPortsDeps): EstimatorSourcePorts {
  return estimatorSourcePorts(
    () => ({
      enabled: false,
      networkAllowed: false,
      maxAgeMs: 0,
      catalogUrls: [],
    }),
    planSnapshotLoader({
      bundlePath: deps.snapshotBundlePath,
      log: deps.log,
      root: process.cwd(),
      ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    }),
  )
}

/** The snapshot bundle beside the estimator engine bundle. */
function portsWith(deps: RuntimeEstimatorDeps): () => EstimatorSourcePorts {
  return () =>
    runtimeEstimatorPorts({
      snapshotBundlePath: path.join(path.dirname(deps.bundlePath), PLAN_SNAPSHOT_BUNDLE_FILE),
      log: deps.log,
      ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    })
}

/** The ACP agent's `/estimate`: headless estimates over the local fleet. */
export function createRuntimeEstimate(deps: RuntimeEstimatorDeps): AcpEstimatePort {
  const estimator = lazyEstimator({
    bundlePath: deps.bundlePath,
    log: deps.log,
    ports: portsWith(deps),
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

/** Standalone estimate uses the same lazy engine without starting an agent. */
export async function runRuntimeEstimateCommand(
  argv: readonly string[],
  deps: RuntimeEstimatorDeps & { write(text: string): void; error(text: string): void },
): Promise<number> {
  const runner = lazyEstimator({ ...deps, ports: portsWith(deps) })
  return await runEstimateCommand(argv, {
    context: () => ({ asOf: new Date().toISOString(), optimize: 'cost' }),
    runner,
    money: runner,
    write: (text) => {
      deps.write(text)
    },
    error: (text) => {
      deps.error(text)
    },
    signal: new AbortController().signal,
  })
}
