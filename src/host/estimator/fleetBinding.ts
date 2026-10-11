// The estimate's fleet binding (M117 C-M117-3R3, PLAN.md D97): every fleet
// value in a forecast is read from the component that owns it, through that
// component's own reader. The estimator never computes a fleet number.
//
// - Machine parallelism is the certified local row (one serial slot,
//   localFleet.ts): no configured slot cap exists for this surface (the teams
//   runner slots govern team agents, not estimate lanes; no lane-concurrency
//   setting exists), so the binding never writes a slot count. M107's
//   resource settings contribute only their throttle thresholds as facts on
//   the local row's caps (the governor throttles background work to one item
//   above them); the schedule never reads those percents for admission. With
//   the governor switched off there is no threshold row: the certified row
//   stands unchanged.
// - M108's account row carries only what the account owner said. A read rate
//   bucket becomes the rate; a read plan window with a captured duration
//   becomes a fixed rolling window over that captured period (never over the
//   time remaining); a window without one, and any percent window the lanes
//   cannot price, is stated, never converted and never dropped. With no read
//   limit the requests check is recorded as unknown, never passed against a
//   demand-sized number.
// - CI has no captured concurrency shape, so production carries no row and
//   the schedule records it as not read.
//
// When the owner cannot say, the row reads unknown and names the source. Each
// source validates on its own, so a corrupt machine reading, account or CI
// row refuses with its own detail on the production reader shape.
import { fill, UI_TEXT } from '../../shared/l10n/text'
import {
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import {
  readResourceSettings,
  type ResourceSettings,
  type ResourceSettingsReader,
} from '../../shared/resources'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../shared/estimate'
import type { Account } from '../../shared/accounts'
import type { AccountLimitsSnapshot } from '../../core/accounts/thresholds'

type FleetMachine = FleetSnapshot['machines'][number]
type FleetAccount = FleetSnapshot['accounts'][number]
type FleetCi = FleetSnapshot['ci'][number]
type MaybeAsync<T> = T | Promise<T>

/** M107's machine reading: throttle thresholds plus the on/off switch. */
export interface FleetMachineReading {
  readonly cpuMaxPercent: number
  readonly memoryMaxPercent: number
  readonly enabled: boolean
}

/**
 * What the M108 account owner said, or why it said nothing. `limits` carries
 * the owner's raw snapshot for the binding to translate; `registry` names an
 * account the registry lists but whose limits no reader holds; `no-reader`
 * is the typed seam for a surface with no account reader at all.
 */
export type FleetAccountSource =
  | {
      readonly kind: 'limits'
      readonly providerId: string
      readonly accountId: string
      readonly snapshot: AccountLimitsSnapshot
      readonly nowMs: number
    }
  | { readonly kind: 'registry'; readonly providerId: string; readonly accountId: string }
  | { readonly kind: 'no-reader'; readonly surface: 'editor' | 'runtime' }

/**
 * The milestone readers behind the fleet. Each is injected: the estimator
 * ports run in the activation bundle and the headless runtime, where the
 * governor's live handles, the account store and the workspace root are not
 * all reachable. Production assemblies define every reader; an absent reader
 * keeps this machine's measured fleet exactly as certified.
 */
export interface FleetBindingIo {
  /**
   * M107's machine reading; absent, or resolving undefined, keeps the
   * certified row. A reading with `enabled` false keeps it too: a governor
   * that is off states no threshold.
   */
  readonly settings?: (() => MaybeAsync<FleetMachineReading | undefined>) | undefined
  /**
   * M108's account source; absent keeps the measured row. A source that
   * names no read limit keeps the row's identity but drops its
   * demand-budgeted rate, so the schedule records the checks as unknown.
   */
  readonly activeAccount?: (() => MaybeAsync<FleetAccountSource | undefined>) | undefined
  /** CI concurrency rows; absent or empty means no row was read. */
  readonly ci?: (() => MaybeAsync<readonly FleetCi[]>) | undefined
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** A corrupt machine reading refuses instead of widening the forecast. */
function checkMachineReading(reading: FleetMachineReading): void {
  if (
    !Number.isFinite(reading.cpuMaxPercent) ||
    reading.cpuMaxPercent < 0 ||
    reading.cpuMaxPercent > 100 ||
    !Number.isFinite(reading.memoryMaxPercent) ||
    reading.memoryMaxPercent < 0 ||
    reading.memoryMaxPercent > 100 ||
    typeof reading.enabled !== 'boolean'
  )
    refuse('fleet-caps-invalid')
}

/**
 * This machine's fleet with the milestone rows applied. The base stays the
 * measured local row; the binding writes only read values, never a computed
 * slot count. Each source re-parses on its own, so a corrupt machine
 * reading is `fleet-caps-invalid`, a corrupt account `fleet-account-invalid`
 * and a corrupt CI row `fleet-ci-invalid`; a structural failure past all
 * three is `fleet-binding-invalid`.
 */
export async function applyFleetBinding(
  base: FleetSnapshot,
  io: FleetBindingIo = {},
): Promise<FleetSnapshot> {
  const machine = base.machines.find((entry) => entry.source === 'local') ?? base.machines[0]
  if (machine === undefined) refuse('missing-machine')
  const local: FleetMachine = machine
  // The handed fleet parses first: a broken structure (a slot invariant, a
  // dangling reference) is `fleet-binding-invalid`, never blamed on a source.
  if (!fleetSnapshotSchema.safeParse(base).success) refuse('fleet-binding-invalid')
  let candidate: FleetSnapshot = base
  const reading = io.settings === undefined ? undefined : await io.settings()
  if (reading !== undefined) {
    checkMachineReading(reading)
    // A governor that is off states no threshold: the certified row stands.
    let machines = base.machines
    if (reading.enabled) {
      machines = base.machines.map((entry) =>
        entry.id === local.id
          ? {
              ...entry,
              caps: {
                slots: entry.caps.slots,
                cpuPercent: reading.cpuMaxPercent,
                memoryPercent: reading.memoryMaxPercent,
              },
            }
          : entry,
      )
    }
    const parsed = fleetSnapshotSchema.safeParse({ ...base, machines })
    if (!parsed.success) refuse('fleet-caps-invalid')
    candidate = parsed.data
  }
  if (io.activeAccount !== undefined) {
    const source = await io.activeAccount()
    if (source !== undefined) {
      candidate = applyAccountSource(candidate, local, source)
      const parsed = fleetSnapshotSchema.safeParse(candidate)
      if (!parsed.success) refuse('fleet-account-invalid')
      candidate = parsed.data
    }
  }
  const ciRows = io.ci === undefined ? undefined : await io.ci()
  if (ciRows !== undefined) {
    const parsed = fleetSnapshotSchema.safeParse({
      ...candidate,
      ci: ciRows.map((row) => ({ ...row })),
    })
    if (!parsed.success) refuse('fleet-ci-invalid')
    candidate = parsed.data
  }
  return candidate
}

/** The account row for a source that named no read limit: identity without
 * rates, so every check records unknown and names where it looked. */
function unknownAccountRow(id: string, providerId: string, stated: string): FleetAccount {
  return { id, providerId, statedLimits: [stated] }
}

/** Apply one account source: read limits translate, anything else unknown. */
function applyAccountSource(
  base: FleetSnapshot,
  local: FleetMachine,
  source: FleetAccountSource,
): FleetSnapshot {
  const spend = (accountId: string): FleetSnapshot['slots'] =>
    base.slots.map((slot) => (slot.machineId === local.id ? { ...slot, accountId } : slot))
  if (source.kind === 'no-reader') {
    const row = unknownAccountRow(
      'local',
      'local',
      `unknown: no account reader in this ${source.surface}`,
    )
    return { ...base, accounts: [row], slots: spend('local') }
  }
  if (source.kind === 'registry') {
    const row = unknownAccountRow(
      source.accountId,
      source.providerId,
      `unknown: limits unread for ${source.providerId} ${source.accountId}`,
    )
    return { ...base, accounts: [row], slots: spend(source.accountId) }
  }
  const translated = fleetAccountFromLimits({
    providerId: source.providerId,
    account: { id: source.accountId },
    limits: source.snapshot,
    nowMs: source.nowMs,
  })
  if (translated === undefined) {
    const row = unknownAccountRow(
      source.accountId,
      source.providerId,
      `unknown: no usable limits for ${source.providerId} ${source.accountId}`,
    )
    return { ...base, accounts: [row], slots: spend(source.accountId) }
  }
  return {
    ...base,
    accounts: [
      {
        id: source.accountId,
        providerId: source.providerId,
        ...(translated.requestsPerMinute !== undefined && {
          requestsPerMinute: translated.requestsPerMinute,
        }),
        ...(translated.tokensPerMinute !== undefined && {
          tokensPerMinute: translated.tokensPerMinute,
        }),
        ...(translated.usageLimits !== undefined && { usageLimits: translated.usageLimits }),
        ...(translated.statedLimits.length > 0 && { statedLimits: [...translated.statedLimits] }),
      },
    ],
    slots: spend(source.accountId),
  }
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

/** The translated row: read rates, convertible windows, and stated limits. */
export interface FleetTranslatedAccount {
  readonly requestsPerMinute?: number | undefined
  readonly tokensPerMinute?: number | undefined
  readonly usageLimits?: FleetAccount['usageLimits'] | undefined
  readonly statedLimits: readonly string[]
}

/**
 * M108's account snapshot translated as what it is (PLAN.md D97). Rate
 * buckets become requests/tokens per minute at their sustainable allowance
 * rate over the current window. A plan window with a captured duration
 * becomes a fixed percent window over that captured period; a plan window
 * without one is stated, never shaped from the time remaining. A full window
 * (or vendor block) with a future reset and a read rate becomes a
 * zero-remaining requests window, so the forecast waits for the reset and
 * names the account rate as its bottleneck; without a read rate the account
 * cannot be forecast past the block and refuses as `fleet-account-blocked`
 * naming the account and the reset. An expired or absent bucket constrains
 * nothing. Returns undefined when nothing usable was read. A vendor block
 * with no reset refuses: paid work on that account cannot start.
 */
export function fleetAccountFromLimits(
  input: FleetAccountLimits,
): FleetTranslatedAccount | undefined {
  const { providerId, account, limits, nowMs } = input
  if (!Number.isFinite(nowMs)) refuse('fleet-account-invalid')
  const windows: NonNullable<FleetAccount['usageLimits']> = []
  const stated: string[] = []
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
  const fullResets: string[] = []
  const planWindows = Object.entries(limits.planWindows ?? {})
  for (const [name, window] of planWindows) {
    if (window.resetAt === null) continue
    const minutes = minutesUntilReset(window.resetAt, nowMs)
    if (minutes === null) continue
    if (window.usedPercent >= 100) {
      fullResets.push(window.resetAt)
      continue
    }
    if (window.windowDurationMins === undefined) {
      stated.push(
        `${account.id}-${name}: ${String(window.usedPercent)}% used, resets ${window.resetAt}; percent demand of these lanes unknown`,
      )
    } else {
      windows.push({
        id: `${account.id}-${name}`,
        kind: 'rolling',
        periodSeconds: Math.max(1, Math.round(window.windowDurationMins * SECONDS_PER_MINUTE)),
        unit: 'percent',
        remaining: 100 - window.usedPercent,
        allowance: 100,
        resetsAt: window.resetAt,
        timeZone: 'UTC',
      })
    }
  }
  const hasVendorBlock =
    limits.blocked !== undefined &&
    (limits.blocked.resetAt === null || Date.parse(limits.blocked.resetAt) > nowMs)
  // undefined: no vendor block; null: blocked with no reset; string: dated.
  const vendorReset: string | null | undefined = hasVendorBlock
    ? (limits.blocked?.resetAt ?? null)
    : undefined
  const latestFull = fullResets.toSorted((left, right) => Date.parse(right) - Date.parse(left))[0]
  if (vendorReset === undefined && latestFull === undefined) {
    // No block: rates, convertible windows and stated limits stand as read.
  } else if (vendorReset === null) {
    refuse(`fleet-account-blocked ${providerId}/${account.id} no-reset`)
  } else {
    const resetAt = vendorReset ?? latestFull ?? refuse('fleet-account-blocked')
    if (requestsPerMinute === undefined) {
      refuse(`fleet-account-blocked ${providerId}/${account.id} ${resetAt}`)
    } else {
      const minutes = minutesUntilReset(resetAt, nowMs)
      if (minutes === null) {
        // The reset lapsed while translating: the block no longer constrains.
      } else {
        const periodSeconds = Math.max(1, Math.round(minutes * SECONDS_PER_MINUTE))
        windows.push({
          id: `${account.id}-blocked`,
          kind: 'rolling',
          periodSeconds,
          unit: 'requests',
          remaining: 0,
          allowance: requestsPerMinute * minutes,
          resetsAt: resetAt,
          timeZone: 'UTC',
        })
        if (tokensPerMinute !== undefined) {
          windows.push({
            id: `${account.id}-blocked-tokens`,
            kind: 'rolling',
            periodSeconds,
            unit: 'tokens',
            remaining: 0,
            allowance: tokensPerMinute * minutes,
            resetsAt: resetAt,
            timeZone: 'UTC',
          })
        }
      }
    }
  }
  return requestsPerMinute !== undefined ||
    tokensPerMinute !== undefined ||
    windows.length > 0 ||
    stated.length > 0
    ? {
        ...(requestsPerMinute !== undefined && { requestsPerMinute }),
        ...(tokensPerMinute !== undefined && { tokensPerMinute }),
        ...(windows.length > 0 && { usageLimits: windows }),
        statedLimits: stated,
      }
    : undefined
}

/**
 * Which fleet row the local slot spends. The active account wins; otherwise
 * the first by order (zero accounts yield undefined). Several accounts never
 * refuse: one serial fleet cannot choose, so the caller names the choice
 * instead of the binding guessing it.
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
  /** M107's machine reading; undefined keeps the certified row. */
  readonly settings: () => MaybeAsync<FleetMachineReading | undefined>
  /** M108's account source; never silent about a missing reader. */
  readonly activeAccount: () => MaybeAsync<FleetAccountSource | undefined>
  /** CI concurrency rows; empty means no row was read. */
  readonly ci: () => MaybeAsync<readonly FleetCi[]>
}

/** One fleet call's readers from the milestone sources. */
export function fleetIoFromSources(sources: FleetSources): FleetBindingIo {
  return {
    settings: () => sources.settings(),
    activeAccount: () => sources.activeAccount(),
    ci: () => sources.ci(),
  }
}

function machineReading(settings: ResourceSettings): FleetMachineReading {
  return {
    cpuMaxPercent: settings.cpuMaxPercent,
    memoryMaxPercent: settings.memoryMaxPercent,
    enabled: settings.enabled,
  }
}

/**
 * The extension host's sources: M107's settings read live from the workspace
 * configuration through readResourceSettings (thresholds as facts, slots
 * untouched); the extension host constructs no account-limits reader (the
 * panel's accounts view reads the AccountStore registry and static
 * capability names, and live usage sits on the backend's account home), so
 * the account source is the typed no-reader seam, never a silent stub; no
 * captured shape names CI concurrency, so CI stays not read. `inspect` is
 * the configuration's own inspect function, so the test proves the exact
 * keys.
 */
export function extensionFleetSources(deps: {
  readonly inspect: ResourceSettingsReader
}): FleetSources {
  return {
    settings: () => {
      try {
        return machineReading(readResourceSettings(deps.inspect))
      } catch {
        refuse('fleet-caps-invalid')
      }
    },
    activeAccount: () => ({ kind: 'no-reader', surface: 'editor' }) as const,
    ci: () => [],
  }
}

/**
 * The headless runtime's sources: M107's settings through the same
 * resources.json reader the headless governor uses (a missing file carries
 * the schema defaults the governor itself runs); M108's account identity
 * through the runtime's account registry, whose limits no headless reader
 * holds, so a listed account is named with unknown limits and anything else
 * is the typed no-reader seam; networked `gh` reads stay off headless (M80,
 * D65), so CI stays not read with the schedule's true refusal for lanes that
 * declare it.
 */
export function headlessFleetSources(deps: {
  readonly readSettings: () => Promise<ResourceSettings>
  readonly listAccounts: () => Promise<readonly { readonly id: string }[]>
}): FleetSources {
  return {
    settings: async () => {
      try {
        return machineReading(await deps.readSettings())
      } catch {
        refuse('fleet-caps-invalid')
      }
    },
    activeAccount: async () => {
      let rows: readonly { readonly id: string }[]
      try {
        rows = await deps.listAccounts()
      } catch {
        return { kind: 'no-reader', surface: 'runtime' } as const
      }
      const id = selectFleetAccount(rows, null)
      return id === undefined
        ? ({ kind: 'no-reader', surface: 'runtime' } as const)
        : ({ kind: 'registry', providerId: 'meta', accountId: id } as const)
    },
    ci: () => [],
  }
}
