import { beforeAll, describe, expect, it } from 'vitest'
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  estimateRandom,
  simulateEstimate,
  estimateDurationMap,
  type EstimateDurationModel,
} from '../../src/core/estimator/simulate'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { estimateLaneSchema } from '../../src/shared/estimate'
import {
  ESTIMATE_RUNS,
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_LOCAL_BUDGET_LANES,
  ESTIMATE_LOCAL_BUDGET_MS,
} from '../../src/shared/constants'
import dags from '../fixtures/estimator/dags.json'
import { fakeFleet } from './helpers/estimator/fakes'
import {
  amount,
  scheduleFleet,
  scheduleLane,
  simulationInputs,
  fixedDurationPort,
  lognormalPort,
  deterministicSimulationInputs,
} from './helpers/estimatorScheduleFixtures'

function runWithModel(model: EstimateDurationModel) {
  return simulateEstimate(simulationInputs(), { model: () => model })
}

describe('M117 seeded duration simulation', () => {
  it.each(dags)('matches the $name fixed-duration P50 and P90 date goldens', (fixture) => {
    const fleet = fixture.name === 'affinity-bound' ? fakeFleet() : scheduleFleet()
    const result = simulateEstimate(
      simulationInputs(
        fixture.lanes.map((lane) => estimateLaneSchema.parse(lane)),
        fleet,
      ),
      fixedDurationPort,
    )
    expect(result.p50).toBe(fixture.golden.p50)
    expect(result.p90).toBe(fixture.golden.p90)
    expect(result.runs).toBe(ESTIMATE_RUNS)
    expect(result.schedule.map(({ laneId, start, end }) => ({ laneId, start, end }))).toEqual(
      fixture.golden.schedule,
    )
  })

  it('pins the PRNG stream and keeps every draw strictly inside zero and one', () => {
    const random = estimateRandom('golden-schedule')
    const first = Array.from({ length: 5 }, () => random())
    expect(first).toEqual([
      0.10627112362999469, 0.7245785136474296, 0.7555197417968884, 0.17367309622932225,
      0.26598480495158583,
    ])
    const second = estimateRandom('golden-schedule')
    expect(Array.from({ length: 5 }, () => second())).toEqual(first)
    const samples = Array.from({ length: 10_000 }, () => random())
    expect(Math.min(...samples)).toBeGreaterThan(0)
    expect(Math.max(...samples)).toBeLessThan(1)
  })

  it('pins seeded lognormal quantiles, representative trial and review overhead', () => {
    const result = simulateEstimate(deterministicSimulationInputs(), lognormalPort)
    // Seeded algorithm golden; the parameters are explicit test assumptions.
    expect({ p50: result.p50, p90: result.p90 }).toEqual({
      p50: '2026-10-06T14:14:49.913Z',
      p90: '2026-10-06T15:30:45.942Z',
    })
    expect(result.p90Hours).toBeGreaterThan(result.p50Hours)
    expect(result.durationSamples).toHaveLength(2)
    expect(Math.max(...result.schedule.map((entry) => Date.parse(entry.end)))).toBe(
      Date.parse(result.p50),
    )
    const withoutReview = simulateEstimate(deterministicSimulationInputs(), {
      model: (lane, classId) => {
        const model = lognormalPort.model(lane, classId)
        if (model.kind === 'lognormal') model.reviewHours = amount(0)
        return model
      },
    })
    expect(result.p50Hours).toBeGreaterThan(withoutReview.p50Hours)
  })

  it('keeps model-class durations, remaining floors and completed work distinct', () => {
    const inputs = simulationInputs(
      [
        scheduleLane('A', {
          state: 'running',
          estimatedHours: 8,
          elapsedAgentHours: 10,
          minimumRemainingHours: 0.5,
        }),
        scheduleLane('done', { state: 'merged' }),
      ],
      fakeFleet(),
    )
    const result = simulateEstimate(inputs, lognormalPort)
    expect(
      result.durationSamples
        .filter((sample) => sample.laneId === 'A')
        .every((sample) => sample.hours >= 0.5),
    ).toBe(true)
    expect(result.schedule.every((entry) => entry.laneId !== 'done')).toBe(true)
    const varied = simulateEstimate(simulationInputs([scheduleLane('A')], fakeFleet()), {
      model: (_lane, classId) => ({
        kind: 'fixed',
        hours: amount(classId === 'macos-arm64-builder' ? 0.5 : 2),
      }),
    })
    expect(varied.schedule[0]!.machineId).toBe('mac')
    expect(varied.p50Hours).toBe(0.5)
  })

  it('counts review rounds once per lane and redesigns once per module at the third strike', () => {
    const lane = scheduleLane('A', {
      review: {
        status: 'known',
        rounds: 2,
        modules: [
          {
            familyId: 'module',
            strikes: 2,
            classes: [
              { class: 'docs', strikes: 2 },
              { class: 'testsGates', strikes: 2 },
            ],
          },
        ],
        redesigns: [],
      },
    })
    const port = {
      model: (lane: (typeof inputs.lanes)[number], classId: string): EstimateDurationModel => {
        const model = lognormalPort.model(lane, classId)
        if (model.kind === 'lognormal') {
          model.calibration.reviewRoundRate = 0.9
          model.calibration.redesignRisk = 1
        }
        return model
      },
    }
    const inputs = simulationInputs([lane])
    const result = simulateEstimate(inputs, port)
    expect(result.durationSamples[0]!.reviewRounds).toBeGreaterThan(0)
    expect(result.durationSamples[0]!.redesigns).toBe(1)
    lane.review = {
      status: 'known',
      rounds: 2,
      modules: [{ familyId: 'module', strikes: 0, classes: [] }],
      redesigns: [],
    }
    const noRounds = simulateEstimate(simulationInputs([lane]), {
      model: (lane, classId) => {
        const model = port.model(lane, classId)
        if (model.kind === 'lognormal') model.calibration.reviewRoundRate = 0
        return model
      },
    })
    expect(noRounds.durationSamples[0]!.redesigns).toBe(0)
  })

  it('retains unknown review history and refuses unavailable duration evidence', () => {
    const result = simulateEstimate(
      simulationInputs([scheduleLane('A', { review: { status: 'unknown' } })]),
      fixedDurationPort,
    )
    expect(result.unknownLimits).toContain('A:review')
    expect(() =>
      simulateEstimate(
        simulationInputs([scheduleLane('A', { review: { status: 'unknown' } })]),
        lognormalPort,
      ),
    ).toThrow('unknown-review-modules')
    expect(() =>
      runWithModel({
        kind: 'fixed',
        hours: {
          status: 'unknown',
          value: null,
          basis: 'unknown',
          samples: 0,
          uncertainty: { kind: 'unknown' },
        },
      }),
    ).toThrow('unknown-duration-model')
    expect(() => runWithModel({ kind: 'fixed', hours: amount(NaN) })).toThrow(
      'invalid-duration-model',
    )
    expect(() =>
      runWithModel({ kind: 'fixed', hours: { ...amount(1), basis: 'history' } }),
    ).toThrow('invalid-model-evidence')
    expect(() =>
      runWithModel({
        kind: 'fixed',
        hours: { ...amount(1), uncertainty: { kind: 'interval', lower: 2, upper: 3 } },
      }),
    ).toThrow('invalid-model-evidence')
  })

  it('rejects fractional evidence sample counts at the model boundary', () => {
    expect(() =>
      runWithModel({ kind: 'fixed', hours: { ...amount(1), basis: 'history', samples: 0.5 } }),
    ).toThrow('invalid-model-evidence')
  })

  it('validates distribution identity, calibration threshold, rates and overflow', () => {
    const base = lognormalPort.model(scheduleLane('A'), 'linux-x64-builder')
    if (base.kind !== 'lognormal') throw new Error('fixture')
    for (const calibration of [
      { ...base.calibration, kind: 'other' },
      { ...base.calibration, machineClassId: 'other' },
      { ...base.calibration, samples: 20 },
      { ...base.calibration, sigma: 0 },
      { ...base.calibration, mu: Infinity },
      { ...base.calibration, reviewRoundRate: 1 },
      { ...base.calibration, redesignRisk: 2 },
    ])
      expect(() => runWithModel({ ...base, calibration })).toThrow()
    expect(() =>
      runWithModel({ ...base, calibration: { ...base.calibration, mu: Number.MAX_VALUE } }),
    ).toThrow('duration-model-overflow')
    expect(() =>
      runWithModel({
        ...base,
        calibration: { ...base.calibration, reviewRoundRate: 1 - Number.EPSILON },
      }),
    ).toThrow('review-horizon')
    expect(() =>
      runWithModel({ ...base, calibration: { ...base.calibration, reviewRoundRate: 1 } }),
    ).toThrow('invalid-distribution')
    const extra = { ...base.calibration, unexpected: 1 }
    expect(() => runWithModel({ ...base, calibration: extra })).toThrow('invalid-distribution')
    const inputs = simulationInputs()
    inputs.fleet.asOf = '2026-10-07T12:00:00.000Z'
    expect(() => simulateEstimate(inputs, fixedDurationPort)).toThrow()
  })

  it('bounds model cartesian work before calling calibration', () => {
    const fleet = scheduleFleet(1)
    const machine = fleet.machines[0]!,
      slot = fleet.slots[0]!
    const count = Math.floor(ESTIMATE_MAX_ITEMS / 3) + 1
    fleet.machines = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(machine),
      id: `machine-${String(index)}`,
      classId: `class-${String(index)}`,
    }))
    fleet.slots = fleet.machines.map((machine, index) => ({
      ...slot,
      id: `slot-${String(index)}`,
      machineId: machine.id,
    }))
    const port = {
      model: (): EstimateDurationModel => {
        throw new Error('calibration called before admission')
      },
    }
    expect(() =>
      simulateEstimate(
        simulationInputs([scheduleLane('A'), scheduleLane('B'), scheduleLane('C')], fleet),
        port,
      ),
    ).toThrow('model-limit')
  })

  it('does not request duration models for an empty or already completed goal', () => {
    const port = {
      model: (): EstimateDurationModel => {
        throw new Error('must not request completed models')
      },
    }
    for (const lanes of [[], [scheduleLane('done', { state: 'merged' })]]) {
      const inputs = simulationInputs(lanes)
      const result = simulateEstimate(inputs, port)
      expect(result.p50).toBe(inputs.request.asOf)
      expect(result.p90).toBe(inputs.request.asOf)
      expect(result.models).toEqual([])
    }
  })

  it('canonicalizes input sets and includes model evidence in the automatic seed', () => {
    const inputs = deterministicSimulationInputs()
    delete inputs.request.seed
    const before = JSON.stringify(inputs)
    const result = simulateEstimate(inputs, lognormalPort)
    const shuffled = structuredClone(inputs)
    shuffled.lanes.reverse()
    shuffled.fleet.slots.reverse()
    shuffled.fleet.accounts[0]!.usageLimits!.reverse()
    expect(simulateEstimate(shuffled, lognormalPort)).toEqual(result)
    expect(result.seed).toMatch(/^[\da-f]{64}$/)
    expect(JSON.stringify(inputs)).toBe(before)
    const different = simulateEstimate(inputs, {
      model: (lane, classId) => {
        const model = lognormalPort.model(lane, classId)
        if (model.kind === 'lognormal') model.calibration.sigma = 0.3
        return model
      },
    })
    expect(different.seed).not.toBe(result.seed)
    const explicit = structuredClone(inputs)
    explicit.request.seed = 'other'
    expect(simulateEstimate(explicit, lognormalPort).p50).not.toBe(result.p50)
  })

  // A complete 2,000-trial benchmark plus paired comparisons must report its
  // measured two-second violation even during the intentionally slower red drill.
  const BENCHMARK_TIMEOUT_MS = 15_000
  it.each(['chain', 'independent', 'fan-out'])(
    'estimates forty %s lanes with all 2000 runs and bottleneck inside the local budget',
    (shape) => {
      const lanes = Array.from({ length: ESTIMATE_LOCAL_BUDGET_LANES }, (_, index) =>
        scheduleLane(`L${String(index)}`, {
          dependencies:
            index === 0 || shape === 'independent'
              ? []
              : [shape === 'chain' ? `L${String(index - 1)}` : 'L0'],
        }),
      )
      const inputs = simulationInputs(lanes)
      const start = performance.now()
      const result = simulateEstimate(inputs, lognormalPort)
      const bottleneck = findEstimateBottleneck(
        lanes,
        inputs.fleet,
        estimateDurationMap(result.durationSamples),
      )
      const elapsed = performance.now() - start
      expect(result.runs).toBe(ESTIMATE_RUNS)
      expect(bottleneck.kind).toBe(shape === 'chain' ? 'criticalPath' : 'machines')
      expect(elapsed, `${shape}: ${elapsed.toFixed(1)} ms`).toBeLessThan(ESTIMATE_LOCAL_BUDGET_MS)
    },
    BENCHMARK_TIMEOUT_MS,
  )
})

describe('M117 process determinism', () => {
  let code: string
  beforeAll(() => {
    code = buildSync({
      stdin: {
        contents: `import {simulateEstimate} from '../../src/core/estimator/simulate';import {deterministicSimulationInputs,lognormalPort} from './helpers/estimatorScheduleFixtures';process.stdout.write(JSON.stringify(simulateEstimate(deterministicSimulationInputs(),lognormalPort)));`,
        resolveDir: path.resolve(import.meta.dirname),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    }).outputFiles[0]!.text
  })
  it('produces byte-identical outputs twice and in children with different TZ and LANG', () => {
    const expected = JSON.stringify(
      simulateEstimate(deterministicSimulationInputs(), lognormalPort),
    )
    expect(JSON.stringify(simulateEstimate(deterministicSimulationInputs(), lognormalPort))).toBe(
      expected,
    )
    const contexts = [
      { TZ: 'Asia/Kolkata', LANG: 'tr_TR.UTF-8' },
      { TZ: 'Etc/GMT+12', LANG: 'de_DE.UTF-8' },
    ]
    const results = contexts.map((env) =>
      spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' }),
    )
    expect(results.map(({ status, stdout, stderr }) => ({ status, stdout, stderr }))).toEqual(
      contexts.map(() => ({ status: 0, stdout: expected, stderr: '' })),
    )
  })
})
