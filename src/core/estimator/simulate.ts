import { fingerprint } from '../verify/fingerprint'
import {
  estimateInputsSchema,
  estimateSectionSchema,
  estimateLaneSchema,
  type EstimateInputs,
  type EstimateLane,
  type EstimateSection,
} from '../../shared/estimate'
import {
  CHECK_FIX_MAX_ROUNDS,
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_RUNS,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { compareEstimateIds } from './goal'
import { canEstimateMachineRun, prepareEstimateSchedule } from './schedule'

type Quantity = EstimateLane['resources']['ciMinutes']
type Calibration = EstimateSection['calibration'][number]
export type EstimateDurationModel =
  | { kind: 'fixed'; hours: Quantity }
  | { kind: 'lognormal'; calibration: Calibration; reviewHours: Quantity; redesignHours: Quantity }

/** C owns fitting/prior rates and overhead evidence; S never invents them.
 * Lognormal mu/sigma describe actual/estimated total lane duration. Review
 * and redesign overheads must exclude work already included in that fit.
 */
export interface EstimateDurationPort {
  model(lane: EstimateLane, machineClassId: string): EstimateDurationModel
}

export interface EstimateDurationSample {
  laneId: string
  machineClassId: string
  hours: number
  reviewRounds: number
  redesigns: number
}

export interface EstimateSimulation {
  seed: string
  runs: number
  p50: string
  p90: string
  p50Hours: number
  p90Hours: number
  schedule: EstimateSection['schedule']
  criticalPath: string[]
  criticalPathHours: number
  unknownLimits: string[]
  /** The actual P50 trial, for paired bottleneck comparisons and disclosures. */
  durationSamples: EstimateDurationSample[]
  models: { laneId: string; machineClassId: string; model: EstimateDurationModel }[]
}

const HOUR_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR
// Xorshift32's fixed algorithm coefficients, not configurable tunables.
const WORD_BITS = 32
const WORD_HEX_CHARS = 8
const HEX_RADIX = 16
const SHIFT_LEFT_A = 13
const SHIFT_RIGHT = 17
const SHIFT_LEFT_B = 5
const WORD_RANGE = 2 ** WORD_BITS
const P50 = 0.5
const P90 = 0.9

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** All input arrays are sets of application records/identities; object and
 * array order cannot change the seed. No locale-dependent ordering is used.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value
      .map((entry) => canonical(entry))
      .toSorted(compareEstimateIds)
      .join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .toSorted(([a], [b]) => compareEstimateIds(a, b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** SHA-256 seeds our small dependency-free PRNG. Midpoints exclude 0/1,
 * so Box–Muller and geometric draws cannot take log(0).
 */
export function estimateRandom(seed: string): () => number {
  let state = Number.parseInt(fingerprint(seed).slice(0, WORD_HEX_CHARS), HEX_RADIX) || 1
  return () => {
    state ^= state << SHIFT_LEFT_A
    state ^= state >>> SHIFT_RIGHT
    state ^= state << SHIFT_LEFT_B
    return ((state >>> 0) + P50) / WORD_RANGE
  }
}

function value(quantity: Quantity): number {
  if (quantity.status === 'unknown') refuse('unknown-duration-model')
  if (!Number.isFinite(quantity.value) || quantity.value < 0) refuse('invalid-duration-model')

  return quantity.value
}

function validate(model: EstimateDurationModel, lane: EstimateLane, machineClassId: string): void {
  const quantities =
    model.kind === 'fixed' ? [model.hours] : [model.reviewHours, model.redesignHours]
  for (const quantity of quantities) {
    value(quantity)
    if (!estimateLaneSchema.shape.resources.shape.ciMinutes.safeParse(quantity).success)
      refuse('invalid-model-evidence')
  }
  if (model.kind === 'fixed') return
  const row = model.calibration
  if (row.kind !== lane.kind || row.machineClassId !== machineClassId) refuse('model-identity')
  if (row.reviewRoundRate >= 1) refuse('invalid-distribution')
  if (!estimateSectionSchema.shape.calibration.def.element.safeParse(row).success)
    refuse('invalid-distribution')
  if (lane.review.status === 'unknown' && row.redesignRisk > 0 && value(model.redesignHours) > 0)
    refuse('unknown-review-modules')
}

function sample(
  lane: EstimateLane,
  model: EstimateDurationModel,
  random: () => number,
): Omit<EstimateDurationSample, 'laneId' | 'machineClassId'> {
  if (model.kind === 'fixed')
    return {
      hours: Math.max(
        lane.state === 'running' ? lane.minimumRemainingHours : 0,
        value(model.hours),
      ),
      reviewRounds: 0,
      redesigns: 0,
    }
  const row = model.calibration
  const normal = Math.sqrt(2 * -Math.log(random())) * Math.cos(2 * Math.PI * random())
  const total = lane.estimatedHours * Math.exp(row.mu + row.sigma * normal)
  const reviewRounds =
    row.reviewRoundRate === 0 ? 0 : Math.floor(Math.log(random()) / Math.log(row.reviewRoundRate))
  if (reviewRounds > ESTIMATE_MAX_ITEMS) refuse('review-horizon')
  const modules =
    lane.review.status === 'known'
      ? lane.review.modules.toSorted((a, b) => compareEstimateIds(a.familyId, b.familyId))
      : []
  const redesigns = modules.filter(
    (module) =>
      module.strikes + reviewRounds >= CHECK_FIX_MAX_ROUNDS &&
      reviewRounds > 0 &&
      random() < row.redesignRisk,
  ).length
  const remaining = total - (lane.state === 'running' ? lane.elapsedAgentHours : 0)
  const hours =
    Math.max(lane.minimumRemainingHours, remaining) +
    reviewRounds * value(model.reviewHours) +
    redesigns * value(model.redesignHours)
  if (!Number.isFinite(hours)) refuse('duration-model-overflow')
  return { hours, reviewRounds, redesigns }
}

export function estimateDurationMap(
  samples: readonly EstimateDurationSample[],
): Map<string, Map<string, number>> {
  const durations = new Map<string, Map<string, number>>()
  for (const entry of samples) {
    const classes = durations.get(entry.laneId) ?? new Map<string, number>()
    classes.set(entry.machineClassId, entry.hours)
    durations.set(entry.laneId, classes)
  }
  return durations
}

/** Exactly ESTIMATE_RUNS trials. Nearest-rank quantiles select real trials;
 * the representative schedule is P50's trial, not independent lane medians.
 * Report assembly keeps these models/input quantities as disclosure evidence.
 */
export function simulateEstimate(
  input: EstimateInputs,
  port: EstimateDurationPort,
): EstimateSimulation {
  const inputs = estimateInputsSchema.parse(input)
  const scheduler = prepareEstimateSchedule(inputs.lanes, inputs.fleet)
  const lanes = inputs.lanes.toSorted((a, b) => compareEstimateIds(a.id, b.id))
  const layout = lanes
    .filter((lane) => lane.state !== 'merged')
    .flatMap((lane) =>
      [
        ...new Set(
          inputs.fleet.machines
            .filter((machine) => canEstimateMachineRun(lane, machine))
            .map((machine) => machine.classId),
        ),
      ]
        .toSorted(compareEstimateIds)
        .map((machineClassId) => ({ lane, machineClassId })),
    )
  if (layout.length > ESTIMATE_MAX_ITEMS) refuse('model-limit')
  const models = layout.map(({ lane, machineClassId }) => {
    const model = structuredClone(port.model(lane, machineClassId))
    validate(model, lane, machineClassId)
    return { laneId: lane.id, machineClassId, model }
  })
  const seed = inputs.request.seed ?? fingerprint(canonical({ inputs, models }))
  const random = estimateRandom(seed)
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  const trials: { index: number; hours: number }[] = []
  const samplesByTrial: EstimateDurationSample[][] = []
  const unknownLimits = new Set<string>()
  for (const lane of lanes)
    if (lane.review.status === 'unknown') unknownLimits.add(`${lane.id}:review`)
  for (let index = 0; index < ESTIMATE_RUNS; index++) {
    const samples = models.map(({ laneId, machineClassId, model }) => {
      const lane = byId.get(laneId) ?? refuse('missing-lane')
      return {
        laneId,
        machineClassId,
        ...(lane.state === 'merged'
          ? { hours: 0, reviewRounds: 0, redesigns: 0 }
          : sample(lane, model, random)),
      }
    })
    const durations = estimateDurationMap(samples)
    for (const lane of lanes) if (!durations.has(lane.id)) durations.set(lane.id, new Map())
    const result = scheduler.run(durations)
    for (const limit of result.unknownLimits) unknownLimits.add(limit)
    trials.push({ index, hours: result.finishHours })
    samplesByTrial.push(samples)
  }
  const ranked = trials.toSorted((a, b) => a.hours - b.hours || a.index - b.index)
  const median = ranked[Math.ceil(ESTIMATE_RUNS * P50) - 1] ?? refuse('missing-trial')
  const upper = ranked[Math.ceil(ESTIMATE_RUNS * P90) - 1] ?? refuse('missing-trial')
  const durationSamples = samplesByTrial[median.index] ?? refuse('missing-trial')
  const durations = estimateDurationMap(durationSamples)
  for (const lane of lanes) if (!durations.has(lane.id)) durations.set(lane.id, new Map())
  const result = scheduler.run(durations)
  const date = (hours: number): string =>
    new Date(Date.parse(inputs.request.asOf) + hours * HOUR_MS).toISOString()
  return {
    seed,
    runs: ESTIMATE_RUNS,
    p50: date(median.hours),
    p90: date(upper.hours),
    p50Hours: median.hours,
    p90Hours: upper.hours,
    schedule: result.schedule,
    criticalPath: result.criticalPath,
    criticalPathHours: result.criticalPathHours,
    unknownLimits: [...unknownLimits].toSorted(compareEstimateIds),
    durationSamples,
    models,
  }
}
