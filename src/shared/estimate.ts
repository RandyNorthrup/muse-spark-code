// M117 / D97's application contracts. These are our documents and injected
// ports, never guessed provider/MSP frames. External adapters parse captured
// wire shapes before projecting them here. Import only on estimator use.
import * as z from 'zod/mini'
import {
  ESTIMATE_CALIBRATION_MIN_SAMPLES,
  ESTIMATE_ENGINES,
  ESTIMATE_ID_MAX_CHARS,
  ESTIMATE_LABEL_MAX_CHARS,
  ESTIMATE_MAX_ITEMS,
} from './constants'

const id = z
  .string()
  .check(z.minLength(1), z.maxLength(ESTIMATE_ID_MAX_CHARS), z.regex(/^[\w.-]+(?::[\w.-]+)?$/))
const hours = z.number().check(z.nonnegative())
const count = z.int().check(z.nonnegative())
const positiveCount = z.int().check(z.positive())
const instant = z.iso.datetime()
const milestoneId = z.string().check(z.regex(/^M[1-9]\d*[a-z\d]*$/))
const boundedIds = z.array(id).check(z.maxLength(ESTIMATE_MAX_ITEMS))
const goalName = z
  .string()
  .check(z.minLength(1), z.maxLength(ESTIMATE_ID_MAX_CHARS), z.regex(/^[\w.-]+$/))
const os = z.enum(['windows', 'macos', 'linux'])
const architecture = z.enum(['x64', 'arm64'])
const areUnique = (values: readonly string[]): boolean => new Set(values).size === values.length

export const estimateGoalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('milestone'), milestoneId }),
  z.strictObject({ kind: z.literal('pullRequest'), number: positiveCount }),
  z.strictObject({
    kind: z.literal('issues'),
    numbers: z.array(positiveCount).check(
      z.minLength(1),
      z.maxLength(ESTIMATE_MAX_ITEMS),
      z.refine((numbers) => new Set(numbers).size === numbers.length),
    ),
  }),
  z.strictObject({
    kind: z.literal('label'),
    label: z.string().check(z.minLength(1), z.maxLength(ESTIMATE_LABEL_MAX_CHARS)),
  }),
  z.strictObject({ kind: z.literal('release'), release: goalName }),
  z.strictObject({
    kind: z.literal('lanes'),
    milestoneId,
    laneIds: z
      .array(goalName)
      .check(z.minLength(1), z.maxLength(ESTIMATE_MAX_ITEMS), z.refine(areUnique)),
  }),
])
export type EstimateGoal = z.infer<typeof estimateGoalSchema>

/** Grammar: M112; pr:12; issues:1,2; label:bug; release:0.16.0; M112:Q,U.
 * Milestone ids follow D93.5 (case insensitive, optional M); labels may
 * contain spaces. Command flags belong to lane U, outside this goal parser.
 */
export function parseEstimateGoal(text: string): EstimateGoal | undefined {
  const value = text.trim()
  const milestone = /^(?:m)?([1-9]\d*[a-z\d]*)(?::([\w.-]+(?:,[\w.-]+)*))?$/i.exec(value)
  let candidate: unknown
  if (milestone) {
    const canonicalId = `M${milestone[1]?.toLowerCase() ?? ''}`
    candidate = milestone[2]
      ? { kind: 'lanes', milestoneId: canonicalId, laneIds: milestone[2].split(',') }
      : { kind: 'milestone', milestoneId: canonicalId }
  } else {
    const colon = value.indexOf(':')
    if (colon < 1) return undefined
    const kind = value.slice(0, colon)
    const detail = value.slice(colon + 1)
    switch (kind) {
      case 'pr': {
        candidate = /^\d+$/.test(detail)
          ? { kind: 'pullRequest', number: Number(detail) }
          : undefined
        break
      }
      case 'issues': {
        candidate = /^\d+(?:,\d+)*$/.test(detail)
          ? { kind: 'issues', numbers: detail.split(',').map(Number) }
          : undefined
        break
      }
      case 'label': {
        candidate = { kind: 'label', label: detail }
        break
      }
      case 'release': {
        candidate = { kind: 'release', release: detail }
        break
      }
    }
  }
  const parsed = estimateGoalSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

// Quantitative application inputs retain unavailable measurements explicitly.
const numericUncertainty = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z
    .strictObject({ kind: z.literal('interval'), lower: z.number(), upper: z.number() })
    .check(z.refine((range) => range.lower <= range.upper)),
])
const hasSamplesForBasis = (evidence: { basis: string; samples: number }): boolean =>
  evidence.basis === 'history' || evidence.basis === 'calibration'
    ? evidence.samples > 0
    : evidence.samples === 0

function resourceQuantity(valueSchema: typeof hours) {
  return z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('unknown'),
      value: z.null(),
      basis: z.literal('unknown'),
      samples: z.literal(0),
      uncertainty: z.strictObject({ kind: z.literal('unknown') }),
    }),
    z
      .strictObject({
        status: z.literal('known'),
        value: valueSchema,
        basis: z.enum(['history', 'calibration', 'assumption']),
        samples: count,
        uncertainty: numericUncertainty,
      })
      .check(
        z.refine(
          (quantity) =>
            hasSamplesForBasis(quantity) &&
            (quantity.uncertainty.kind === 'unknown' ||
              (quantity.uncertainty.lower <= quantity.value &&
                quantity.value <= quantity.uncertainty.upper)),
        ),
      ),
  ])
}
const demand = resourceQuantity(hours)
const bytes = z.int().check(z.nonnegative())
const byteDemand = resourceQuantity(bytes)
// Opaque allocation roles (workspace, worktrees, temp, logs, data, state, ...).
// A machine maps each role to one physical volume; volumes are not capped at three.
const volumeRole = id
const diskFields = {
  volumeId: id,
  roles: z.array(volumeRole).check(z.minLength(1), z.refine(areUnique)),
}
const diskHeadroomSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown'), ...diskFields }),
  z
    .strictObject({
      status: z.literal('known'),
      ...diskFields,
      totalBytes: bytes,
      freeBytes: bytes,
      floorBytes: bytes,
      headroomBytes: bytes,
    })
    .check(
      z.refine(
        (disk) =>
          disk.freeBytes <= disk.totalBytes &&
          disk.floorBytes <= disk.totalBytes &&
          disk.headroomBytes === Math.max(0, disk.freeBytes - disk.floorBytes),
      ),
    ),
])

const windowFields = {
  id,
  unit: z.enum(['requests', 'tokens', 'usd', 'percent']),
  remaining: hours,
  allowance: hours,
  resetsAt: instant,
  timeZone: z.string().check(
    z.refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
      } catch {
        return false
      }
    }),
  ),
}
const usageWindowSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('rolling'), periodSeconds: positiveCount, ...windowFields }),
    // Repeat the reset's local time/day; clamp month-end to the last local day.
    z.strictObject({
      kind: z.literal('calendar'),
      period: z.enum(['day', 'week', 'month']),
      ...windowFields,
    }),
  ])
  .check(
    z.refine(
      (window) =>
        window.remaining <= window.allowance &&
        (window.unit !== 'percent' || window.allowance <= 100),
    ),
  )

// One complete review pass is one lane round, regardless of module count.
// Module/class strikes count rounds with unresolved findings, never findings.
const reviewSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown') }),
  z
    .strictObject({
      status: z.literal('known'),
      rounds: count,
      modules: z.array(
        z.strictObject({
          familyId: id,
          strikes: count,
          classes: z.array(
            z.strictObject({
              class: z.enum([
                'validationSecurity',
                'failureHonesty',
                'concurrencyLifecycle',
                'testsGates',
                'docs',
              ]),
              strikes: count,
            }),
          ),
        }),
      ),
      redesigns: z.array(
        z.strictObject({
          moduleFamilyId: id,
          afterRound: positiveCount,
          outcome: z.enum(['impossible', 'caught', 'remains']),
        }),
      ),
    })
    .check(
      z.refine(
        (review) =>
          areUnique(review.modules.map((module) => module.familyId)) &&
          review.modules.every(
            (module) =>
              module.strikes <= review.rounds &&
              areUnique(module.classes.map((entry) => entry.class)) &&
              module.classes.every((entry) => entry.strikes <= module.strikes),
          ) &&
          areUnique(
            review.redesigns.map((event) => `${event.moduleFamilyId}:${String(event.afterRound)}`),
          ) &&
          review.redesigns.every(
            (event) =>
              event.afterRound <= review.rounds &&
              review.modules.some((module) => module.familyId === event.moduleFamilyId),
          ),
      ),
    ),
])

export const machineClassSchema = z.strictObject({
  id,
  vcpu: positiveCount,
  ramGiB: z.number().check(z.positive()),
  os,
  architecture,
  gpu: z.optional(z.strictObject({ count: positiveCount, memoryGiB: hours })),
})
export const machineClassesSchema = z.array(machineClassSchema).check(
  z.minLength(1),
  z.maxLength(ESTIMATE_MAX_ITEMS),
  z.refine((classes) => areUnique(classes.map((entry) => entry.id))),
)
export type MachineClass = z.infer<typeof machineClassSchema>

const machineSchema = z.strictObject({
  id,
  classId: id,
  source: z.enum(['local', 'device', 'node', 'rented']),
  os,
  architecture,
  cores: positiveCount,
  ramGiB: z.number().check(z.positive()),
  gpu: z.optional(z.strictObject({ count: positiveCount, memoryGiB: hours })),
  disks: z.array(diskHeadroomSchema).check(
    z.minLength(1),
    z.refine(
      (disks) =>
        areUnique(disks.map((disk) => disk.volumeId)) &&
        areUnique(disks.flatMap((disk) => disk.roles)),
    ),
  ),
  governorSlots: count,
  capacityByKind: z.array(z.strictObject({ kind: id, slots: count })),
  caps: z.strictObject({
    slots: count,
    cpuPercent: z.number().check(z.nonnegative(), z.maximum(100)),
    memoryPercent: z.number().check(z.nonnegative(), z.maximum(100)),
  }),
})
const accountSchema = z.strictObject({
  // Opaque snapshot alias: never an e-mail address or provider credential.
  id,
  providerId: id,
  requestsPerMinute: hours,
  tokensPerMinute: z.optional(hours),
  // Multiple hard windows may apply at once (for example daily and weekly).
  usageLimits: z.optional(
    z.array(usageWindowSchema).check(
      z.maxLength(ESTIMATE_MAX_ITEMS),
      z.refine((limits) => areUnique(limits.map((limit) => limit.id))),
    ),
  ),
})

export const fleetSnapshotSchema = z
  .strictObject({
    asOf: instant,
    machines: z.array(machineSchema).check(z.maxLength(ESTIMATE_MAX_ITEMS)),
    roles: z.array(z.strictObject({ id, laneKinds: boundedIds })),
    accounts: z.array(accountSchema).check(z.maxLength(ESTIMATE_MAX_ITEMS)),
    slots: z.array(z.strictObject({ id, machineId: id, roleId: id, accountId: id })),
    ci: z.array(
      z
        .strictObject({
          id,
          concurrentJobs: count,
          occupiedJobs: count,
          // Absent when the provider does not report the period's remaining minutes.
          minutesRemaining: z.optional(hours),
          periodEndsAt: z.optional(instant),
        })
        .check(z.refine((ci) => ci.occupiedJobs <= ci.concurrentJobs)),
    ),
  })
  .check(
    z.refine((fleet) => {
      const collections = [fleet.machines, fleet.roles, fleet.accounts, fleet.slots, fleet.ci]
      return (
        collections.every((entries) => areUnique(entries.map((entry) => entry.id))) &&
        fleet.slots.every(
          (slot) =>
            fleet.machines.some((machine) => machine.id === slot.machineId) &&
            fleet.roles.some((role) => role.id === slot.roleId) &&
            fleet.accounts.some((account) => account.id === slot.accountId),
        ) &&
        fleet.machines.every(
          (machine) =>
            areUnique(machine.capacityByKind.map((capacity) => capacity.kind)) &&
            machine.capacityByKind.every((capacity) => capacity.slots <= machine.governorSlots) &&
            fleet.slots.filter((slot) => slot.machineId === machine.id).length <=
              Math.min(machine.governorSlots, machine.caps.slots),
        )
      )
    }),
  )
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>

export const estimateLaneSchema = z.strictObject({
  id,
  kind: id,
  estimatedHours: z.number().check(z.positive()),
  elapsedAgentHours: hours,
  minimumRemainingHours: hours,
  state: z.enum(['planned', 'running', 'merged']),
  dependencies: boundedIds.check(z.refine(areUnique)),
  // Workspace-relative, scrubbed file globs. Goal resolution owns affinity.
  files: z.array(z.string().check(z.minLength(1))),
  affinity: z.strictObject({
    os: z.array(os),
    architectures: z.array(architecture),
    machineClassIds: boundedIds,
    gpuRequired: z.boolean(),
  }),
  resources: z.strictObject({
    slots: resourceQuantity(positiveCount),
    accountRequestsPerHour: demand,
    accountTokensPerHour: demand,
    accountUsdPerHour: demand,
    accountPercentPerHour: demand,
    ciJobs: resourceQuantity(count),
    ciMinutes: demand,
    disk: z
      .array(
        z
          .strictObject({
            role: volumeRole,
            peakBytes: byteDemand,
            steadyBytes: byteDemand,
          })
          .check(
            z.refine(
              (disk) =>
                disk.peakBytes.value === null ||
                disk.steadyBytes.value === null ||
                disk.steadyBytes.value <= disk.peakBytes.value,
            ),
          ),
      )
      .check(
        z.minLength(1),
        z.refine((disks) => areUnique(disks.map((disk) => disk.role))),
      ),
    ciId: z.optional(id),
  }),
  review: reviewSchema,
  // M117 W (PLAN.md D100, gotcha G4): the base the lane was built on, when
  // known. A base older than ESTIMATE_STALE_BASE_DAYS is a schedule risk:
  // the estimate names it in `risks` instead of pricing a rebase it cannot see.
  baseAsOf: z.optional(instant),
})
export type EstimateLane = z.infer<typeof estimateLaneSchema>

export const historyRecordSchema = z
  .strictObject({
    laneId: id,
    kind: id,
    machineClassId: id,
    estimatedHours: z.number().check(z.positive()),
    actualHours: hours,
    review: reviewSchema,
    ciHours: z.optional(hours),
    startedAt: instant,
    finishedAt: instant,
    // Git elapsed time includes waiting; never silently fit it as agent time.
    durationBasis: z.enum(['agentTime', 'gitElapsed']),
    source: z.enum(['board', 'git', 'playbook', 'ci']),
    // M117 W (PLAN.md D97 §4, playbook §4): which engine ran the lane, when
    // known. Calibration fits durations and finding rates per engine × kind ×
    // machine class and re-fits after each finished lane; records without an
    // engine join the unscoped fit only.
    engine: z.optional(z.enum(ESTIMATE_ENGINES)),
  })
  .check(z.refine((record) => Date.parse(record.finishedAt) >= Date.parse(record.startedAt)))
export type HistoryRecord = z.infer<typeof historyRecordSchema>

export interface EstimateHistoryPort {
  list(): Promise<readonly HistoryRecord[]>
  append(record: HistoryRecord): Promise<void>
}

export const estimateRequestSchema = z.strictObject({
  goal: estimateGoalSchema,
  asOf: instant,
  deadline: z.optional(instant),
  fleet: z.enum(['current', 'minimum', 'optimum']),
  optimize: z.enum(['cost', 'speed']),
  seed: z.optional(z.string().check(z.minLength(1), z.maxLength(ESTIMATE_ID_MAX_CHARS))),
})
export type EstimateRequest = z.infer<typeof estimateRequestSchema>

export const estimateInputsSchema = z
  .strictObject({
    request: estimateRequestSchema,
    lanes: z.array(estimateLaneSchema).check(z.maxLength(ESTIMATE_MAX_ITEMS)),
    fleet: fleetSnapshotSchema,
    history: z.array(historyRecordSchema),
  })
  .check(
    z.refine(
      (input) =>
        input.request.asOf === input.fleet.asOf &&
        areUnique(input.lanes.map((lane) => lane.id)) &&
        input.lanes.every(
          (lane) =>
            !lane.dependencies.includes(lane.id) &&
            lane.dependencies.every((dependency) =>
              input.lanes.some((other) => other.id === dependency),
            ),
        ),
    ),
  )
export type EstimateInputs = z.infer<typeof estimateInputsSchema>

const scheduleEntrySchema = z
  .strictObject({
    laneId: id,
    machineId: id,
    slotIds: boundedIds.check(z.minLength(1), z.refine(areUnique)),
    accountIds: boundedIds.check(z.minLength(1), z.refine(areUnique)),
    start: instant,
    end: instant,
    slackHours: hours,
    critical: z.boolean(),
  })
  .check(z.refine((entry) => Date.parse(entry.end) >= Date.parse(entry.start)))
const catalogPriceSchema = z.strictObject({
  providerId: id,
  sizeId: id,
  hourlyUsd: hours,
  catalogUrl: z.url().check(z.startsWith('https://')),
  catalogDate: z.iso.date(),
  // Only public catalogs without an account may supply advice prices.
  publicCatalog: z.literal(true),
})
export type CatalogPrice = z.infer<typeof catalogPriceSchema>
const setupSchema = z
  .strictObject({
    kind: z.enum(['current', 'minimumP50', 'minimumP90', 'optimumCost', 'optimumSpeed']),
    machines: z.array(
      z.strictObject({
        classId: id,
        count: positiveCount,
        slots: count,
        accounts: count,
        price: z.optional(catalogPriceSchema),
        marginalP50Hours: hours,
        marginalP90Hours: hours,
      }),
    ),
    p50: instant,
    p90: instant,
    meetsDeadline: z.boolean(),
    provisioning: z.enum(['existing', 'adviceOnly', 'connected']),
  })
  .check(z.refine((setup) => Date.parse(setup.p90) >= Date.parse(setup.p50)))

const disclosureSchema = z
  .strictObject({
    // JSON Pointer into this section, excluding the disclosures themselves.
    path: z.string().check(z.startsWith('/'), z.maxLength(ESTIMATE_LABEL_MAX_CHARS)),
    basis: z.enum(['history', 'calibration', 'assumption', 'unknown']),
    samples: count,
    uncertainty: z.union([
      numericUncertainty,
      z
        .strictObject({ kind: z.literal('time'), earliest: instant, latest: instant })
        .check(z.refine((range) => Date.parse(range.earliest) <= Date.parse(range.latest))),
    ]),
  })
  .check(
    z.refine(
      (disclosure) =>
        hasSamplesForBasis(disclosure) &&
        (disclosure.basis !== 'unknown' || disclosure.uncertainty.kind === 'unknown'),
    ),
  )

/** Cover numbers in inputs and results, and dates predicting a finish.
 * Evidence metadata is covered too; only this index's own metadata is excluded
 * to avoid infinite self-description. JSON Pointer makes coverage unambiguous.
 */
function disclosureTargets(value: unknown, pointer = ''): Map<string, number | string> {
  if (typeof value === 'number') return new Map([[pointer, value]])
  if (typeof value === 'string' && /\/(?:p50|p90)$/.test(pointer))
    return new Map([[pointer, value]])
  const targets = new Map<string, number | string>()
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (pointer === '' && key === 'disclosures') continue
      const segment = key.replaceAll('~', '~0').replaceAll('/', '~1')
      for (const [path, target] of disclosureTargets(child, `${pointer}/${segment}`))
        targets.set(path, target)
    }
  }
  return targets
}

/** Section payload for M113 report-v1; lane W binds its envelope when merged. */
export const estimateSectionSchema = z
  .strictObject({
    kind: z.literal('estimate'),
    schemaVersion: z.literal(1),
    asOf: instant,
    p50: instant,
    p90: instant,
    seed: z.string().check(z.minLength(1)),
    runs: positiveCount,
    schedule: z.array(scheduleEntrySchema),
    criticalPath: boundedIds,
    limitingResource: z
      .strictObject({
        kind: z.enum(['machines', 'slots', 'accountRate', 'ci', 'disk', 'criticalPath']),
        resourceId: z.optional(id),
        hoursSavedIfUnbounded: hours,
        moreAgentsHelp: z.boolean(),
      })
      .check(
        z.refine(
          (resource) =>
            resource.kind !== 'criticalPath' ||
            (!resource.moreAgentsHelp && resource.hoursSavedIfUnbounded === 0),
        ),
      ),
    setups: z.array(setupSchema),
    inputs: estimateInputsSchema,
    disclosures: z.array(disclosureSchema),
    calibration: z.array(
      z
        .strictObject({
          kind: id,
          machineClassId: id,
          // M117 W (playbook §4): the engine this fit is scoped to, when it
          // is. Rows without an engine are the unscoped fit every lane kind
          // keeps; engine rows re-fit after each finished lane of that engine.
          engine: z.optional(z.enum(ESTIMATE_ENGINES)),
          samples: count,
          basis: z.enum(['uncalibratedPrior', 'fitted']),
          mu: z.number(),
          sigma: z.number().check(z.positive()),
          reviewRoundRate: z.number().check(z.nonnegative(), z.maximum(1)),
          redesignRisk: z.number().check(z.nonnegative(), z.maximum(1)),
        })
        .check(
          z.refine(
            (calibration) =>
              calibration.samples >= ESTIMATE_CALIBRATION_MIN_SAMPLES ===
              (calibration.basis === 'fitted'),
          ),
        ),
    ),
    drift: z.optional(
      z.strictObject({
        previousAsOf: instant,
        p50Hours: z.number(),
        p90Hours: z.number(),
      }),
    ),
    // M117 W (PLAN.md D100, gotcha G4): named schedule risks the dates do not
    // price. A stale base names its lane; rebase before starting it.
    risks: z.optional(
      z.array(
        z.strictObject({
          laneId: id,
          kind: z.enum(['staleBase']),
        }),
      ),
    ),
  })
  .check(
    z.refine(
      (estimate) =>
        Date.parse(estimate.p90) >= Date.parse(estimate.p50) &&
        Date.parse(estimate.p50) >= Date.parse(estimate.asOf) &&
        estimate.asOf === estimate.inputs.request.asOf &&
        areUnique(estimate.schedule.map((entry) => entry.laneId)) &&
        estimate.schedule.every((entry) =>
          estimate.inputs.lanes.some((lane) => lane.id === entry.laneId),
        ) &&
        estimate.criticalPath.every((laneId) =>
          estimate.inputs.lanes.some((lane) => lane.id === laneId),
        ) &&
        areUnique(
          estimate.calibration.map(
            (row) => `${row.kind}:${row.machineClassId}:${row.engine ?? ''}`,
          ),
        ) &&
        estimate.inputs.lanes.every((lane) =>
          estimate.calibration.some((row) => row.kind === lane.kind),
        ) &&
        estimate.schedule.every((entry) => {
          const lane = estimate.inputs.lanes.find((lane) => lane.id === entry.laneId)
          const machine = estimate.inputs.fleet.machines.find(
            (machine) => machine.id === entry.machineId,
          )
          return estimate.calibration.some(
            (row) => row.kind === lane?.kind && row.machineClassId === machine?.classId,
          )
        }),
    ),
    z.refine((estimate) => {
      if (estimate.inputs.lanes.length === 0) return true
      const targets = disclosureTargets(estimate)
      return (
        areUnique(estimate.disclosures.map((disclosure) => disclosure.path)) &&
        estimate.disclosures.length === targets.size &&
        estimate.disclosures.every((disclosure) => {
          const value = targets.get(disclosure.path)
          if (value === undefined) return false
          const range = disclosure.uncertainty
          if (range.kind === 'unknown') return true
          return typeof value === 'number'
            ? range.kind === 'interval' && range.lower <= value && value <= range.upper
            : range.kind === 'time' &&
                Date.parse(range.earliest) <= Date.parse(value) &&
                Date.parse(value) <= Date.parse(range.latest)
        })
      )
    }),
  )
export type EstimateSection = z.infer<typeof estimateSectionSchema>

/** Application projection after a captured provider response is validated. */
export const providerSizeSchema = z.strictObject({
  id,
  classId: id,
  hourlyUsd: hours,
})
export const providerImageSchema = z.strictObject({ id, os, architecture })
export const provisionedServerSchema = z.strictObject({
  id,
  sizeId: id,
  imageId: id,
  state: z.enum(['creating', 'running', 'stopped', 'deleting', 'deleted', 'failed']),
})
export type ProviderSize = z.infer<typeof providerSizeSchema>
export type ProviderImage = z.infer<typeof providerImageSchema>
export type ProvisionedServer = z.infer<typeof provisionedServerSchema>
export type EstimateProviderOperation = 'sizes' | 'images' | 'create' | 'status' | 'delete'

/** Exact paths (or a single {id} segment), fixed origin; no generic HTTP port.
 * Lane P enforces this before the vault broker dispatches, including redirects.
 */
export interface EstimateProviderEndpoint {
  readonly operation: EstimateProviderOperation
  readonly method: 'GET' | 'POST' | 'DELETE'
  readonly path: string
}
export interface EstimateProviderPort {
  readonly id: string
  readonly apiOrigin: string
  readonly endpoints: readonly EstimateProviderEndpoint[]
  sizes(): Promise<readonly ProviderSize[]>
  images(): Promise<readonly ProviderImage[]>
  create(size: ProviderSize, image: ProviderImage, cloudInit: string): Promise<ProvisionedServer>
  status(id: string): Promise<ProvisionedServer>
  delete(id: string): Promise<void>
}

/** Missing milestone bindings remain explicit injected ports. No fallback. */
export interface EstimateSourcesPort {
  lanes(goal: EstimateGoal, asOf: string): Promise<readonly EstimateLane[]>
  fleet(asOf: string): Promise<FleetSnapshot>
  history: EstimateHistoryPort
}
export interface EstimateStartPort {
  audit(laneIds: readonly string[]): Promise<{
    readonly allowed: boolean
    readonly missingPrerequisites: readonly string[]
  }>
  start(laneIds: readonly string[]): Promise<void>
}
export interface EstimateNodePort {
  install(server: ProvisionedServer): Promise<void>
  pair(server: ProvisionedServer): Promise<void>
  teardownAndWipe(server: ProvisionedServer): Promise<void>
}
