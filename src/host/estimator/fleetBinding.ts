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
// - M108's account row carries only what the account owner said. A rate
//   bucket keeps its current allowance; future refill and rates stay unknown; a read plan window with a captured duration
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
import { fill, formatDateTime, formatPercent, UI_TEXT } from '../../shared/l10n/text'
import { ACCOUNT_DEFAULT_ID, SECONDS_PER_MINUTE } from '../../shared/constants'
import {
  readResourceSettings,
  type ResourceSettings,
  type ResourceSettingsReader,
} from '../../shared/resources'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../shared/estimate'
import type { Account } from '../../shared/accounts'
import {
  accountLimitsSnapshotSchema,
  type AccountLimitsSnapshot,
} from '../../core/accounts/thresholds'
import { usageLimitSnapshotSchema, type UsageLimitSnapshot } from '../../shared/usageJournal'
import { subscriptionUsageSchema, type SubscriptionUsage } from '../../shared/usage'
import { fleetFailure } from '../../runtime/estimator/command'

type FleetMachine = FleetSnapshot['machines'][number]
type FleetAccount = FleetSnapshot['accounts'][number]
type FleetCi = FleetSnapshot['ci'][number]
type MaybeAsync<T> = T | Promise<T>

/** M107's machine reading: throttle thresholds plus the on/off switch. */
export interface FleetMachineReading {
  readonly cpuMaxPercent: number
  readonly memoryMaxPercent: number
  readonly enabled: boolean
  readonly origin?: FleetMachine['caps']['origin'] | undefined
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
      readonly nowMs?: number | undefined
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
  throw fleetFailure(detail)
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
                ...(reading.origin !== undefined && { origin: reading.origin }),
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
      fill(UI_TEXT.estimateNoAccountReader, { source: source.surface }),
    )
    return { ...base, accounts: [row], slots: spend('local') }
  }
  if (source.kind === 'registry') {
    const row = unknownAccountRow(
      source.accountId,
      source.providerId,
      fill(UI_TEXT.estimateLimitsUnread, { source: `${source.providerId}/${source.accountId}` }),
    )
    return { ...base, accounts: [row], slots: spend(source.accountId) }
  }
  const translated = fleetAccountFromLimits({
    providerId: source.providerId,
    account: { id: source.accountId },
    limits: source.snapshot,
    nowMs: source.nowMs ?? Date.parse(base.asOf),
  })
  if (translated === undefined) {
    const row = unknownAccountRow(
      source.accountId,
      source.providerId,
      fill(UI_TEXT.estimateLimitsUnread, { source: `${source.providerId}/${source.accountId}` }),
    )
    return { ...base, accounts: [row], slots: spend(source.accountId) }
  }
  return {
    ...base,
    accounts: [
      {
        id: source.accountId,
        providerId: source.providerId,
        ...(translated.availableAt !== undefined && { availableAt: translated.availableAt }),
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

export interface FleetAccountLimits {
  readonly providerId: string
  readonly account: Pick<Account, 'id'>
  readonly limits: AccountLimitsSnapshot
  readonly nowMs: number
}

/** The translated row: read rates, convertible windows, and stated limits. */
export interface FleetTranslatedAccount {
  readonly availableAt?: string | undefined
  readonly requestsPerMinute?: number | undefined
  readonly tokensPerMinute?: number | undefined
  readonly usageLimits?: FleetAccount['usageLimits'] | undefined
  readonly statedLimits: readonly string[]
}

/** Preserve owner allowance/reset separately from unknown future refill and rates. */
export function fleetAccountFromLimits(
  input: FleetAccountLimits,
): FleetTranslatedAccount | undefined {
  const { providerId, account, nowMs } = input
  const parsed = accountLimitsSnapshotSchema.safeParse(input.limits)
  if (!parsed.success || !Number.isFinite(nowMs)) refuse('fleet-account-invalid limits')
  const limits = parsed.data
  const windows: NonNullable<FleetAccount['usageLimits']> = []
  const stated: string[] = []
  const resets: string[] = []
  const block = (reset: string | null): void => {
    if (reset === null) refuse(`fleet-account-blocked ${providerId}/${account.id} reset unknown`)
    if (Date.parse(reset) > nowMs) resets.push(reset)
  }
  for (const unit of ['requests', 'tokens'] as const) {
    const entry = limits.rateLimits?.[unit]
    if (entry === undefined) continue
    if (entry.remaining > entry.limit) refuse('fleet-account-invalid limits')
    if (Date.parse(entry.resetAt) <= nowMs) continue
    windows.push({
      id: `${account.id}-${unit}`,
      kind: 'current',
      unit,
      remaining: entry.remaining,
      allowance: entry.limit,
      resetsAt: entry.resetAt,
      timeZone: 'UTC',
    })
    stated.push(
      fill(UI_TEXT.estimateRefillUnknown, { source: `${providerId}/${account.id}/${unit}` }),
    )
  }
  const planWindows = Object.entries(limits.planWindows ?? {})
  for (const [name, window] of planWindows) {
    if (
      window.resetAt !== null &&
      Date.parse(window.resetAt) <= nowMs &&
      window.windowDurationMins === undefined
    )
      continue
    if (window.usedPercent >= 100) block(window.resetAt)
    if (window.resetAt !== null && window.windowDurationMins !== undefined) {
      windows.push({
        id: `${account.id}-${name}`,
        kind: 'rolling',
        periodSeconds: window.windowDurationMins * SECONDS_PER_MINUTE,
        unit: 'percent',
        remaining: 100 - window.usedPercent,
        allowance: 100,
        resetsAt: window.resetAt,
        timeZone: 'UTC',
      })
    } else {
      stated.push(
        fill(UI_TEXT.estimatePlanWindowUnknown, {
          source: `${providerId}/${account.id}/${name}`,
          percent: formatPercent(window.usedPercent),
          reset:
            window.resetAt === null
              ? UI_TEXT.estimateResetUnknown
              : formatDateTime(Date.parse(window.resetAt)),
        }),
      )
    }
  }
  if (limits.blocked !== undefined) block(limits.blocked.resetAt)
  const availableAt = resets.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0]
  return availableAt !== undefined || windows.length > 0 || stated.length > 0
    ? {
        ...(availableAt !== undefined && { availableAt }),
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

function machineReading(
  settings: ResourceSettings,
  origin?: FleetMachineReading['origin'],
): FleetMachineReading {
  return {
    cpuMaxPercent: settings.cpuMaxPercent,
    memoryMaxPercent: settings.memoryMaxPercent,
    enabled: settings.enabled,
    ...(origin !== undefined && { origin }),
  }
}

/** Existing usage owners: the backend's usage/read and the UI's recording feed. */
export interface FleetUsageOwners {
  readonly readLiveLimits?: (() => MaybeAsync<readonly UsageLimitSnapshot[]>) | undefined
  readonly readUsage?: (() => Promise<SubscriptionUsage | undefined>) | undefined
}

async function liveAccountSource(deps: FleetUsageOwners): Promise<FleetAccountSource | undefined> {
  let usage: SubscriptionUsage | undefined
  try {
    usage = await deps.readUsage?.()
  } catch {
    refuse('fleet-account-invalid usage-read unavailable')
  }
  let windows: UsageLimitSnapshot['windows'] | undefined
  if (usage !== undefined) {
    const parsed = subscriptionUsageSchema.safeParse(usage)
    if (!parsed.success) refuse('fleet-account-invalid usage-read')
    windows = [
      {
        id: 'window',
        usedPercent: parsed.data.window.usedPercent,
        resetsAt: parsed.data.window.resetsAtMs,
        windowMins: parsed.data.window.windowDurationMins,
      },
      {
        id: 'weekly',
        usedPercent: parsed.data.weekly.usedPercent,
        resetsAt: parsed.data.weekly.resetsAtMs,
      },
    ]
  }
  let observations: readonly UsageLimitSnapshot[]
  try {
    observations = (await deps.readLiveLimits?.()) ?? []
  } catch {
    refuse('fleet-account-invalid usage-changed unavailable')
  }
  for (const raw of observations) {
    const parsed = usageLimitSnapshotSchema.safeParse(raw)
    if (!parsed.success) refuse('fleet-account-invalid usage-changed')
    if (windows === undefined && parsed.data.source === 'museCode') windows = parsed.data.windows
  }
  if (windows === undefined) return undefined
  const snapshot: AccountLimitsSnapshot = {
    planWindows: Object.fromEntries(
      windows.map((window) => [
        window.id,
        {
          usedPercent: Math.min(100, window.usedPercent),
          resetAt: window.resetsAt === undefined ? null : new Date(window.resetsAt).toISOString(),
          ...(window.windowMins !== undefined && { windowDurationMins: window.windowMins }),
        },
      ]),
    ),
  }
  return { kind: 'limits', providerId: 'meta', accountId: ACCOUNT_DEFAULT_ID, snapshot }
}

/** Live workspace configuration and the same live usage readers as Account & usage. */
export function extensionFleetSources(
  deps: {
    readonly inspect: ResourceSettingsReader
  } & FleetUsageOwners,
): FleetSources {
  return {
    settings: () => {
      try {
        const captured = new Map<string, ReturnType<ResourceSettingsReader>>()
        const settings = readResourceSettings((key) => {
          const value = deps.inspect(key)
          captured.set(key, value)
          return value
        })
        return machineReading(settings, {
          source: 'configuration',
          cpuPercent:
            captured.get('resourceCpuMaxPercent')?.globalValue === undefined
              ? 'default'
              : 'configured',
          memoryPercent:
            captured.get('resourceMemoryMaxPercent')?.globalValue === undefined
              ? 'default'
              : 'configured',
        })
      } catch {
        refuse('fleet-caps-invalid')
      }
    },
    activeAccount: async () =>
      (await liveAccountSource(deps)) ?? { kind: 'no-reader', surface: 'editor' },
    ci: () => [],
  }
}

/** Standalone CLI has a registry; ACP also supplies the running usage owners. */
export function headlessFleetSources(
  deps: {
    readonly readSettings: () => Promise<ResourceSettings>
    readonly readSettingsWithOrigin?:
      | (() => Promise<{
          settings: ResourceSettings
          origin: NonNullable<FleetMachineReading['origin']>
        }>)
      | undefined
    readonly listAccounts: () => Promise<readonly { readonly id: string }[]>
  } & FleetUsageOwners,
): FleetSources {
  return {
    settings: async () => {
      try {
        if (deps.readSettingsWithOrigin !== undefined) {
          const reading = await deps.readSettingsWithOrigin()
          return machineReading(reading.settings, reading.origin)
        }
        return machineReading(await deps.readSettings())
      } catch {
        refuse('fleet-caps-invalid')
      }
    },
    activeAccount: async () => {
      // Corrupt metadata is a refusal even when the live reader has observations.
      let rows: readonly { readonly id: string }[]
      try {
        rows = await deps.listAccounts()
      } catch (error: unknown) {
        const reason =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'unavailable'
            ? 'unavailable'
            : 'invalidAccount'
        refuse(`fleet-account-invalid registry ${reason}`)
      }
      const live = await liveAccountSource(deps)
      if (live !== undefined) return live
      const id = selectFleetAccount(rows, null)
      return id === undefined
        ? { kind: 'no-reader', surface: 'runtime' }
        : { kind: 'registry', providerId: 'meta', accountId: id }
    },
    ci: () => [],
  }
}
