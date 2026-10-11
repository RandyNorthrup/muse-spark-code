// The estimate's fleet binding (M117 C-M117-3, PLAN.md D97): this machine's
// measured row plus the milestone sources that constrain it. M107's resource
// governor contributes the serial capacity (one lane at a time, one slot per
// lane kind) and the configured CPU/memory caps; M108's account registry
// contributes account rows with usage-limit windows only when both allowance
// and measured remaining are known (otherwise the schedule qualifies them as
// unknown, never as zeroes); GitHub CI contributes a concurrency row only
// when both the limit and the occupied count are known. The binding samples
// no volatile level: a forecast predicts configured capacity, and a live
// throttle or pause would make identical goals forecast differently minute
// to minute (D97 acceptance 2). Paired devices (M100) and Muse nodes (M110)
// have no rows until those milestones merge: a lane whose affinity names one
// stays unschedulable with its reason, never an empty success. Every
// override re-parses through fleetSnapshotSchema: a corrupt reader refuses,
// never a widened fleet.
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../shared/estimate'

type FleetMachine = FleetSnapshot['machines'][number]
type FleetAccount = FleetSnapshot['accounts'][number]
type FleetCi = FleetSnapshot['ci'][number]

/** M107's configured ceilings for the forecast fleet (PLAN.md D97). */
export interface FleetCapacityCaps {
  readonly cpuMaxPercent: number
  readonly memoryMaxPercent: number
}

/**
 * The milestone readers behind the fleet. Each is injected: the estimator
 * ports run in the activation bundle and the headless runtime, where the
 * governor's live handles, the account store and the workspace root are not
 * all reachable. Absent readers keep this machine's measured fleet exactly
 * as certified (one serial local row, a demand-budgeted account, no CI).
 */
export interface FleetBindingIo {
  /** M107's configured CPU/memory caps; absent keeps the measured row. */
  readonly capacityCaps?: (() => FleetCapacityCaps) | undefined
  /**
   * M108's account rows, allowance with measured remaining. One row rebinds
   * the local slot to it; several refuse: one serial slot cannot choose
   * between accounts, and guessing the mapping would invent spend.
   */
  readonly accounts?: (() => readonly FleetAccount[]) | undefined
  /** GitHub CI concurrency, limit with occupied count; absent means no row. */
  readonly ci?: (() => readonly FleetCi[]) | undefined
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/**
 * This machine's fleet with the milestone rows applied. The base stays the
 * measured local row; overrides replace only their own rows and the whole
 * snapshot re-parses, so a corrupt reader refuses with its detail.
 */
export function applyFleetBinding(base: FleetSnapshot, io: FleetBindingIo = {}): FleetSnapshot {
  const machine = base.machines.find((entry) => entry.source === 'local') ?? base.machines[0]
  if (machine === undefined) refuse('missing-machine')
  const local: FleetMachine = machine
  let machines = base.machines
  if (io.capacityCaps !== undefined) {
    const caps = io.capacityCaps()
    // The fleet contract owns these bounds (0–100 percent): a corrupt
    // reader refuses instead of widening the forecast.
    const isPercent = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    if (!isPercent(caps.cpuMaxPercent) || !isPercent(caps.memoryMaxPercent))
      refuse('fleet-caps-invalid')
    const bounded: FleetMachine['caps'] = {
      ...local.caps,
      cpuPercent: caps.cpuMaxPercent,
      memoryPercent: caps.memoryMaxPercent,
    }
    machines = base.machines.map((entry) =>
      entry.id === local.id ? { ...entry, caps: bounded } : entry,
    )
  }
  let accounts = base.accounts
  let slots = base.slots
  if (io.accounts !== undefined) {
    const rows = io.accounts()
    const [row] = rows
    if (row === undefined || rows.length !== 1) refuse('fleet-accounts-ambiguous')
    accounts = [{ ...row }]
    // One serial machine has one slot: it spends the one bound account.
    slots = base.slots.map((slot) =>
      slot.machineId === local.id ? { ...slot, accountId: row.id } : slot,
    )
  }
  const ci = io.ci === undefined ? base.ci : io.ci().map((row) => ({ ...row }))
  return fleetSnapshotSchema.parse({ ...base, machines, accounts, slots, ci })
}
