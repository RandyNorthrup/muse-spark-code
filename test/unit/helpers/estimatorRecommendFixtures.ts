import { compareEstimateIds } from '../../../src/core/estimator/goal'
import { type CatalogPrice, type FleetSnapshot } from '../../../src/shared/estimate'
import { simulateEstimate } from '../../../src/core/estimator/simulate'
import {
  recommendEstimate,
  type EstimateRecommendationPort,
} from '../../../src/core/estimator/recommend'
import {
  scheduleFleet,
  scheduleLane,
  simulationInputs,
  fixedDurationPort,
} from './estimatorScheduleFixtures'

export const catalogPrice = (rate = 0.02): CatalogPrice => ({
  providerId: 'fixture',
  sizeId: 'builder',
  hourlyUsd: rate,
  catalogUrl: 'https://catalog.invalid/sizes',
  catalogDate: '2026-10-06',
  publicCatalog: true,
})
export function recommendationFixture(rentals = 3) {
  const current = scheduleFleet(1)
  const pool = structuredClone(current)
  for (let index = 0; index < rentals; index++) {
    const id = `rental-${String(index)}`
    pool.machines.push({ ...structuredClone(current.machines[0]!), id, source: 'rented' })
    pool.slots.push({ ...current.slots[0]!, id: `${id}-slot`, machineId: id })
  }
  const inputs = simulationInputs(
    Array.from({ length: 12 }, (_, index) =>
      scheduleLane(`L${String(index)}`, { estimatedHours: 4 }),
    ),
    current,
  )
  inputs.request.deadline = '2026-10-07T12:00:00.000Z'
  return {
    inputs,
    pool,
    prices: pool.machines
      .filter((machine) => machine.source === 'rented')
      .map((machine) => ({ machineId: machine.id, price: catalogPrice() })),
  }
}
const forecasts = new Map<string, ReturnType<EstimateRecommendationPort['forecast']>>()
// Equivalent fixture machines differ only by aliases/source. S ignores source;
// canonical aliases let these identical resource layouts share real forecasts.
export const forecastPort: EstimateRecommendationPort = {
  forecast: (inputs) => {
    const machineAliases = new Map(
      inputs.fleet.machines.map((machine, index) => [machine.id, `machine-${String(index)}`]),
    )
    const slotAliases = new Map(
      inputs.fleet.slots.map((slot, index) => [slot.id, `slot-${String(index)}`]),
    )
    const canonicalInputs = {
      ...inputs,
      lanes: inputs.lanes.toSorted((a, b) => compareEstimateIds(a.id, b.id)),
      fleet: {
        ...inputs.fleet,
        machines: inputs.fleet.machines.map((machine) => ({
          ...machine,
          id: machineAliases.get(machine.id)!,
          source: 'node' as const,
        })),
        slots: inputs.fleet.slots.map((slot) => ({
          ...slot,
          id: slotAliases.get(slot.id)!,
          machineId: machineAliases.get(slot.machineId)!,
        })),
      },
    }
    const identity = JSON.stringify(canonicalInputs)
    let result = forecasts.get(identity)
    if (!result) {
      try {
        result = {
          status: 'feasible',
          simulation: simulateEstimate(canonicalInputs, fixedDurationPort),
        }
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('unschedulable:'))) throw error
        result = { status: 'infeasible', reason: 'fixture-resource-capacity' }
      }
      forecasts.set(identity, result)
    }
    const output = structuredClone(result)
    if (output.status === 'feasible') {
      const machineIds = new Map([...machineAliases].map(([id, alias]) => [alias, id]))
      const slotIds = new Map([...slotAliases].map(([id, alias]) => [alias, id]))
      output.simulation.schedule = output.simulation.schedule.map((entry) => ({
        ...entry,
        machineId: machineIds.get(entry.machineId)!,
        slotIds: entry.slotIds.map((id) => slotIds.get(id)!),
      }))
    }
    return output
  },
}
export function fixtureRecommendation(shouldReverse = false) {
  const { inputs, pool, prices } = recommendationFixture()
  if (shouldReverse) {
    inputs.lanes.reverse()
    inputs.fleet.slots.reverse()
    pool.machines.reverse()
    pool.slots.reverse()
    prices.reverse()
  }
  return recommendEstimate(inputs, pool, forecastPort, prices)
}
export function fleetForKind(
  result: ReturnType<typeof recommendEstimate>,
  kind: string,
): FleetSnapshot {
  const selection = result.selections.find((selection) => selection.kind === kind)
  if (!selection) throw new Error(`Missing fixture selection: ${kind}`)
  return result.evaluations[selection.evaluation]!.fleet
}
