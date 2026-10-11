// The estimate's fleet binding (M117 C-M117-3, PLAN.md D97): this machine's
// measured row plus the milestone sources that constrain it. M107's resource
// settings contribute the configured CPU/memory caps AND the parallelism
// derived from them (see fleetSlotsForCaps), so a tightened ceiling really
// shapes admission, finish time and the bottleneck instead of sitting in
// unread percent fields. M108's
// account registry contributes the ACTIVE account's row with usage-limit
// windows only when both allowance and measured remaining are known
// (otherwise the schedule qualifies them as unknown, never as zeroes);
// zero accounts, or no usable limits, keep the measured demand-budgeted row
// instead of refusing: a normal multi-account user is never met with an
// 'ambiguous' refusal. GitHub CI contributes a concurrency row only when
// both the limit and the occupied count are known; no captured shape names a
// concurrency limit (AGENTS.md rule 14), so production carries no CI row and
// a lane that declares CI demand refuses with the schedule's true reason.
// The binding samples no volatile level: a forecast predicts configured
// capacity, and a live throttle or pause would make identical goals forecast
// differently minute to minute (D97 acceptance 2). Paired devices (M100) and
// Muse nodes (M110) have no rows until those milestones merge: a lane whose
// affinity names one stays unschedulable with its reason, never an empty
// success. Every override re-parses through fleetSnapshotSchema: a corrupt
// reader refuses with a named detail, never a raw $ZodError and never a
// widened fleet.
import { fill, UI_TEXT } from '../../shared/l10n/text'
import {
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import {
  readResourceSettings,
  type ResourceSettingOrigin,
  type ResourceSettingsReader,
} from '../../shared/resources'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../shared/estimate'
import type { Account } from '../../shared/accounts'
import type { AccountLimitsSnapshot } from '../../core/accounts/thresholds'

type FleetMachine = FleetSnapshot['machines'][number]
type FleetAccount = FleetSnapshot['accounts'][number]
type FleetCi = FleetSnapshot['ci'][number]
type MaybeAsync<T> = T | Promise<T>

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
 * Readers may be asynchronous (the account registry and CI evidence are).
 */
export interface FleetBindingIo {
  /**
   * M107's configured CPU/memory caps; absent, or resolving undefined,
   * keeps the measured row.
   */
  readonly capacityCaps?: (() => MaybeAsync<FleetCapacityCaps | undefined>) | undefined
  /**
   * M108's ACTIVE account row, already selected and translated (see
   * fleetAccountFromLimits). Undefined keeps the measured demand-budgeted
   * row: zero accounts, several accounts with none selected, or limits the
   * reader cannot see never refuse the estimate. An absent requests-per-
   * minute inherits the measured demand budget; every other field is the
   * reader's own.
   */
  readonly accounts?: (() => MaybeAsync<FleetAccountDraft | undefined>) | undefined
  /** GitHub CI concurrency, limit with occupied count; absent means no row. */
  readonly ci?: (() => MaybeAsync<readonly FleetCi[]>) | undefined
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** No active account is bound in this host: the measured row stands in. */
function noActiveAccount(): FleetAccountDraft | undefined {
  return
}

/** No workspace configuration exists in this host: the schema defaults apply. */
function noSettingOrigin(): ResourceSettingOrigin | undefined {
  return
}

/**
 * A translated active row: the requests rate may stay absent when the
 * reader saw no requests bucket, and the binding then inherits the measured
 * demand budget for that one dimension (never a zero). Anything corrupt
 * still refuses at the final re-parse with `fleet-account-invalid`.
 */
export interface FleetAccountDraft {
  readonly id: string
  readonly providerId: string
  readonly requestsPerMinute?: number | undefined
  readonly tokensPerMinute?: number | undefined
  readonly usageLimits?: FleetAccount['usageLimits'] | undefined
}

/**
 * Forecast slots for M107's ceilings on this machine. The governor's live
 * capacity (ResourceGovernor.capacity) cannot shape a deterministic forecast
 * — sampling it would break D97 acceptance 2 — so the forecast projects its
 * contract instead: a null live capacity keeps the caller's configured caps,
 * and the configured parallelism for the local machine is its cores scaled
 * by the tighter ceiling, with one serial slot as the floor. A zeroed
 * ceiling forecasts zero slots, so lanes refuse as unschedulable (their true
 * reason: no capacity), never as an empty success.
 */
export function fleetSlotsForCaps(
  cores: number,
  cpuMaxPercent: number,
  memoryMaxPercent: number,
): number {
  if (!Number.isFinite(cores) || cores <= 0) refuse('fleet-caps-invalid')
  if (
    !Number.isFinite(cpuMaxPercent) ||
    cpuMaxPercent < 0 ||
    cpuMaxPercent > 100 ||
    !Number.isFinite(memoryMaxPercent) ||
    memoryMaxPercent < 0 ||
    memoryMaxPercent > 100
  )
    refuse('fleet-caps-invalid')
  // Ceil, so a nonzero ceiling keeps the serial lane: flooring would refuse
  // the whole estimate at small-but-valid ceilings (1% of 8 cores is still a
  // lane at a time). Only a zeroed ceiling forecasts zero slots.
  return Math.max(0, Math.ceil(cores * (Math.min(cpuMaxPercent, memoryMaxPercent) / 100)))
}

/**
 * This machine's fleet with the milestone rows applied. The base stays the
 * measured local row; overrides replace only their own rows and the whole
 * snapshot re-parses, so a corrupt reader refuses with a named detail.
 */
export async function applyFleetBinding(
  base: FleetSnapshot,
  io: FleetBindingIo = {},
): Promise<FleetSnapshot> {
  const machine = base.machines.find((entry) => entry.source === 'local') ?? base.machines[0]
  if (machine === undefined) refuse('missing-machine')
  const local: FleetMachine = machine
  let machines = base.machines
  let slots = base.slots
  let accounts = base.accounts
  const caps = io.capacityCaps === undefined ? undefined : await io.capacityCaps()
  if (caps !== undefined) {
    // The fleet contract owns these bounds (0–100 percent): a corrupt
    // reader refuses instead of widening the forecast.
    const parallel = fleetSlotsForCaps(local.cores, caps.cpuMaxPercent, caps.memoryMaxPercent)
    const bounded: FleetMachine['caps'] = {
      slots: parallel,
      cpuPercent: caps.cpuMaxPercent,
      memoryPercent: caps.memoryMaxPercent,
    }
    machines = base.machines.map((entry) =>
      entry.id === local.id
        ? {
            ...entry,
            governorSlots: parallel,
            capacityByKind: entry.capacityByKind.map((capacity) => ({
              ...capacity,
              slots: parallel,
            })),
            caps: bounded,
          }
        : entry,
    )
    const roleId = base.slots.find((slot) => slot.machineId === local.id)?.roleId ?? 'local'
    const accountId = base.slots.find((slot) => slot.machineId === local.id)?.accountId ?? 'local'
    slots = Array.from({ length: parallel }, (_, index) => ({
      id: `local-${String(index)}`,
      machineId: local.id,
      roleId,
      accountId,
    }))
  }
  if (io.accounts !== undefined) {
    const row = await io.accounts()
    if (row !== undefined) {
      const fallback =
        base.accounts.find((account) => account.id === row.id)?.requestsPerMinute ??
        base.accounts.find((account) => account.id === 'local')?.requestsPerMinute ??
        base.accounts[0]?.requestsPerMinute
      const requestsPerMinute = row.requestsPerMinute ?? fallback ?? refuse('fleet-account-invalid')
      accounts = [{ ...row, requestsPerMinute }]
      // Every local slot spends the one bound account.
      const accountId = row.id
      slots = slots.map((slot) => (slot.machineId === local.id ? { ...slot, accountId } : slot))
    }
  }
  const ciRows = io.ci === undefined ? undefined : await io.ci()
  const ci = ciRows === undefined ? base.ci : ciRows.map((row) => ({ ...row }))
  const candidate = { ...base, machines, accounts, slots, ci }
  const parsed = fleetSnapshotSchema.safeParse(candidate)
  if (!parsed.success) {
    if (io.ci !== undefined) refuse('fleet-ci-invalid')
    if (io.accounts !== undefined) refuse('fleet-account-invalid')
    refuse('fleet-binding-invalid')
  }
  return parsed.data
}

/** Minutes from now until a limit reset; null when the window already lapsed. */
function minutesUntilReset(resetAt: string, nowMs: number): number | null {
  const resetMs = Date.parse(resetAt)
  return !Number.isFinite(resetMs) || resetMs <= nowMs
    ? null
    : (resetMs - nowMs) / MILLISECONDS_PER_MINUTE
}

export interface FleetAccountLimits {
  readonly providerId: string
  readonly account: Pick<Account, 'id'>
  readonly limits: AccountLimitsSnapshot
  readonly nowMs: number
}

/**
 * M108's active account translated into the fleet's row (PLAN.md D97): the
 * rate buckets become requests/tokens per minute at their sustainable
 * allowance rate, and each live bucket plus each dated plan window becomes
 * a usage-limit window carrying the MEASURED remaining, which is what pins
 * a depleted account past its reset. An expired or absent bucket constrains
 * nothing; unknown limits stay absent so the schedule discloses them as
 * unknown, never zero. Returns undefined when nothing usable was read, so
 * the caller keeps the measured demand-budgeted row. A vendor block pins
 * both rates at zero.
 */
export function fleetAccountFromLimits(input: FleetAccountLimits): FleetAccountDraft | undefined {
  const { providerId, account, limits, nowMs } = input
  if (!Number.isFinite(nowMs)) refuse('fleet-account-invalid')
  const isBlockedActive =
    limits.blocked !== undefined &&
    (limits.blocked.resetAt === null || Date.parse(limits.blocked.resetAt) > nowMs)
  if (isBlockedActive) {
    return { id: account.id, providerId, requestsPerMinute: 0, tokensPerMinute: 0 }
  }
  const windows: NonNullable<FleetAccount['usageLimits']> = []
  const bucket = (
    id: string,
    unit: 'requests' | 'tokens',
    entry: { limit: number; remaining: number; resetAt: string } | undefined,
  ): number | undefined => {
    if (entry === undefined) return undefined
    const minutes = minutesUntilReset(entry.resetAt, nowMs)
    if (minutes === null) return undefined
    const periodSeconds = Math.max(1, Math.round(minutes * SECONDS_PER_MINUTE))
    windows.push({
      id,
      kind: 'rolling',
      periodSeconds,
      unit,
      remaining: entry.remaining,
      allowance: entry.limit,
      resetsAt: entry.resetAt,
      timeZone: 'UTC',
    })
    // The sustainable rate, never the remaining: a depleted bucket must wait
    // for its reset through the window above, not refuse every rate check.
    return entry.limit / Math.max(1 / MINUTES_PER_HOUR, minutes)
  }
  const requestsPerMinute = bucket(
    `${account.id}-requests`,
    'requests',
    limits.rateLimits?.requests,
  )
  const tokensPerMinute = bucket(`${account.id}-tokens`, 'tokens', limits.rateLimits?.tokens)
  const planWindows = Object.entries(limits.planWindows ?? {})
  for (const [name, window] of planWindows) {
    if (window.resetAt === null) continue
    const minutes = minutesUntilReset(window.resetAt, nowMs)
    if (minutes === null) continue
    windows.push({
      id: `${account.id}-${name}`,
      kind: 'rolling',
      periodSeconds: Math.max(1, Math.round(minutes * SECONDS_PER_MINUTE)),
      unit: 'percent',
      remaining: 100 - window.usedPercent,
      allowance: 100,
      resetsAt: window.resetAt,
      timeZone: 'UTC',
    })
  }
  return requestsPerMinute !== undefined || tokensPerMinute !== undefined || windows.length > 0
    ? {
        id: account.id,
        providerId,
        ...(requestsPerMinute !== undefined && { requestsPerMinute }),
        ...(tokensPerMinute !== undefined && { tokensPerMinute }),
        ...(windows.length > 0 && { usageLimits: windows }),
      }
    : noActiveAccount()
}

/**
 * Which fleet row the local slot spends. The active account wins; otherwise
 * the first by order (zero accounts yield undefined and keep the measured
 * row). Several accounts never refuse: one serial fleet cannot choose, so
 * the caller names the choice instead of the binding guessing it.
 */
export function selectFleetAccount(
  accounts: readonly { readonly id: string }[],
  currentId: string | null,
): string | undefined {
  return currentId !== null && accounts.some((account) => account.id === currentId)
    ? currentId
    : accounts[0]?.id
}

/** The injected milestone sources behind one fleet call. */
export interface FleetSources {
  /** M107's settings; undefined keeps the measured row. */
  readonly settings: () => MaybeAsync<FleetCapacityCaps | undefined>
  /** M108's translated active row; undefined keeps the measured row. */
  readonly activeAccount: () => MaybeAsync<FleetAccountDraft | undefined>
  /** CI concurrency rows; empty means no row. */
  readonly ci: () => MaybeAsync<readonly FleetCi[]>
}

/** One fleet call's readers from the milestone sources. */
export function fleetIoFromSources(sources: FleetSources): FleetBindingIo {
  return {
    capacityCaps: () => sources.settings(),
    accounts: () => sources.activeAccount(),
    ci: () => sources.ci(),
  }
}

function settingsCaps(settings: {
  cpuMaxPercent: number
  memoryMaxPercent: number
}): FleetCapacityCaps {
  return { cpuMaxPercent: settings.cpuMaxPercent, memoryMaxPercent: settings.memoryMaxPercent }
}

/**
 * The extension host's sources (src/extension.ts): M107's settings read live
 * from the workspace configuration through readResourceSettings; the M108
 * account registry is not instantiated in the extension host, and no
 * captured shape names CI concurrency, so those stay absent and the measured
 * row and the schedule's true refusals stand in. `inspect` is the
 * configuration's own inspect function, so the test proves the exact keys.
 */
export function extensionFleetSources(deps: {
  readonly inspect: ResourceSettingsReader
}): FleetSources {
  return {
    settings: () => {
      try {
        return settingsCaps(readResourceSettings(deps.inspect))
      } catch {
        refuse('fleet-caps-invalid')
      }
    },
    activeAccount: () => noActiveAccount(),
    ci: () => [],
  }
}

/**
 * The headless runtime's sources (src/runtime/estimator/ports.ts): no
 * workspace configuration exists outside the editor, so M107's configured
 * defaults apply through the same readResourceSettings contract; networked
 * `gh` reads stay off headless (M80, D65), so CI stays absent with the
 * schedule's true refusal for lanes that declare it.
 */
export function headlessFleetSources(): FleetSources {
  return extensionFleetSources({ inspect: () => noSettingOrigin() })
}
