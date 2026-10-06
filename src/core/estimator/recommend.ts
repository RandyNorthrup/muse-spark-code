import { z } from 'zod/mini'
import {
  estimateInputsSchema,
  estimateSectionSchema,
  fleetSnapshotSchema,
  machineClassesSchema,
  type CatalogPrice,
  type EstimateInputs,
  type EstimateSection,
  type FleetSnapshot,
} from '../../shared/estimate'
import machineClasses from '../../shared/machineClasses.json'
import {
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_MARGINAL_FLOOR_HOURS,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { compareEstimateIds } from './goal'
import { type EstimateSimulation } from './simulate'

/** S/C binding: infeasibility must be explicit; other errors propagate. */
export interface EstimateRecommendationPort {
  forecast(
    inputs: EstimateInputs,
  ):
    | { status: 'feasible'; simulation: EstimateSimulation }
    | { status: 'infeasible'; reason: string }
}
type Setup = EstimateSection['setups'][number]
export interface EstimateRecommendation {
  setups: Setup[]
  /** Complete evidence for the selected setups and their marginal predecessors. */
  evaluations: {
    fleet: FleetSnapshot
    forecast: ReturnType<EstimateRecommendationPort['forecast']>
    rentalCostP90Usd?: number
  }[]
  selections: { kind: Setup['kind']; evaluation: number }[]
  marginals: {
    kind: Setup['kind']
    machineId: string
    predecessor?: number
    status: 'known' | 'unknown'
    p50Hours: number
    p90Hours: number
  }[]
  unavailable: Setup['kind'][]
}

const HOUR_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const priceSchema =
  estimateSectionSchema.shape.setups.def.element.shape.machines.def.element.shape.price
const pricesSchema = z.array(
  z.strictObject({ machineId: z.string(), price: priceSchema.def.innerType }),
)
const quantilesSchema = z.strictObject({
  p50: estimateSectionSchema.shape.p50,
  p90: estimateSectionSchema.shape.p90,
  p50Hours: z.number().check(z.nonnegative()),
  p90Hours: z.number().check(z.nonnegative()),
})
function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}
function byId<T extends { id: string }>(entries: readonly T[]): T[] {
  return entries.toSorted((a, b) => compareEstimateIds(a.id, b.id))
}
function normalize(fleet: FleetSnapshot): FleetSnapshot {
  return fleetSnapshotSchema.parse({
    ...fleet,
    machines: byId(fleet.machines),
    slots: byId(fleet.slots),
    accounts: byId(fleet.accounts),
    roles: byId(fleet.roles),
    ci: byId(fleet.ci),
  })
}
function key(fleet: FleetSnapshot): string {
  return JSON.stringify([
    fleet.machines.map((machine) => machine.id),
    fleet.slots.map((slot) => slot.id),
    fleet.accounts.map((account) => account.id),
  ])
}
function counts(fleet: FleetSnapshot): number[] {
  return [fleet.machines.length, fleet.slots.length, fleet.accounts.length]
}
function compareCounts(a: FleetSnapshot, b: FleetSnapshot): number {
  const right = counts(b)
  for (const [index, value] of counts(a).entries()) {
    const difference = value - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
function subset(pool: FleetSnapshot, slotIds: ReadonlySet<string>): FleetSnapshot {
  const slots = pool.slots.filter((slot) => slotIds.has(slot.id))
  return {
    ...pool,
    slots,
    machines: pool.machines.filter((machine) =>
      slots.some((slot) => slot.machineId === machine.id),
    ),
    accounts: pool.accounts.filter((account) =>
      slots.some((slot) => slot.accountId === account.id),
    ),
  }
}

/** Exhaustive within the supplied pool, never a universal sizing promise.
 * Candidate capacities, disk and accounts come from M107/M108/P, not vCPU
 * guesses. Bound the search before calling the expensive S/C evaluator.
 */
export function recommendEstimate(
  input: EstimateInputs,
  candidatePool: FleetSnapshot,
  port: EstimateRecommendationPort,
  catalogPrices: readonly { machineId: string; price: CatalogPrice }[] = [],
): EstimateRecommendation {
  const inputs = estimateInputsSchema.parse(input)
  const current = normalize(inputs.fleet)
  const pool = normalize(candidatePool)
  if (pool.asOf !== inputs.request.asOf) refuse('pool-as-of')
  const collections = ['machines', 'slots', 'accounts', 'roles', 'ci'] as const
  for (const collection of collections) {
    const entries = current[collection]
    for (const entry of entries)
      if (pool[collection].every((other) => JSON.stringify(entry) !== JSON.stringify(other)))
        refuse('pool-changes-existing-resources')
  }
  if (pool.roles.length !== current.roles.length || pool.ci.length !== current.ci.length)
    refuse('pool-changes-shared-resources')
  const classes = machineClassesSchema.parse(machineClasses)
  for (const machine of pool.machines) {
    if (machine.source !== 'rented') continue
    const size = classes.find((size) => size.id === machine.classId)
    if (
      size?.os !== machine.os ||
      size.architecture !== machine.architecture ||
      size.vcpu !== machine.cores ||
      size.ramGiB !== machine.ramGiB ||
      JSON.stringify(size.gpu) !== JSON.stringify(machine.gpu)
    )
      refuse('rental-class-mismatch')
  }
  const prices = pricesSchema.parse(catalogPrices)
  if (new Set(prices.map((row) => row.machineId)).size !== prices.length) refuse('duplicate-price')
  for (const row of prices) {
    if (
      pool.machines.every(
        (machine) => !(machine.id === row.machineId && machine.source === 'rented'),
      )
    )
      refuse('price-machine')
    const url = new URL(row.price.catalogUrl)
    if (
      url.username ||
      url.password ||
      row.price.catalogDate > inputs.request.asOf.slice(0, 'YYYY-MM-DD'.length)
    )
      refuse('price-provenance')
  }
  const variants = 2 ** pool.slots.length
  const hasBaseline =
    key(subset(pool, new Set(current.slots.map((slot) => slot.id)))) === key(current)
  if (variants + (hasBaseline ? 0 : 1) > ESTIMATE_MAX_ITEMS) refuse('recommendation-search-limit')
  const evaluations: EstimateRecommendation['evaluations'] = []
  const indexed = new Map<string, number>()
  const evaluate = (fleet: FleetSnapshot): number => {
    const identity = key(fleet)
    const cached = indexed.get(identity)
    if (cached !== undefined) return cached
    const forecast = structuredClone(port.forecast(structuredClone({ ...inputs, fleet })))
    let rentalCostP90Usd: number | undefined
    if (forecast.status === 'feasible') {
      const { p50, p90, p50Hours, p90Hours } = quantilesSchema.parse({
        p50: forecast.simulation.p50,
        p90: forecast.simulation.p90,
        p50Hours: forecast.simulation.p50Hours,
        p90Hours: forecast.simulation.p90Hours,
      })
      const asOf = Date.parse(inputs.request.asOf)
      if (
        p90Hours < p50Hours ||
        Math.abs(Date.parse(p50) - asOf - p50Hours * HOUR_MS) >= 1 ||
        Math.abs(Date.parse(p90) - asOf - p90Hours * HOUR_MS) >= 1
      )
        refuse('forecast-quantiles')
      const rented = fleet.machines.filter((machine) => machine.source === 'rented')
      const rates = rented.map(
        (machine) => prices.find((row) => row.machineId === machine.id)?.price.hourlyUsd,
      )
      if (rates.every((rate) => rate !== undefined)) {
        rentalCostP90Usd = rates.reduce((sum, rate) => sum + rate, 0) * p90Hours
        if (!Number.isFinite(rentalCostP90Usd)) refuse('cost-overflow')
      }
    } else if (forecast.reason.length === 0) refuse('missing-infeasibility-reason')
    const index = evaluations.length
    evaluations.push({
      fleet: structuredClone(fleet),
      forecast,
      ...(rentalCostP90Usd !== undefined && { rentalCostP90Usd }),
    })
    indexed.set(identity, index)
    return index
  }
  const currentIndex = evaluate(current)
  let subsets: Set<string>[] = [new Set()]
  for (const slot of pool.slots)
    subsets = [...subsets, ...subsets.map((ids) => new Set([...ids, slot.id]))]
  for (const ids of subsets) evaluate(subset(pool, ids))
  const feasible = evaluations.flatMap((entry, index) =>
    entry.forecast.status === 'feasible'
      ? [{ ...entry, index, simulation: entry.forecast.simulation }]
      : [],
  )
  const deadline = inputs.request.deadline
  const minimum = (quantile: 'p50' | 'p90') =>
    feasible
      .filter(
        (entry) =>
          deadline !== undefined && Date.parse(entry.simulation[quantile]) <= Date.parse(deadline),
      )
      .toSorted(
        (a, b) =>
          compareCounts(a.fleet, b.fleet) ||
          a.simulation[`${quantile}Hours`] - b.simulation[`${quantile}Hours`] ||
          a.index - b.index,
      )[0]
  const p50 = minimum('p50')
  const p90 = minimum('p90')
  const cost = feasible
    .filter(
      (entry) =>
        deadline !== undefined &&
        Date.parse(entry.simulation.p90) <= Date.parse(deadline) &&
        entry.rentalCostP90Usd !== undefined,
    )
    .toSorted(
      (a, b) =>
        (a.rentalCostP90Usd ?? Infinity) - (b.rentalCostP90Usd ?? Infinity) ||
        compareCounts(a.fleet, b.fleet) ||
        a.simulation.p90Hours - b.simulation.p90Hours ||
        a.index - b.index,
    )[0]
  const hasCurrent = (fleet: FleetSnapshot) =>
    current.slots.every((slot) => fleet.slots.some((other) => other.id === slot.id))
  const ordered = feasible.toSorted((a, b) => compareCounts(a.fleet, b.fleet) || a.index - b.index)
  const activeCurrentIndex = indexed.get(
    key(subset(pool, new Set(current.slots.map((slot) => slot.id)))),
  )
  const existing = feasible.find((entry) => entry.index === activeCurrentIndex)
  const extensions = ordered.filter((entry) => hasCurrent(entry.fleet))
  const first = extensions[0]
  const roots = existing
    ? [existing]
    : extensions.filter((entry) => first && compareCounts(entry.fleet, first.fleet) === 0)
  const reachable = new Set(roots.map((entry) => entry.index))
  // Explore every qualifying one-machine expansion. A greedy first purchase
  // can be a dead end even when a different path reaches a faster setup.
  for (const entry of ordered) {
    if (reachable.has(entry.index)) continue
    if (
      ordered.some(
        (before) =>
          reachable.has(before.index) &&
          entry.fleet.machines.length === before.fleet.machines.length + 1 &&
          before.fleet.slots.every((slot) =>
            entry.fleet.slots.some((other) => other.id === slot.id),
          ) &&
          before.simulation.p90Hours - entry.simulation.p90Hours >= ESTIMATE_MARGINAL_FLOOR_HOURS,
      )
    )
      reachable.add(entry.index)
  }
  const speed = feasible
    .filter((entry) => reachable.has(entry.index))
    .toSorted(
      (a, b) =>
        a.simulation.p90Hours - b.simulation.p90Hours ||
        compareCounts(a.fleet, b.fleet) ||
        a.index - b.index,
    )[0]
  const choices: { kind: Setup['kind']; index: number | undefined }[] = [
    { kind: 'current', index: feasible.find((entry) => entry.index === currentIndex)?.index },
    { kind: 'minimumP50', index: p50?.index },
    { kind: 'minimumP90', index: p90?.index },
    { kind: 'optimumCost', index: cost?.index },
    { kind: 'optimumSpeed', index: speed?.index },
  ]
  const result: EstimateRecommendation = {
    setups: [],
    evaluations,
    selections: [],
    marginals: [],
    unavailable: [],
  }
  for (const choice of choices) {
    const entry = feasible.find((entry) => entry.index === choice.index)
    if (!entry) {
      result.unavailable.push(choice.kind)
      continue
    }
    const machineRows = entry.fleet.machines.map((machine) => {
      const remaining = new Set(
        entry.fleet.slots.filter((slot) => slot.machineId !== machine.id).map((slot) => slot.id),
      )
      const predecessor = indexed.get(key(subset(pool, remaining)))
      const prior = feasible.find((entry) => entry.index === predecessor)
      const p50Hours = prior
        ? Math.max(0, prior.simulation.p50Hours - entry.simulation.p50Hours)
        : 0
      const p90Hours = prior
        ? Math.max(0, prior.simulation.p90Hours - entry.simulation.p90Hours)
        : 0
      result.marginals.push({
        kind: choice.kind,
        machineId: machine.id,
        ...(prior && { predecessor: prior.index }),
        status: prior ? 'known' : 'unknown',
        p50Hours,
        p90Hours,
      })
      const slots = entry.fleet.slots.filter((slot) => slot.machineId === machine.id)
      const price = prices.find((row) => row.machineId === machine.id)?.price
      return {
        classId: machine.classId,
        count: 1,
        slots: slots.length,
        accounts: new Set(slots.map((slot) => slot.accountId)).size,
        ...(price && { price }),
        marginalP50Hours: p50Hours,
        marginalP90Hours: p90Hours,
      }
    })
    // One row per machine preserves every marginal and distinct offer. U can
    // sum class counts, but must not add accounts shared across these rows.
    const setup = estimateSectionSchema.shape.setups.def.element.parse({
      kind: choice.kind,
      machines: machineRows,
      p50: entry.simulation.p50,
      p90: entry.simulation.p90,
      meetsDeadline:
        deadline !== undefined &&
        Date.parse(entry.simulation[choice.kind === 'minimumP50' ? 'p50' : 'p90']) <=
          Date.parse(deadline),
      provisioning: entry.fleet.machines.some((machine) => machine.source === 'rented')
        ? 'adviceOnly'
        : 'existing',
    })
    result.setups.push(setup)
    result.selections.push({ kind: choice.kind, evaluation: entry.index })
  }
  return result
}
