// M117 / D97's application contracts. These are our documents and injected
// ports, never guessed provider/MSP frames. External adapters parse captured
// wire shapes before projecting them here. Import only on estimator use.
import * as z from 'zod/mini'
import {
  ESTIMATE_CALIBRATION_MIN_SAMPLES,
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
  z.strictObject({ kind: z.literal('release'), release: id }),
  z.strictObject({
    kind: z.literal('lanes'),
    milestoneId,
    laneIds: boundedIds.check(z.minLength(1), z.refine(areUnique)),
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
    z
      .array(
        z.strictObject({
          id,
          unit: z.enum(['requests', 'tokens', 'usd']),
          remaining: hours,
          resetsAt: instant,
        }),
      )
      .check(
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
    slots: positiveCount,
    accountRequestsPerHour: hours,
    accountTokensPerHour: hours,
    accountUsdPerHour: hours,
    ciJobs: count,
    ciMinutes: hours,
    ciId: z.optional(id),
  }),
  reviewRounds: count,
})
export type EstimateLane = z.infer<typeof estimateLaneSchema>

export const historyRecordSchema = z
  .strictObject({
    laneId: id,
    kind: id,
    machineClassId: id,
    estimatedHours: z.number().check(z.positive()),
    actualHours: hours,
    reviewRounds: count,
    ciHours: z.optional(hours),
    startedAt: instant,
    finishedAt: instant,
    // Git elapsed time includes waiting; never silently fit it as agent time.
    durationBasis: z.enum(['agentTime', 'gitElapsed']),
    source: z.enum(['board', 'git', 'playbook', 'ci']),
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
        kind: z.enum(['machines', 'slots', 'accountRate', 'ci', 'criticalPath']),
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
    calibration: z.array(
      z
        .strictObject({
          kind: id,
          machineClassId: id,
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
        ),
    ),
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
