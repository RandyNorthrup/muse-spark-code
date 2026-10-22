import * as z from 'zod/mini'
import { estimateAccountOwnerSchema } from '../../shared/estimateFacts'
import { accountIdSchema } from '../../shared/accountId'
import { usageLimitSnapshotSchema } from '../../shared/usageJournal'
import { createHash } from 'node:crypto'
import {
  encodeLimitContext,
  estimateLimitContextSchema,
  type EstimateLimitContext,
} from '../../core/estimator/limitContext'
// M117 R5: normalized limits stay owned facts in the invocation's core context.
// The existing fleet contract carries scheduling projections only; current
// allowance never invents a renewal period. Machine parallelism stays the
// certified serial row, and missing CI remains demand-scoped uncertainty.
import { ESTIMATE_FACT_TRANSLATORS } from '../../core/estimator/limitFacts'
import type { EstimateLimitFact, EstimateAccountOwner } from '../../shared/estimateFacts'
import type { OwnedUsageLimitSnapshot } from '../../core/usage/recording'
import {
  readResourceSettings,
  type ResourceSettings,
  type ResourceSettingsReader,
} from '../../shared/resources'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../shared/estimate'
import type { Account } from '../../shared/accounts'
import { type AccountLimitsSnapshot } from '../../core/accounts/thresholds'
import { subscriptionUsageSchema, type SubscriptionUsage } from '../../shared/usage'
import { EstimateDiagnosticError } from '../../core/estimator/diagnostic'

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
What the M108 account owner said, or why it said nothing. `limits` carries
the owner's raw snapshot for the binding to translate; `registry` names an
account the registry lists but whose limits no reader holds; `no-reader`
is the typed seam for a surface with no account reader at all.
*/
export type FleetAccountSource =
  | {
      readonly kind: 'limits'
      readonly providerId: string
      readonly accountId: string
      readonly label?: string
      readonly generation: string
      readonly snapshot: AccountLimitsSnapshot
      readonly nowMs?: number | undefined
    }
  | {
      readonly kind: 'registry'
      readonly providerId: string
      readonly accountId: string
      readonly label?: string
    }
  | {
      readonly kind: 'facts'
      readonly owner: EstimateAccountOwner
      readonly label?: string
      readonly facts: readonly EstimateLimitFact[]
    }
  | { readonly kind: 'no-reader'; readonly surface: 'editor' | 'runtime' }

/**
The milestone readers behind the fleet. Each is injected: the estimator
ports run in the activation bundle and the headless runtime, where the
governor's live handles, the account store and the workspace root are not
all reachable. Production assemblies define every reader; an absent reader
keeps this machine's measured fleet exactly as certified.
*/
export interface FleetBindingIo {
  /**
  M107's machine reading; absent, or resolving undefined, keeps the
  certified row. A reading with `enabled` false keeps it too: a governor
  that is off states no threshold.
  */
  readonly settings?: (() => MaybeAsync<FleetMachineReading | undefined>) | undefined
  /**
  M108's account source; absent keeps the measured row. A source that
  names no read limit keeps the row's identity but drops its
  demand-budgeted rate, so the schedule records the checks as unknown.
  */
  readonly activeAccount?: (() => MaybeAsync<FleetAccountSource | undefined>) | undefined
  /** CI concurrency rows; absent or empty means no row was read. */
  readonly ci?: (() => MaybeAsync<readonly FleetCi[]>) | undefined
}

function refuse(detail: string): never {
  throw new EstimateDiagnosticError(detail)
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
This machine's fleet with the milestone rows applied. The base stays the
measured local row; the binding writes only read values, never a computed
slot count. Each source re-parses on its own, so a corrupt machine
reading is `fleet-caps-invalid`, a corrupt account `fleet-account-invalid`
and a corrupt CI row `fleet-ci-invalid`; a structural failure past all
three is `fleet-binding-invalid`.
*/
export async function bindEstimatorFleet(
  base: FleetSnapshot,
  io: FleetBindingIo = {},
): Promise<{ fleet: FleetSnapshot; context: EstimateLimitContext }> {
  const context: EstimateLimitContext = { facts: [], labels: [] }
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
    const facts = reading.enabled
      ? translate(() =>
          ESTIMATE_FACT_TRANSLATORS.machine({
            id: local.id,
            observedAt: Date.parse(base.asOf),
            ...reading,
          }),
        )
      : []
    context.facts.push(...facts)
    const parsed = fleetSnapshotSchema.safeParse({
      ...base,
      machines,
    })
    if (!parsed.success) refuse('fleet-caps-invalid')
    candidate = parsed.data
  }
  if (io.activeAccount !== undefined) {
    const source = await io.activeAccount()
    if (source !== undefined) {
      candidate = applyAccountSource(candidate, local, source, context)
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
  if (context.facts.length > 0 || context.labels.length > 0) {
    candidate = {
      ...candidate,
      accounts: candidate.accounts.map((account, index) =>
        index === 0
          ? {
              ...account,
              statedLimits: [...(account.statedLimits ?? []), encodeLimitContext(context)],
            }
          : account,
      ),
    }
    if (!fleetSnapshotSchema.safeParse(candidate).success) refuse('fleet-binding-invalid')
  }
  return { fleet: candidate, context }
}

/** Projection for callers needing only the existing fleet contract. */
export async function applyFleetBinding(
  base: FleetSnapshot,
  io: FleetBindingIo = {},
): Promise<FleetSnapshot> {
  const bound = await bindEstimatorFleet(base, io)
  return bound.fleet
}

/** The account row for a source that named no read limit: identity without
rates, so every check records unknown and names where it looked. */
function unknownAccountRow(id: string, providerId: string, stated: string): FleetAccount {
  return { id, providerId, statedLimits: [stated] }
}
function translate<T>(read: () => T): T {
  try {
    return read()
  } catch (error: unknown) {
    // A fact-source refusal names its source; the fleet refusal keeps it.
    if (
      error instanceof EstimateDiagnosticError &&
      error.estimateDiagnostic.startsWith('fact-source-invalid: ')
    )
      throw new EstimateDiagnosticError(
        `fleet-account-invalid: ${error.estimateDiagnostic.slice('fact-source-invalid: '.length)}`,
      )
    throw error
  }
}
function applyAccountSource(
  base: FleetSnapshot,
  local: FleetMachine,
  source: FleetAccountSource,
  context: EstimateLimitContext,
): FleetSnapshot {
  const spend = (accountId: string): FleetSnapshot['slots'] =>
    base.slots.map((slot) => (slot.machineId === local.id ? { ...slot, accountId } : slot))
  if (source.kind === 'no-reader')
    return {
      ...base,
      accounts: [
        unknownAccountRow('local', 'local', `estimate-no-account-reader:${source.surface}`),
      ],
      slots: spend('local'),
    }
  const accountId = source.kind === 'facts' ? source.owner.id : source.accountId
  const providerId = source.kind === 'facts' ? source.owner.providerId : source.providerId
  const label = source.label ?? providerId
  let facts: EstimateLimitFact[] = []
  if (source.kind === 'limits')
    facts = translate(() =>
      ESTIMATE_FACT_TRANSLATORS.limits({
        owner: {
          kind: 'account',
          id: accountId,
          providerId,
          generation: source.generation,
        },
        observedAt: source.nowMs ?? Date.parse(base.asOf),
        snapshot: source.snapshot,
      }),
    )
  else if (source.kind === 'facts') {
    const parsed = estimateLimitContextSchema.safeParse({ facts: source.facts, labels: [] })
    if (!parsed.success) refuse('fleet-account-invalid: facts')
    facts = parsed.data.facts
  }
  context.facts.push(...facts)
  context.labels.push({ accountId, providerId, label })
  const row = fleetAccountFromFacts(facts, accountId, label, Date.parse(base.asOf))
  return {
    ...base,

    accounts: [
      {
        id: accountId,
        providerId,
        ...row,
        statedLimits: [...row.statedLimits],
        ...(facts.length === 0 && { statedLimits: ['estimate-limits-unread'] }),
      },
    ],
    slots: spend(accountId),
  }
}
export interface FleetAccountLimits {
  readonly providerId: string
  readonly account: Pick<Account, 'id'> & Partial<Pick<Account, 'label'>>
  readonly limits: AccountLimitsSnapshot
  readonly nowMs: number
  readonly generation: string
}
export interface FleetTranslatedAccount {
  readonly availableAt?: string | undefined
  readonly usageLimits?: FleetAccount['usageLimits'] | undefined
  readonly statedLimits: readonly string[]
  readonly requestsPerMinute?: number
  readonly tokensPerMinute?: number
}
function fleetAccountFromFacts(
  facts: readonly EstimateLimitFact[],
  accountId: string,
  label: string,
  nowMs: number,
): FleetTranslatedAccount {
  const windows: NonNullable<FleetAccount['usageLimits']> = []
  const resets: string[] = []
  for (const fact of facts) {
    const reset = fact.window.resetsAt
    if (reset !== null && fact.window.periodSeconds === null && Date.parse(reset) <= nowMs) continue
    if (
      (fact.unit === 'percent' && fact.remaining === 0) ||
      (fact.metric === 'blocked' && fact.unit === null)
    ) {
      if (reset === null) refuse(`fleet-account-blocked: ${label} reset unknown`)
      if (Date.parse(reset) > nowMs) resets.push(reset)
    }
    if (reset === null || fact.unit === null || fact.remaining === null) continue
    // Money never becomes a numeric window: usd facts carry exact decimal
    // strings and no reset, and admit on the schedule's fact-direct path.
    if (typeof fact.remaining !== 'number') continue
    const allowance = typeof fact.limit === 'number' ? fact.limit : fact.remaining
    windows.push({
      id: `${accountId}-${
        fact.observedBy === 'account-limits'
          ? fact.metric
          : createHash('sha256')
              .update(JSON.stringify({ metric: fact.metric, source: fact.observedBy }))
              .digest('hex')
      }`,
      unit: fact.unit,
      remaining: fact.remaining,
      allowance,
      resetsAt: reset,
      timeZone: 'UTC',
      ...(fact.window.periodSeconds === null
        ? { kind: 'current' as const }
        : { kind: 'rolling' as const, periodSeconds: fact.window.periodSeconds }),
    })
  }
  const availableAt = resets.toSorted((a, b) => Date.parse(b) - Date.parse(a))[0]
  return {
    ...(availableAt !== undefined && { availableAt }),
    ...(windows.length > 0 && { usageLimits: windows }),
    statedLimits: [],
  }
}
export function fleetAccountFromLimits(
  input: FleetAccountLimits,
): FleetTranslatedAccount | undefined {
  if (!Number.isFinite(new Date(input.nowMs).getTime()))
    refuse('fleet-account-invalid: account-limits')
  const facts = translate(() =>
    ESTIMATE_FACT_TRANSLATORS.limits({
      owner: {
        kind: 'account',
        id: input.account.id,
        providerId: input.providerId,
        generation: input.generation,
      },
      observedAt: input.nowMs,
      snapshot: input.limits,
    }),
  )
  const row = fleetAccountFromFacts(
    facts,
    input.account.id,
    input.account.label ?? input.providerId,
    input.nowMs,
  )
  return facts.length === 0 ? undefined : row
}

/**
Which fleet row the local slot spends. The active account wins; otherwise
the first by order (zero accounts yield undefined). Several accounts never
refuse: one serial fleet cannot choose, so the caller names the choice
instead of the binding guessing it.
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
  // An unset ceiling is no limit, which the certified row already states as
  // 100: the origin still says whether that 100 was read or is the default.
  return {
    cpuMaxPercent: settings.cpuMaxPercent ?? 100,
    memoryMaxPercent: settings.memoryMaxPercent ?? 100,
    enabled: settings.enabled,
    ...(origin !== undefined && { origin }),
  }
}

/** Existing usage owners: the backend's usage/read and the UI's recording feed. */
export interface OwnedSubscriptionUsage {
  readonly owner: EstimateAccountOwner
  readonly snapshot: SubscriptionUsage
}
export interface FleetUsageOwners {
  readonly readOwnedLimits?: (() => MaybeAsync<readonly OwnedUsageLimitSnapshot[]>) | undefined
  readonly currentOwner?:
    | (() => {
        readonly accountId: string
        readonly generation: string
        readonly providerId?: string
        readonly label?: string
      })
    | undefined
  readonly readUsage?: (() => Promise<OwnedSubscriptionUsage | undefined>) | undefined
}
const currentOwnerSchema = z.strictObject({
  accountId: accountIdSchema,
  generation: z.string().check(z.minLength(1)),
  providerId: z.optional(accountIdSchema),
  label: z.optional(z.string().check(z.minLength(1))),
})
const ownedObservationSchema = z.strictObject({
  owner: estimateAccountOwnerSchema,
  snapshot: usageLimitSnapshotSchema,
  sequence: z.int().check(z.gte(0)),
})
function currentOwner(deps: FleetUsageOwners) {
  let value: ReturnType<NonNullable<FleetUsageOwners['currentOwner']>> | undefined
  try {
    value = deps.currentOwner?.()
  } catch (error: unknown) {
    throw new EstimateDiagnosticError('fleet-account-invalid: owner unavailable', undefined, {
      cause: error,
    })
  }
  if (value === undefined) return
  const parsed = currentOwnerSchema.safeParse(value)
  if (!parsed.success) refuse('fleet-account-invalid: owner')
  return parsed.data
}
async function liveAccountSource(deps: FleetUsageOwners): Promise<FleetAccountSource | undefined> {
  const before = currentOwner(deps)
  if (before === undefined) return undefined
  let usage: OwnedSubscriptionUsage | undefined
  let observations: readonly OwnedUsageLimitSnapshot[]
  try {
    const rawUsage = await deps.readUsage?.()
    if (rawUsage !== undefined) {
      const parsedUsage = z
        .strictObject({ owner: estimateAccountOwnerSchema, snapshot: subscriptionUsageSchema })
        .safeParse(rawUsage)
      if (!parsedUsage.success) refuse('fleet-account-invalid: usage-read')
      usage = parsedUsage.data
    }
    const parsed = z.array(ownedObservationSchema).safeParse((await deps.readOwnedLimits?.()) ?? [])
    if (!parsed.success) refuse('fleet-account-invalid: usage-changed')
    observations = parsed.data
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'estimateDiagnostic' in error) throw error
    throw new EstimateDiagnosticError('fleet-account-invalid: usage-read unavailable', undefined, {
      cause: error,
    })
  }
  const after = currentOwner(deps) ?? before
  if (
    before.accountId !== after.accountId ||
    before.generation !== after.generation ||
    before.providerId !== after.providerId
  )
    return undefined
  if (usage !== undefined) {
    const captured = usage
    if (
      captured.owner.id === before.accountId &&
      captured.owner.generation === before.generation &&
      captured.owner.providerId === (before.providerId ?? 'meta')
    )
      return {
        kind: 'facts',
        owner: captured.owner,
        ...(before.label !== undefined && { label: before.label }),
        facts: translate(() =>
          ESTIMATE_FACT_TRANSLATORS.usage({
            owner: captured.owner,
            observedAt: captured.snapshot.observedAtMs,
            snapshot: captured.snapshot,
          }),
        ),
      }
  }
  const current = observations
    .filter(
      (row) =>
        row.owner.id === before.accountId &&
        row.owner.generation === before.generation &&
        row.owner.providerId === (before.providerId ?? 'meta'),
    )
    .toSorted((a, b) => b.snapshot.observedAt - a.snapshot.observedAt || b.sequence - a.sequence)
  const selected = current[0]
  if (selected === undefined) return undefined
  const facts = current
    .filter((row) => row.owner.providerId === selected.owner.providerId)
    .flatMap((row) =>
      translate(() =>
        ESTIMATE_FACT_TRANSLATORS.observation({
          owner: row.owner,
          observedAt: row.snapshot.observedAt,
          snapshot: row.snapshot,
        }),
      ),
    )
  return {
    kind: 'facts',
    owner: selected.owner,
    ...(before.label !== undefined && { label: before.label }),
    facts,
  }
}

/** Match the RPC's complete numeric observation to a frame captured by this owner.
An old host's cached usage/read never acquires the new sign-in's identity. */
export function ownedSubscriptionUsage(
  snapshot: SubscriptionUsage,
  observations: readonly OwnedUsageLimitSnapshot[],
  scope: { accountId: string; generation: string },
): OwnedSubscriptionUsage | undefined {
  translate(() =>
    ESTIMATE_FACT_TRANSLATORS.usage({
      owner: {
        kind: 'account',
        id: scope.accountId,
        providerId: 'meta',
        generation: scope.generation,
      },
      observedAt: snapshot.observedAtMs,
      snapshot,
    }),
  )
  const row = observations.find((entry) => {
    if (
      entry.owner.id !== scope.accountId ||
      entry.owner.generation !== scope.generation ||
      entry.snapshot.source !== 'museCode' ||
      entry.snapshot.observedAt !== snapshot.observedAtMs
    )
      return false
    const window = entry.snapshot.windows.find((value) => value.id === 'window')
    const weekly = entry.snapshot.windows.find((value) => value.id === 'weekly')
    return (
      window?.usedPercent === snapshot.window.usedPercent &&
      window.resetsAt === snapshot.window.resetsAtMs &&
      window.windowMins === snapshot.window.windowDurationMins &&
      weekly?.usedPercent === snapshot.weekly.usedPercent &&
      weekly.resetsAt === snapshot.weekly.resetsAtMs
    )
  })
  return row === undefined ? undefined : { owner: row.owner, snapshot }
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
      } catch (error: unknown) {
        throw new EstimateDiagnosticError('fleet-caps-invalid', undefined, { cause: error })
      }
    },
    activeAccount: async () => {
      const live = await liveAccountSource(deps)
      const owner = deps.currentOwner?.()
      return (
        live ??
        (owner === undefined
          ? { kind: 'no-reader', surface: 'editor' }
          : {
              kind: 'registry',
              providerId: owner.providerId ?? 'meta',
              accountId: owner.accountId,
              ...(owner.label !== undefined && { label: owner.label }),
            })
      )
    },
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
    readonly listAccounts: () => Promise<
      readonly { readonly id: string; readonly label?: string }[]
    >
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
      } catch (error: unknown) {
        throw new EstimateDiagnosticError('fleet-caps-invalid', undefined, { cause: error })
      }
    },
    activeAccount: async () => {
      // Corrupt metadata is a refusal even when the live reader has observations.
      let rows: readonly { readonly id: string; readonly label?: string }[]
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
        throw new EstimateDiagnosticError(`fleet-account-invalid: registry ${reason}`, undefined, {
          cause: error,
        })
      }
      const owner = currentOwner(deps)
      const live = await liveAccountSource(deps)
      if (live !== undefined) {
        // Live facts keep the selected owner's identity; when the owner
        // supplies no display label the registry's label still applies.
        if (live.kind === 'facts' && live.label === undefined) {
          const label = rows.find((row) => row.id === live.owner.id)?.label
          if (label !== undefined) return { ...live, label }
        }
        return live
      }
      const id = selectFleetAccount(rows, owner?.accountId ?? null)
      const label = rows.find((row) => row.id === id)?.label
      return id === undefined
        ? { kind: 'no-reader', surface: 'runtime' }
        : {
            kind: 'registry',
            providerId: owner?.providerId ?? 'meta',
            accountId: id,
            ...(label !== undefined && { label }),
          }
    },
    ci: () => [],
  }
}
