// The estimate's local fleet (M117, PLAN.md D97): this machine, measured,
// nothing invented. Cores and RAM come from the OS; disks stay unknown
// (Node cannot read headroom); the machine runs one lane at a time
// (governor and caps of one) with one slot per lane kind the estimate holds.
// Account rates are unknown until their owner reports them.
// A local estimate never claims quota it cannot see (see
// docs/certification/m117.md). Unsupported platforms refuse instead of
// guessing a class.
import * as os from 'node:os'
import { ESTIMATE_BYTES_PER_GIB, ESTIMATE_RAM_ROUND_GIB } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { fleetSnapshotSchema, type EstimateLane, type FleetSnapshot } from '../../shared/estimate'
import type { EstimatorSourcePorts } from './estimatorBundle'
import { applyFleetBinding, type FleetBindingIo } from './fleetBinding'

export interface LocalHost {
  readonly platform: string
  readonly arch: string
  readonly cores: number
  readonly ramGiB: number
}

type MachineOs = 'macos' | 'linux' | 'windows'
const MACHINE_OS: ReadonlyMap<string, MachineOs> = new Map<string, MachineOs>([
  ['darwin', 'macos'],
  ['linux', 'linux'],
  ['win32', 'windows'],
])

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** This machine's fleet for these lanes; refuses platforms it cannot name. */
export function fleetFromHost(
  host: LocalHost,
  lanes: readonly EstimateLane[],
  asOf: string,
): FleetSnapshot {
  // Node names Windows `win32` and macOS `darwin`; the fleet names them by OS.
  const machineOs = MACHINE_OS.get(host.platform)
  if (machineOs === undefined) refuse('unsupported-platform')
  if (host.arch !== 'x64' && host.arch !== 'arm64') refuse('unsupported-platform')
  if (!(host.cores > 0) || !(host.ramGiB > 0)) refuse('unsupported-platform')
  // Code-unit order, independent of the host's language and ICU version.
  const kinds = [...new Set(lanes.map((lane) => lane.kind))].toSorted((left, right) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
  return fleetSnapshotSchema.parse({
    asOf,
    machines: [
      {
        id: 'local',
        classId: `${machineOs}-${host.arch}`,
        source: 'local',
        os: machineOs,
        architecture: host.arch,
        cores: Math.floor(host.cores),
        // One decimal to match the floor (1 is allowlisted inline).
        ramGiB: Math.max(ESTIMATE_RAM_ROUND_GIB, Number(host.ramGiB.toFixed(1))),
        disks: [
          // Unknown measurements carry no byte fields at all: an explicit
          // unknown is never a zero.
          { status: 'unknown', volumeId: 'primary', roles: ['workspace', 'temp', 'state'] },
        ],
        governorSlots: 1,
        capacityByKind: kinds.map((kind) => ({ kind, slots: 1 })),
        caps: { slots: 1, cpuPercent: 100, memoryPercent: 100 },
      },
    ],
    roles: [{ id: 'local', laneKinds: kinds }],
    accounts: [
      {
        id: 'local',
        providerId: 'local',
      },
    ],
    slots: [{ id: 'local-0', machineId: 'local', roleId: 'local', accountId: 'local' }],
    ci: [],
  })
}

/** A milestone binding that refuses with its handoff name until it merges. */
function missingEstimateBinding(dependency: string): never {
  throw new Error(fill(UI_TEXT.estimateWaiting, { dependency }))
}

/**
 * The milestone bindings every shell assembles (M117, PLAN.md D97): this
 * machine measured as the fleet, with M107's caps, M108's account rows and
 * CI concurrency applied when their readers are passed (C-M117-3); the
 * snapshot reads the workspace plan through the shared core adapter
 * (C-M117-1); the board, broker and catalog bindings refuse with their
 * handoff names until those merge; history appends arrive with M115's
 * lane-finished trigger. Only the price lookup differs.
 */
export function estimatorSourcePorts(
  priceLookup: EstimatorSourcePorts['priceLookup'],
  snapshot: EstimatorSourcePorts['snapshot'],
  fleetIo?: FleetBindingIo,
): EstimatorSourcePorts {
  const read = (lanes: readonly EstimateLane[], asOf: string): Promise<FleetSnapshot> =>
    applyFleetBinding(localFleet(lanes, asOf), fleetIo ?? {})
  return {
    snapshot,
    fleet: read,
    history: () => Promise.resolve([]),
    candidatePool: read,
    beginEstimate: () => {
      // This memo belongs only to the requesting invocation, including concurrent ones.
      let snapshot: Promise<FleetSnapshot> | undefined
      const once = (lanes: readonly EstimateLane[], asOf: string): Promise<FleetSnapshot> =>
        (snapshot ??= read(lanes, asOf))
      return { fleet: once, candidatePool: once }
    },
    board: () => ({
      audit: () => missingEstimateBinding('M117-W-M96-board'),
      start: () => missingEstimateBinding('M117-W-M96-board'),
    }),
    prices: () => ({
      cached: () => missingEstimateBinding('M117-W-M113-catalog'),
      store: () => missingEstimateBinding('M117-W-M113-catalog'),
      fetchPublic: () => missingEstimateBinding('M117-W-M113-catalog'),
    }),
    priceLookup,
  }
}

/** This machine's fleet at the request's asOf: cores are read at call time
 * (hot-plugged cores count) but the stamp is passed through, never a second
 * clock, so the inputs' fleet/request equality holds. */
export function localFleet(lanes: readonly EstimateLane[], asOf: string): FleetSnapshot {
  return fleetFromHost(
    {
      platform: os.platform(),
      arch: os.arch(),
      cores: os.cpus().length,
      ramGiB: os.totalmem() / ESTIMATE_BYTES_PER_GIB,
    },
    lanes,
    asOf,
  )
}
