// The estimate's local fleet (M117, PLAN.md D97): this machine, measured,
// nothing invented. Cores and RAM come from the OS; disks stay unknown
// (Node cannot read headroom); the machine runs one lane at a time
// (governor and caps of one) with one slot per lane kind the estimate holds.
// API rate limits are not modeled here: the one `local` account is budgeted
// to the lanes' own declared demand, so it never binds, until the account
// bindings merge. A local estimate never claims quota it cannot see (see
// docs/certification/m117.md). Unsupported platforms refuse instead of
// guessing a class.
import * as os from 'node:os'
import {
  ESTIMATE_BYTES_PER_GIB,
  ESTIMATE_RAM_ROUND_GIB,
  MINUTES_PER_HOUR,
} from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { fleetSnapshotSchema, type EstimateLane, type FleetSnapshot } from '../../shared/estimate'
import type { EstimatorSourcePorts } from './estimatorBundle'

export interface LocalHost {
  readonly platform: string
  readonly arch: string
  readonly cores: number
  readonly ramGiB: number
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** This machine's fleet for these lanes; refuses platforms it cannot name. */
export function fleetFromHost(
  host: LocalHost,
  lanes: readonly EstimateLane[],
  asOf: string,
): FleetSnapshot {
  const machineOs = host.platform === 'darwin' ? 'macos' : host.platform
  if (machineOs !== 'macos' && machineOs !== 'linux' && machineOs !== 'windows')
    refuse('unsupported-platform')
  if (host.arch !== 'x64' && host.arch !== 'arm64') refuse('unsupported-platform')
  if (!(host.cores > 0) || !(host.ramGiB > 0)) refuse('unsupported-platform')
  // Code-unit order, independent of the host's language and ICU version.
  const kinds = [...new Set(lanes.map((lane) => lane.kind))].toSorted((left, right) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
  // The local account is budgeted to the lanes' own declared demand, so it
  // never rate-limits: this machine spends the user's own subscriptions,
  // whose limits the estimator cannot see. Undeclared demand budgets zero;
  // the schedule refuses lanes whose demand it cannot read.
  const demand = (unit: 'requests' | 'tokens'): number => {
    let total = 0
    for (const lane of lanes) {
      const quantity =
        unit === 'requests'
          ? lane.resources.accountRequestsPerHour
          : lane.resources.accountTokensPerHour
      total += quantity.status === 'known' ? quantity.value : 0
    }
    return total
  }
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
        requestsPerMinute: Math.ceil(demand('requests') / MINUTES_PER_HOUR),
        tokensPerMinute: Math.ceil(demand('tokens') / MINUTES_PER_HOUR),
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
 * The refusing milestone bindings every shell assembles (M117, PLAN.md D97):
 * this machine measured as the fleet; the snapshot, board, broker and catalog
 * bindings refuse with their handoff names until those merge; history appends
 * arrive with M115's lane-finished trigger. Only the price lookup differs.
 */
export function estimatorSourcePorts(
  priceLookup: EstimatorSourcePorts['priceLookup'],
): EstimatorSourcePorts {
  return {
    snapshot: () => missingEstimateBinding('M117-W-M113-plan-reader'),
    fleet: (lanes) => Promise.resolve(localFleet(lanes)),
    history: () => Promise.resolve([]),
    candidatePool: (lanes) => Promise.resolve(localFleet(lanes)),
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

/** This machine's fleet now. Read at call time: hot-plugged cores count. */
export function localFleet(lanes: readonly EstimateLane[]): FleetSnapshot {
  return fleetFromHost(
    {
      platform: os.platform(),
      arch: os.arch(),
      cores: os.cpus().length,
      ramGiB: os.totalmem() / ESTIMATE_BYTES_PER_GIB,
    },
    lanes,
    new Date().toISOString(),
  )
}
