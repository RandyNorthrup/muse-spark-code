import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import {
  recommendEstimate,
  type EstimateRecommendation,
  type EstimateRecommendationPort,
} from '../../src/core/estimator/recommend'
import { simulateEstimate } from '../../src/core/estimator/simulate'
import { ESTIMATE_MARGINAL_FLOOR_HOURS } from '../../src/shared/constants'
import machineClassData from '../../src/shared/machineClasses.json'
import { machineClassesSchema } from '../../src/shared/estimate'
const machineClasses = machineClassesSchema.parse(machineClassData)
import {
  fixedDurationPort,
  lognormalPort,
  scheduleLane,
  amount,
} from './helpers/estimatorScheduleFixtures'
import {
  recommendationFixture,
  fixtureRecommendation,
  forecastPort,
  fleetForKind,
  catalogPrice,
} from './helpers/estimatorRecommendFixtures'

const fixture: { golden?: EstimateRecommendation; belowFloor?: EstimateRecommendation } = {}
function golden(): EstimateRecommendation {
  return fixture.golden!
}
function rentalOnlyFixture() {
  const fixture = recommendationFixture(2)
  for (const fleet of [fixture.inputs.fleet, fixture.pool])
    fleet.machines[0]!.classId = 'existing-builder'
  return fixture
}
beforeAll(() => {
  fixture.golden = fixtureRecommendation()
})
beforeAll(() => {
  const { inputs, pool } = recommendationFixture()
  inputs.lanes = Array.from({ length: 6 }, (_, index) =>
    scheduleLane(`L${String(index)}`, { estimatedHours: 4 }),
  )
  fixture.belowFloor = recommendEstimate(inputs, pool, forecastPort)
})

describe('M117 setup recommendations', () => {
  it('finds deadline minima and cost/speed optima from real S forecasts', () => {
    expect(golden().unavailable).toEqual([])
    expect(golden().evaluations).toHaveLength(16)
    expect(
      golden().setups.map((setup) => [
        setup.kind,
        setup.machines.length,
        setup.p90,
        setup.meetsDeadline,
      ]),
    ).toEqual([
      ['current', 1, '2026-10-08T12:00:00.000Z', false],
      ['minimumP50', 2, '2026-10-07T12:00:00.000Z', true],
      ['minimumP90', 2, '2026-10-07T12:00:00.000Z', true],
      ['optimumCost', 2, '2026-10-07T12:00:00.000Z', true],
      ['optimumSpeed', 4, '2026-10-07T00:00:00.000Z', true],
    ])
    expect(
      fleetForKind(golden(), 'optimumCost').machines.some((machine) => machine.id === 'linux'),
    ).toBe(true)
    const selected = golden().selections.find((entry) => entry.kind === 'optimumCost')!
    expect(golden().evaluations[selected.evaluation]!.rentalCostP90Usd).toBe(0.48)
    expect(golden().setups.find((setup) => setup.kind === 'optimumCost')!.provisioning).toBe(
      'adviceOnly',
    )
    expect(golden().evaluations[selected.evaluation]!.forecast.status).toBe('feasible')
  })
  it('keeps P50 and P90 minima distinct with seeded duration uncertainty', () => {
    const { inputs, pool } = recommendationFixture(2)
    inputs.lanes = [
      scheduleLane('A', { estimatedHours: 12 }),
      scheduleLane('B', { estimatedHours: 12 }),
    ]
    inputs.request.deadline = '2026-10-07T16:00:00.000Z'
    const uncertain: EstimateRecommendationPort = {
      forecast: (input) => {
        return input.fleet.slots.length === 0
          ? { status: 'infeasible', reason: 'fixture-no-slots' }
          : { status: 'feasible', simulation: simulateEstimate(input, lognormalPort) }
      },
    }
    const result = recommendEstimate(inputs, pool, uncertain)
    expect(fleetForKind(result, 'minimumP50').machines).toHaveLength(1)
    expect(fleetForKind(result, 'minimumP90').machines).toHaveLength(2)
    expect(result.unavailable).toContain('optimumCost')
    const selection = result.selections.find((entry) => entry.kind === 'minimumP90')!
    const evidence = result.evaluations[selection.evaluation]!.forecast
    expect(evidence.status).toBe('feasible')
    if (evidence.status !== 'feasible') {
      return
    }

    expect(evidence.simulation.p90Hours).toBeGreaterThan(evidence.simulation.p50Hours)
    expect(evidence.simulation.models[0]!.model.kind).toBe('lognormal')
  })
  it('reports decreasing marginal gains on parallel work and preserves shared accounts', () => {
    const getGain = (count: number) => {
      const entry = golden().evaluations.find(
        (entry) => entry.fleet.machines.length === count && entry.forecast.status === 'feasible',
      )!
      expect(entry.forecast.status).toBe('feasible')
      return entry.forecast.status === 'feasible' ? entry.forecast.simulation.p90Hours : Infinity
    }
    expect([getGain(1) - getGain(2), getGain(2) - getGain(3), getGain(3) - getGain(4)]).toEqual([
      24, 8, 4,
    ])
    expect(
      golden()
        .marginals.filter((row) => row.kind === 'optimumSpeed')
        .map((row) => row.p90Hours),
    ).toEqual(Array.from({ length: 4 }, () => ESTIMATE_MARGINAL_FLOOR_HOURS))
    expect(fleetForKind(golden(), 'optimumSpeed').accounts).toHaveLength(1)
    expect(
      golden()
        .setups.find((setup) => setup.kind === 'optimumSpeed')!
        .machines.every((row) => row.count === 1 && row.slots === 1 && row.accounts === 1),
    ).toBe(true)
    expect(golden().marginals.find((row) => row.kind === 'current')!.status).toBe('unknown')
    expect(
      golden()
        .marginals.filter((row) => row.kind === 'optimumSpeed')
        .every(
          (row) =>
            row.p50Hours === row.p90Hours &&
            row.status === 'known' &&
            row.predecessor !== undefined,
        ),
    ).toBe(true)
  })
  it('finds the fastest qualifying expansion even when a greedy first choice is a dead end', () => {
    const { inputs, pool } = recommendationFixture()
    inputs.lanes = [scheduleLane('A', { estimatedHours: 100 })]
    const hours = new Map([
      ['', 100],
      ['rental-0', 40],
      ['rental-1', 50],
      ['rental-2', 95],
      ['rental-0,rental-1', 39],
      ['rental-0,rental-2', 38],
      ['rental-1,rental-2', 30],
      ['rental-0,rental-1,rental-2', 29],
    ])
    const result = recommendEstimate(inputs, pool, {
      forecast: (input) => {
        if (input.fleet.slots.length === 0)
          return { status: 'infeasible', reason: 'fixture-no-slots' }
        const ids = input.fleet.machines
          .filter((machine) => machine.source === 'rented')
          .map((machine) => machine.id)
          .join(',')
        return {
          status: 'feasible',
          simulation: simulateEstimate(input, {
            model: () => ({ kind: 'fixed', hours: amount(hours.get(ids)!) }),
          }),
        }
      },
    })
    expect(fleetForKind(result, 'optimumSpeed').machines).toHaveLength(4)
    expect(result.setups.find((setup) => setup.kind === 'optimumSpeed')!.p90).toBe(
      '2026-10-07T17:00:00.000Z',
    )
  })
  it('stops speed expansion below the marginal floor even when another server exists', () => {
    expect(fleetForKind(fixture.belowFloor!, 'optimumSpeed').machines).toHaveLength(3)
  })
  it('rejects positive speed gains below four hours, including coupled expansions', () => {
    const { inputs, pool } = recommendationFixture()
    inputs.lanes = Array.from({ length: 4 }, (_, index) =>
      scheduleLane(`L${String(index)}`, { estimatedHours: 3 }),
    )
    expect(
      fleetForKind(recommendEstimate(inputs, pool, forecastPort), 'optimumSpeed').machines,
    ).toHaveLength(2)
  })
  it('keeps the critical path unchanged when machines are added', () => {
    const { inputs, pool } = recommendationFixture(1)
    inputs.lanes = [
      scheduleLane('A', { estimatedHours: 12 }),
      scheduleLane('B', { estimatedHours: 12, dependencies: ['A'] }),
    ]
    const result = recommendEstimate(inputs, pool, forecastPort)
    expect(fleetForKind(result, 'optimumSpeed').machines).toHaveLength(1)
    expect(
      result.marginals.filter((row) => row.status === 'known').every((row) => row.p90Hours === 0),
    ).toBe(true)
  })
  it('uses distinct account constraints rather than treating new machines as new accounts', () => {
    const { inputs, pool } = recommendationFixture(2)
    inputs.lanes = [scheduleLane('A'), scheduleLane('B')]
    for (const lane of inputs.lanes) lane.resources.accountRequestsPerHour = amount(60)
    inputs.fleet.accounts[0]!.requestsPerMinute = 1
    pool.accounts[0]!.requestsPerMinute = 1
    pool.accounts.push({ ...pool.accounts[0]!, id: 'account-extra' })
    pool.slots.find((slot) => slot.machineId === 'rental-1')!.accountId = 'account-extra'
    inputs.request.deadline = '2026-10-06T13:00:00.000Z'
    const result = recommendEstimate(inputs, pool, forecastPort)
    expect(fleetForKind(result, 'minimumP90').accounts).toHaveLength(2)
  })
  it('searches compatible Windows, macOS, architectures and GPU classes without inventing capacity', () => {
    const { inputs, pool } = recommendationFixture(1)
    const rental = pool.machines.find((machine) => machine.source === 'rented')!
    for (const size of machineClasses) {
      if (size.id === 'linux-x64-small') continue
      Object.assign(rental, {
        classId: size.id,
        os: size.os,
        architecture: size.architecture,
        cores: size.vcpu,
        ramGiB: size.ramGiB,
      })
      if ('gpu' in size) rental.gpu = size.gpu
      else delete rental.gpu
      inputs.lanes = [
        scheduleLane('A', {
          affinity: {
            os: [size.os],
            architectures: [size.architecture],
            machineClassIds: [size.id],
            gpuRequired: 'gpu' in size,
          },
        }),
      ]
      const result = recommendEstimate(inputs, pool, forecastPort)
      expect(fleetForKind(result, 'minimumP90').machines[0]!.classId).toBe(size.id)
      expect(
        result.setups.find((entry) => entry.kind === 'minimumP90')!.machines[0]!.price,
      ).toBeUndefined()
    }
  })
  it('never assigns a missing public price zero cost and optimizes total P90 rental cost', () => {
    const { inputs, pool, prices } = recommendationFixture(2)
    inputs.lanes = [
      scheduleLane('A', {
        affinity: {
          os: [],
          architectures: [],
          machineClassIds: ['linux-x64-small'],
          gpuRequired: false,
        },
      }),
    ]
    const small = machineClasses.find((size) => size.id === 'linux-x64-small')!
    for (const machine of pool.machines) {
      if (machine.source !== 'rented') continue
      Object.assign(machine, { classId: small.id, cores: small.vcpu, ramGiB: small.ramGiB })
    }
    const missing = recommendEstimate(inputs, pool, forecastPort)
    expect(missing.unavailable).toContain('optimumCost')
    const result = recommendEstimate(inputs, pool, forecastPort, [prices[0]!])
    expect(fleetForKind(result, 'optimumCost').machines[0]!.id).toBe(prices[0]!.machineId)
    prices[0]!.price = catalogPrice(10)
    prices[1]!.price = catalogPrice(0.01)
    const priced = recommendEstimate(inputs, pool, forecastPort, prices)
    expect(fleetForKind(priced, 'optimumCost').machines[0]!.id).toBe('rental-1')
    expect(
      priced.setups.find((setup) => setup.kind === 'optimumCost')!.machines[0]!.price!.catalogDate,
    ).toBe('2026-10-06')
  })
  it.each([
    {
      name: 'exact decimal cost tie by finish time',
      rates: [0.9, 0.3],
      hours: [1, 3],
      selected: 'rental-0',
      displayed: [0.9, 0.9],
    },
    {
      name: 'sub-nano costs before display rounding',
      rates: [2e-9, 5e-10],
      hours: [0.1, 0.2],
      selected: 'rental-1',
      displayed: [1e-9, 1e-9],
    },
  ])('$name', ({ rates, hours, selected, displayed }) => {
    const { inputs, pool, prices } = rentalOnlyFixture()
    inputs.lanes = [
      scheduleLane('A', {
        affinity: {
          os: [],
          architectures: [],
          machineClassIds: ['linux-x64-builder'],
          gpuRequired: false,
        },
      }),
    ]
    prices[0]!.price = { ...catalogPrice(rates[0]), providerId: 'fast' }
    prices[1]!.price = { ...catalogPrice(rates[1]), providerId: 'slow' }
    for (const [index, row] of prices.entries()) {
      const account = {
        ...pool.accounts[0]!,
        id: row.price.providerId,
        providerId: row.price.providerId,
      }
      pool.accounts.push(account)
      pool.slots.find((slot) => slot.machineId === `rental-${String(index)}`)!.accountId =
        account.id
    }
    const result = recommendEstimate(
      inputs,
      pool,
      {
        forecast: (input) => {
          if (input.fleet.machines.every((machine) => machine.source !== 'rented'))
            return { status: 'infeasible', reason: 'fixture-no-compatible-builder' }
          return {
            status: 'feasible',
            simulation: simulateEstimate(input, {
              model: () => ({
                kind: 'fixed',
                hours: amount(
                  input.fleet.machines.some((machine) => machine.id === 'rental-0')
                    ? hours[0]!
                    : hours[1]!,
                ),
              }),
            }),
          }
        },
      },
      prices,
    )
    expect(fleetForKind(result, 'optimumCost').machines.map((machine) => machine.id)).toEqual([
      selected,
    ])
    const singles = result.evaluations.filter(
      (entry) => entry.fleet.machines.length === 1 && entry.forecast.status === 'feasible',
    )
    expect(singles.map((entry) => entry.rentalCostP90Usd)).toEqual(displayed)
  })
  it.each([undefined, catalogPrice(0.9)])(
    'gives an existing rented machine zero incremental cost with price %j',
    (price) => {
      const { inputs, pool } = recommendationFixture(0)
      inputs.fleet.machines[0]!.source = 'rented'
      pool.machines[0]!.source = 'rented'
      inputs.lanes = [scheduleLane('A')]
      const prices = price ? [{ machineId: inputs.fleet.machines[0]!.id, price }] : []
      const result = recommendEstimate(inputs, pool, forecastPort, prices)
      expect(result.unavailable).toEqual([])
      expect(fleetForKind(result, 'optimumCost').machines[0]!.id).toBe('linux')
      expect(
        result.evaluations
          .filter((entry) => entry.forecast.status === 'feasible')
          .map((entry) => entry.rentalCostP90Usd),
      ).toEqual([0])
    },
  )
  it('sums decimal hourly rentals exactly across machines', () => {
    const { inputs, pool, prices } = rentalOnlyFixture()
    inputs.lanes = [
      scheduleLane('A', { estimatedHours: 3 }),
      scheduleLane('B', { estimatedHours: 3 }),
    ]
    for (const lane of inputs.lanes) lane.affinity.machineClassIds = ['linux-x64-builder']
    inputs.request.deadline = '2026-10-06T15:00:00.000Z'
    prices[0]!.price = catalogPrice(0.1)
    prices[1]!.price = catalogPrice(0.2)
    const result = recommendEstimate(inputs, pool, forecastPort, prices)
    const selection = result.selections.find((entry) => entry.kind === 'optimumCost')!
    expect(fleetForKind(result, 'optimumCost').machines.map((machine) => machine.id)).toEqual([
      'rental-0',
      'rental-1',
    ])
    expect(result.evaluations[selection.evaluation]!.rentalCostP90Usd).toBe(0.9)
  })
  it('charges only new rentals when expanding an existing rented fleet', () => {
    const { inputs, pool, prices } = recommendationFixture(1)
    inputs.fleet.machines[0]!.source = 'rented'
    pool.machines[0]!.source = 'rented'
    const result = recommendEstimate(inputs, pool, forecastPort, prices)
    const selected = result.selections.find((entry) => entry.kind === 'optimumCost')!
    expect(fleetForKind(result, 'optimumCost').machines).toHaveLength(2)
    expect(result.evaluations[selected.evaluation]!.rentalCostP90Usd).toBe(0.48)
    expect(result.evaluations[0]!.rentalCostP90Usd).toBe(0)
  })
  it('omits deadline objectives without a deadline or when the deadline is impossible', () => {
    const { inputs, pool } = recommendationFixture(0)
    delete inputs.request.deadline
    expect(recommendEstimate(inputs, pool, forecastPort).unavailable).toEqual([
      'minimumP50',
      'minimumP90',
      'optimumCost',
    ])
    inputs.request.deadline = inputs.request.asOf
    expect(recommendEstimate(inputs, pool, forecastPort).unavailable).toEqual([
      'minimumP50',
      'minimumP90',
      'optimumCost',
    ])
  })
  it('drops idle machines and unused accounts from minimum setups without conflating current evidence', () => {
    const { inputs } = recommendationFixture(0)
    inputs.lanes = inputs.lanes.slice(0, 1)
    inputs.fleet.accounts.push({ ...inputs.fleet.accounts[0]!, id: 'unused-account' })
    inputs.fleet.machines.push({
      ...inputs.fleet.machines[0]!,
      id: 'idle',
      governorSlots: 0,
      caps: { ...inputs.fleet.machines[0]!.caps, slots: 0 },
      capacityByKind: [],
    })
    const result = recommendEstimate(inputs, structuredClone(inputs.fleet), forecastPort)
    expect(fleetForKind(result, 'current').machines).toHaveLength(2)
    expect(fleetForKind(result, 'minimumP50').machines).toHaveLength(1)
    expect(fleetForKind(result, 'minimumP90').accounts).toHaveLength(1)
    expect(fleetForKind(result, 'optimumSpeed').machines).toHaveLength(1)
    expect(result.evaluations).toHaveLength(3)
  })
  it('retains every existing slot while searching speed expansions', () => {
    const { inputs, pool } = recommendationFixture(2)
    inputs.lanes = inputs.lanes.slice(0, 1)
    const result = recommendEstimate(inputs, pool, {
      forecast: (input) => {
        if (input.fleet.slots.length === 0)
          return { status: 'infeasible', reason: 'fixture-no-slots' }
        const hours = input.fleet.machines.some((machine) => machine.id === 'linux')
          ? 100 - input.fleet.machines.length * 10
          : 1
        return {
          status: 'feasible',
          simulation: simulateEstimate(input, {
            model: () => ({ kind: 'fixed', hours: amount(hours) }),
          }),
        }
      },
    })
    expect(
      fleetForKind(result, 'optimumSpeed').slots.some(
        (slot) => slot.id === inputs.fleet.slots[0]!.id,
      ),
    ).toBe(true)
  })
  it.each([
    {
      name: 'expands existing-machine slots',
      lanes: 12,
      hours: 4,
      slots: 2,
      currentP90: '2026-10-08T12:00:00.000Z',
      speedP90: '2026-10-07T12:00:00.000Z',
    },
    {
      name: 'existing slots keep four-hour floor',
      lanes: 2,
      hours: 2,
      slots: 1,
      currentP90: '2026-10-06T16:00:00.000Z',
      speedP90: '2026-10-06T16:00:00.000Z',
    },
  ])('$name', ({ lanes, hours, slots, currentP90, speedP90 }) => {
    const { inputs } = recommendationFixture(0)
    inputs.lanes = Array.from({ length: lanes }, (_, index) =>
      scheduleLane(`L${String(index)}`, { estimatedHours: hours }),
    )
    const machine = inputs.fleet.machines[0]!
    machine.governorSlots = 2
    machine.caps.slots = 2
    machine.capacityByKind[0]!.slots = 2
    const pool = structuredClone(inputs.fleet)
    pool.slots.push({ ...pool.slots[0]!, id: 'existing-extra-slot' })
    const result = recommendEstimate(inputs, pool, forecastPort)
    const speed = fleetForKind(result, 'optimumSpeed')
    expect(speed.machines).toHaveLength(1)
    expect(speed.slots).toHaveLength(slots)
    expect(speed.slots).toEqual(
      (slots === 2 ? pool.slots : inputs.fleet.slots).toSorted((a, b) => a.id.localeCompare(b.id)),
    )
    expect(result.setups.find((setup) => setup.kind === 'current')!.p90).toBe(currentP90)
    expect(result.setups.find((setup) => setup.kind === 'optimumSpeed')!.p90).toBe(speedP90)
    for (const limit of ['governorSlots', 'caps'] as const) {
      const capped = structuredClone(pool)
      if (limit === 'governorSlots') {
        capped.machines[0]!.governorSlots = 1
        capped.machines[0]!.capacityByKind[0]!.slots = 1
      } else capped.machines[0]!.caps.slots = 1
      const forecast = vi.fn(forecastPort.forecast)
      expect(() => recommendEstimate(inputs, capped, { forecast })).toThrow()
      expect(forecast).not.toHaveBeenCalled()
    }
  })
  it('allows an empty setup for completed work and omits truly infeasible forecasts', () => {
    const { inputs, pool } = recommendationFixture(0)
    inputs.lanes[0]!.state = 'merged'
    inputs.lanes = [inputs.lanes[0]!]
    const done = recommendEstimate(inputs, pool, forecastPort)
    expect(fleetForKind(done, 'minimumP90').machines).toHaveLength(0)
    const refused = recommendEstimate(inputs, pool, {
      forecast: () => ({ status: 'infeasible', reason: 'fixture-unavailable' }),
    })
    expect(refused.setups).toEqual([])
    expect(refused.unavailable).toHaveLength(5)
  })
  it('bounds combinatorial work before forecasting and validates every projection', () => {
    const { inputs, pool, prices } = recommendationFixture(9)
    const forecast = vi.fn<EstimateRecommendationPort['forecast']>(() => ({
      status: 'infeasible',
      reason: 'fixture-bounded',
    }))
    expect(() => recommendEstimate(inputs, pool, { forecast })).toThrow(
      'recommendation-search-limit',
    )
    expect(forecast).not.toHaveBeenCalled()
    const small = recommendationFixture(0)
    const bad = structuredClone(small.pool)
    bad.asOf = '2026-10-05T12:00:00.000Z'
    expect(() => recommendEstimate(small.inputs, bad, forecastPort)).toThrow('pool-as-of')
    bad.asOf = small.inputs.request.asOf
    bad.machines[0]!.caps.slots = 0
    expect(() => recommendEstimate(small.inputs, bad, forecastPort)).toThrow()
    pool.machines[1]!.cores = 1
    expect(() => recommendEstimate(inputs, pool, forecastPort, prices)).toThrow(
      'rental-class-mismatch',
    )
  })
  it('rejects every mismatched rented class dimension without forecasting guessed capacities', () => {
    const { inputs, pool } = recommendationFixture(1)
    const forecast: EstimateRecommendationPort = {
      forecast: () => ({ status: 'infeasible', reason: 'fixture-refusal' }),
    }
    const mismatches = [
      { classId: 'unknown' },
      { os: 'windows' },
      { architecture: 'arm64' },
      { cores: 1 },
      { ramGiB: 1 },
      { gpu: { count: 1, memoryGiB: 1 } },
    ]
    for (const mismatch of mismatches) {
      const changed = structuredClone(pool)
      Object.assign(changed.machines[1]!, mismatch)
      expect(() => recommendEstimate(inputs, changed, forecast)).toThrow('rental-class-mismatch')
    }
    const privatePrices = [{ machineId: pool.machines[1]!.id, price: catalogPrice() }]
    Reflect.set(privatePrices[0]!.price, 'publicCatalog', false)
    expect(() => recommendEstimate(inputs, pool, forecast, privatePrices)).toThrow()
    privatePrices[0]!.price.publicCatalog = true
    privatePrices[0]!.price.catalogUrl = 'invalid'
    expect(() => recommendEstimate(inputs, pool, forecast, privatePrices)).toThrow()
  })
  it('refuses changed shared limits, duplicate and unsafe price evidence, and broken quantiles', () => {
    const { inputs, pool, prices } = recommendationFixture(1)
    const changed = structuredClone(pool)
    changed.accounts[0]!.requestsPerMinute = 0
    expect(() => recommendEstimate(inputs, changed, forecastPort)).toThrow(
      'pool-changes-existing-resources',
    )
    changed.accounts = structuredClone(pool.accounts)
    changed.ci.push({ ...changed.ci[0]!, id: 'ci-added' })
    expect(() => recommendEstimate(inputs, changed, forecastPort)).toThrow(
      'pool-changes-shared-resources',
    )
    expect(() => recommendEstimate(inputs, pool, forecastPort, [...prices, ...prices])).toThrow(
      'duplicate-price',
    )
    expect(() =>
      recommendEstimate(inputs, pool, forecastPort, [
        { machineId: 'missing', price: catalogPrice() },
      ]),
    ).toThrow('price-machine')
    for (const price of [
      { ...catalogPrice(), catalogDate: '2026-10-07' },
      { ...catalogPrice(), catalogUrl: 'https://user@catalog.invalid/' },
    ])
      expect(() =>
        recommendEstimate(inputs, pool, forecastPort, [{ machineId: prices[0]!.machineId, price }]),
      ).toThrow('price-provenance')
    expect(() =>
      recommendEstimate(inputs, pool, forecastPort, [
        { machineId: prices[0]!.machineId, price: catalogPrice(Number.MAX_VALUE) },
      ]),
    ).toThrow('cost-overflow')
    const simulation = simulateEstimate(inputs, fixedDurationPort)
    for (const broken of [
      { ...simulation, p50Hours: -1, p50: '2026-10-06T11:00:00.000Z' },
      { ...simulation, p50Hours: NaN },
    ])
      expect(() =>
        recommendEstimate(inputs, pool, {
          forecast: () => ({ status: 'feasible', simulation: broken }),
        }),
      ).toThrow()
    expect(() =>
      recommendEstimate(inputs, pool, {
        forecast: () => ({ status: 'feasible', simulation: { ...simulation, p90Hours: 0 } }),
      }),
    ).toThrow('forecast-quantiles')
    expect(() =>
      recommendEstimate(inputs, pool, { forecast: () => ({ status: 'infeasible', reason: '' }) }),
    ).toThrow('missing-infeasibility-reason')
    expect(() =>
      recommendEstimate(inputs, pool, {
        forecast: () => {
          throw new Error('calibration-unavailable')
        },
      }),
    ).toThrow('calibration-unavailable')
  })
  it('parses inputs and candidate fleets before invoking an infeasible evaluator', () => {
    const { inputs, pool } = recommendationFixture(0)
    const forecast = vi.fn<EstimateRecommendationPort['forecast']>(() => ({
      status: 'infeasible',
      reason: 'fixture-refusal',
    }))
    const duplicate = structuredClone(inputs)
    duplicate.lanes.push(structuredClone(duplicate.lanes[0]!))
    expect(() => recommendEstimate(duplicate, pool, { forecast })).toThrow()
    const duplicateFleet = structuredClone(pool)
    duplicateFleet.machines.push(structuredClone(duplicateFleet.machines[0]!))
    expect(() => recommendEstimate(inputs, duplicateFleet, { forecast })).toThrow()
    expect(forecast).not.toHaveBeenCalled()
  })
  it('preserves input bytes against an evaluator mutation and input ordering', () => {
    const { inputs, pool, prices } = recommendationFixture(0)
    const before = JSON.stringify({ inputs, pool, prices })
    const isolated = recommendEstimate(
      inputs,
      pool,
      {
        forecast: (input) => {
          const result = forecastPort.forecast(input)
          input.fleet.slots.length = 0
          input.lanes.length = 0
          return result
        },
      },
      prices,
    )
    expect(JSON.stringify({ inputs, pool, prices })).toBe(before)
    expect(isolated).toEqual(recommendEstimate(inputs, pool, forecastPort, prices))
    expect(fixtureRecommendation(true)).toEqual(golden())
  })
  it('is byte-identical across processes, time zones and languages', () => {
    const bundle = buildSync({
      stdin: {
        contents:
          "import { recommendationFixture, forecastPort } from './test/unit/helpers/estimatorRecommendFixtures'; import { recommendEstimate } from './src/core/estimator/recommend'; const { inputs,pool,prices } = recommendationFixture(1); inputs.lanes = inputs.lanes.slice(0,1); process.stdout.write(JSON.stringify(recommendEstimate(inputs,pool,forecastPort,prices)))",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    }).outputFiles[0]!.text
    const outputs = [
      { TZ: 'UTC', LANG: 'en_US.UTF-8' },
      { TZ: 'America/Los_Angeles', LANG: 'ja_JP.UTF-8' },
    ].map((locale) => {
      const child = spawnSync(process.execPath, ['-'], {
        input: bundle,
        env: { ...process.env, ...locale },
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      })
      expect(child.status).toBe(0)
      return child.stdout
    })
    const { inputs, pool, prices } = recommendationFixture(1)
    inputs.lanes = inputs.lanes.slice(0, 1)
    expect(outputs[0]).toBe(JSON.stringify(recommendEstimate(inputs, pool, forecastPort, prices)))
    expect(outputs[1]).toBe(outputs[0])
  })
})
