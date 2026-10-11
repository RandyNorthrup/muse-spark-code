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
import {
  fleetIoFromSources,
  headlessFleetSources,
  type FleetUsageOwners,
} from '../../host/estimator/fleetBinding'
import { estimatorSourcePorts } from '../../host/estimator/localFleet'
import { planCheckLoader, planSnapshotLoader } from '../../host/estimator/planSnapshotBundle'
import { runEstimateCommand, fleetFailure } from './command'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { PLAN_SNAPSHOT_BUNDLE_FILE } from '../../shared/constants'
import type { resourceMachineStore } from '../resources/settings'

interface ResourceSettingsBundleDeps {
  readonly loadResourceBundle?: ((file: string) => unknown) | undefined
}

export interface RuntimeEstimatorDeps extends ResourceSettingsBundleDeps {
  /** dist/estimator.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

export interface RuntimeEstimatorPortsDeps extends ResourceSettingsBundleDeps {
  /** dist/planSnapshot.js beside the running bundle. */
  readonly snapshotBundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The headless fleet owners: the agent data folder both the governor and the
 * estimate read, and the runtime's account registry (identity only). */
export interface HeadlessFleetOwners extends FleetUsageOwners {
  /** Agent data folder holding resources.json, the headless governor's file. */
  readonly machineDir: string
  /** The runtime's account registry: ids only, never credentials. */
  readonly accounts: {
    list(provider: string): Promise<readonly { readonly id: string }[]>
  }
}

/** The milestone bindings; board, broker and catalog refuse until they merge. */
export function runtimeEstimatorPorts(
  deps: RuntimeEstimatorPortsDeps & { readonly root: string } & HeadlessFleetOwners,
): EstimatorSourcePorts {
  // The estimate's settings reader is the headless governor's own
  // resourceMachineStore over the same resources.json: a missing file carries
  // the schema defaults the governor itself runs, and a present file is the
  // configured value. Only the file is shared; the governor never starts.
  const settingsBundle = lazyBundleLoader({
    bundlePath: path.join(path.dirname(deps.snapshotBundlePath), 'resourceGovernor.js'),
    log: deps.log,
    label: 'resource settings',
    ...(deps.loadResourceBundle !== undefined && { loadBundle: deps.loadResourceBundle }),
    isBundle: (value: unknown): value is { resourceMachineStore: typeof resourceMachineStore } =>
      typeof value === 'object' &&
      value !== null &&
      'resourceMachineStore' in value &&
      typeof value.resourceMachineStore === 'function',
    unavailable: () => fleetFailure('fleet-caps-invalid settings').message,
  })
  let machine: ReturnType<typeof resourceMachineStore> | undefined
  const readSettings = () => {
    machine ??= settingsBundle().resourceMachineStore({
      settingsFile: path.join(deps.machineDir, 'resources.json'),
      resumeFile: path.join(deps.machineDir, 'resource-resume.json'),
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    })
    return machine.readSettingsWithOrigin()
  }
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
    // The estimate's fleet (M117 C-M117-3R3, PLAN.md D97): M107's thresholds
    // as facts through the governor's reader (slots stay certified); M108's
    // account identity through the runtime registry with limits unknown;
    // networked `gh` reads stay off (D65), so CI stays not read and lanes
    // declaring it refuse with the schedule's true reason.
    fleetIoFromSources(
      headlessFleetSources({
        readSettings: async () => {
          const result = await readSettings()
          return result.settings
        },
        readSettingsWithOrigin: readSettings,
        listAccounts: () => deps.accounts.list('meta'),
        readLiveLimits: deps.readLiveLimits,
        readUsage: deps.readUsage,
      }),
    ),
  )
}

/** The snapshot bundle beside the estimator engine bundle. */
function portsWith(
  deps: RuntimeEstimatorDeps & HeadlessFleetOwners,
  root: string,
): () => EstimatorSourcePorts {
  return () =>
    runtimeEstimatorPorts({
      snapshotBundlePath: path.join(path.dirname(deps.bundlePath), PLAN_SNAPSHOT_BUNDLE_FILE),
      log: deps.log,
      root,
      ...(deps.loadResourceBundle !== undefined && { loadResourceBundle: deps.loadResourceBundle }),
      machineDir: deps.machineDir,
      accounts: deps.accounts,
      readLiveLimits: deps.readLiveLimits,
      readUsage: deps.readUsage,
      ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    })
}

/** An estimator bound to one workspace root; one lives per root. */
function estimatorFor(
  deps: RuntimeEstimatorDeps & HeadlessFleetOwners,
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
export function createRuntimeEstimate(
  deps: RuntimeEstimatorDeps & HeadlessFleetOwners,
): AcpEstimatePort {
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
        if (active === undefined) throw new Error('estimate has not run yet')
        return active.price(price)
      },
    },
  })
}

/** Standalone estimate uses the same lazy engine without starting an agent. */
export async function runRuntimeEstimateCommand(
  argv: readonly string[],
  deps: RuntimeEstimatorDeps & {
    write(text: string): void
    error(text: string): void
  } & HeadlessFleetOwners,
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
