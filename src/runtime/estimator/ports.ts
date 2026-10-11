import { EstimateDiagnosticError } from '../../core/estimator/diagnostic'
// The capacity estimator's headless bindings (M117, PLAN.md D97): the same
// ports the extension assembles, with this machine as the fleet. The
// snapshot reads the requesting session's workspace root (one cached
// estimator per root, never the process working directory) with its git
// evidence through the shared core adapter; networked `gh` reads stay off
// headless. The board, broker and catalog bindings belong to unmerged
// milestones (M96, M109, M110) and refuse with their handoff names until
// those merge; price lookups stay off outside the editor (M80, D65).
// History appends arrive with M115's lane-finished trigger.
import path from 'node:path'
import { createAcpEstimate, type AcpEstimatePort } from '../../acp/estimate'
import { lazyEstimator, type EstimatorSourcePorts } from '../../host/estimator/estimatorBundle'
import { estimatorSourcePorts } from '../../host/estimator/localFleet'
import { planCheckLoader, planSnapshotLoader } from '../../host/estimator/planSnapshotBundle'
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
export function runtimeEstimatorPorts(
  deps: RuntimeEstimatorPortsDeps & { readonly root: string },
): EstimatorSourcePorts {
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
      root: deps.root,
      // No Reports policy: headless runs never do networked reads (D65).
      ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    }),
  )
}

/** The snapshot bundle beside the estimator engine bundle. */
function portsWith(deps: RuntimeEstimatorDeps, root: string): () => EstimatorSourcePorts {
  return () =>
    runtimeEstimatorPorts({
      snapshotBundlePath: path.join(path.dirname(deps.bundlePath), PLAN_SNAPSHOT_BUNDLE_FILE),
      log: deps.log,
      root,
      ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    })
}

/** An estimator bound to one workspace root; one lives per root. */
function estimatorFor(
  deps: RuntimeEstimatorDeps,
  root: string,
  cache: Map<string, ReturnType<typeof lazyEstimator>>,
): ReturnType<typeof lazyEstimator> {
  const known = cache.get(root)
  if (known !== undefined) return known
  const estimator = lazyEstimator({
    bundlePath: deps.bundlePath,
    log: deps.log,
    ports: portsWith(deps, root),
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
  })
  cache.set(root, estimator)
  return estimator
}

/** The ACP agent's `/estimate`: headless estimates over the local fleet. */
export function createRuntimeEstimate(deps: RuntimeEstimatorDeps): AcpEstimatePort {
  // Each requesting session reads its own workspace root: an editor that
  // opened workspace B never estimates workspace A's plan, and each root's
  // estimator is built once and reused.
  const estimators = new Map<string, ReturnType<typeof lazyEstimator>>()
  // Price formatting is root-independent, but it still runs through the
  // requesting session's own estimator: nothing here reads process.cwd().
  let active: ReturnType<typeof lazyEstimator> | undefined
  const forSession = (cwd: string): ReturnType<typeof lazyEstimator> =>
    estimatorFor(deps, cwd, estimators)
  const checks = new Map<string, ReturnType<typeof planCheckLoader>>()
  const checkFor = (cwd: string): ReturnType<typeof planCheckLoader> => {
    const known = checks.get(cwd)
    if (known !== undefined) return known
    const check = planCheckLoader({
      bundlePath: path.join(path.dirname(deps.bundlePath), PLAN_SNAPSHOT_BUNDLE_FILE),
      log: deps.log,
      root: cwd,
    })
    checks.set(cwd, check)
    return check
  }
  return createAcpEstimate({
    // Outside the editor there is no workspace preference: headless runs
    // optimize for cost under their budget (M80, PLAN.md D65).
    context: () => ({ asOf: new Date().toISOString(), optimize: 'cost' }),
    runner: (cwd) => ({
      estimate: (request, signal) => {
        const estimator = forSession(cwd)
        active = estimator
        return estimator.estimate(request, signal)
      },
    }),
    checkPlan: (cwd, signal) => checkFor(cwd)(signal),
    money: {
      price: (price) => {
        if (active === undefined) throw new EstimateDiagnosticError('running')
        return active.price(price)
      },
    },
  })
}

/** Standalone estimate uses the same lazy engine without starting an agent. */
export async function runRuntimeEstimateCommand(
  argv: readonly string[],
  deps: RuntimeEstimatorDeps & { write(text: string): void; error(text: string): void },
): Promise<number> {
  // The standalone command runs in the requesting workspace: its own
  // invocation directory is the session root, read once at entry.
  const root = process.cwd()
  const runner = lazyEstimator({ ...deps, ports: portsWith(deps, root) })
  const check = planCheckLoader({
    bundlePath: path.join(path.dirname(deps.bundlePath), PLAN_SNAPSHOT_BUNDLE_FILE),
    log: deps.log,
    root,
  })
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
    checkPlan: (signal) => check(signal),
  })
}
