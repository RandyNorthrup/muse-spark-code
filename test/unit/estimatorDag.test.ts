import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { buildEstimateDag } from '../../src/core/estimator/dag'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { estimateLaneSchema, parseEstimateGoal } from '../../src/shared/estimate'
import {
  ESTIMATE_LOCAL_BUDGET_LANES,
  ESTIMATE_LOCAL_BUDGET_MS,
  ESTIMATE_MAX_ITEMS,
} from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import dags from '../fixtures/estimator/dags.json'
import repository from '../fixtures/estimator/repository-history.json'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'
import { goalLane, goalSnapshot } from './helpers/estimatorGoalFixtures'

async function deterministicRun(): Promise<string> {
  const snapshot = goalSnapshot()
  const lanes = await resolveEstimateGoal(parseEstimateGoal('release:0.16.0')!, snapshot.asOf, {
    snapshot: vi.fn().mockResolvedValue(snapshot),
  })
  return JSON.stringify({ lanes, dag: buildEstimateDag(lanes) })
}

describe('M117 dependency DAG', () => {
  it.each(dags)(
    'matches the $name fixture critical path and forward/backward timing',
    (fixture) => {
      const lanes = fixture.lanes.map((lane) => estimateLaneSchema.parse(lane))
      const dag = buildEstimateDag(lanes)
      expect(dag.criticalPath).toEqual(fixture.golden.criticalPath)
      expect(dag.criticalPathHours).toBe(fixture.golden.criticalPathHours)
      for (const node of dag.nodes) {
        const entry = fixture.golden.schedule.find((entry) => entry.laneId === node.laneId)!
        // Affinity fixtures' resource schedule is longer than the dependency DAG.
        if (fixture.name !== 'affinity-bound') {
          expect(node.earliestStartHours).toBe(
            (Date.parse(entry.start) - Date.parse(ESTIMATOR_AS_OF)) / 3_600_000,
          )
          expect(node.earliestFinishHours).toBe(
            (Date.parse(entry.end) - Date.parse(ESTIMATOR_AS_OF)) / 3_600_000,
          )
        }
        expect(node.latestFinishHours - node.latestStartHours).toBe(node.durationHours)
        expect(node.slackHours).toBe(node.latestStartHours - node.earliestStartHours)
        expect(node.slackHours).toBeGreaterThanOrEqual(0)
        const lane = lanes.find((lane) => lane.id === node.laneId)!
        for (const dependency of lane.dependencies) {
          const parent = dag.nodes.find((node) => node.laneId === dependency)!
          expect(dag.topologicalOrder.indexOf(dependency)).toBeLessThan(
            dag.topologicalOrder.indexOf(lane.id),
          )
          expect(node.earliestStartHours).toBeGreaterThanOrEqual(parent.earliestFinishHours)
          expect(parent.latestFinishHours).toBeLessThanOrEqual(node.latestStartHours)
        }
      }
    },
  )

  it('gives the diamond noncritical branch one hour of slack and downstream priority', () => {
    const diamond = dags.find((fixture) => fixture.name === 'diamond')!
    const dag = buildEstimateDag(diamond.lanes.map((lane) => estimateLaneSchema.parse(lane)))
    expect(
      dag.nodes.map((node) => [node.laneId, node.slackHours, node.tailHours, node.critical]),
    ).toEqual([
      ['A', 0, 4, true],
      ['B', 0, 3, true],
      ['C', 1, 2, false],
      ['D', 0, 1, true],
    ])
  })

  it('marks both equal longest paths critical and picks a stable representative by lane ID', () => {
    const lanes = [
      goalLane('A'),
      goalLane('B', { dependencies: ['A'] }),
      goalLane('C', { dependencies: ['A'] }),
      goalLane('D', { dependencies: ['C', 'B'] }),
      goalLane('a', { estimatedHours: 3 }),
    ]
    const expected = buildEstimateDag(lanes)
    expect(expected.criticalPath).toEqual(['A', 'B', 'D'])
    expect(expected.topologicalOrder).toEqual(['A', 'B', 'C', 'D', 'a'])
    expect(expected.nodes.every((node) => node.critical)).toBe(true)
    expect(buildEstimateDag(lanes.toReversed())).toEqual(expected)
    expect(
      buildEstimateDag(
        lanes.map((lane) => ({ ...lane, dependencies: lane.dependencies.toReversed() })),
      ),
    ).toEqual(expected)
  })

  it('computes slack against the goal finish across disconnected components', () => {
    const dag = buildEstimateDag([goalLane('short'), goalLane('long', { estimatedHours: 4 })])
    expect(dag.criticalPath).toEqual(['long'])
    expect(dag.nodes.find((node) => node.laneId === 'short')).toMatchObject({
      earliestStartHours: 0,
      earliestFinishHours: 1,
      latestStartHours: 3,
      latestFinishHours: 4,
      slackHours: 3,
      critical: false,
    })
  })

  it('does not let slot, account or CI capacity shorten a dependency critical path', () => {
    const lanes = dags[0]!.lanes.map((lane) => estimateLaneSchema.parse(lane))
    const before = buildEstimateDag(lanes)
    for (const lane of lanes) {
      lane.resources.slots = {
        status: 'known',
        value: 100,
        basis: 'assumption',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      }
      lane.resources.ciJobs = {
        status: 'known',
        value: 100,
        basis: 'assumption',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      }
      lane.resources.accountRequestsPerHour = {
        status: 'unknown',
        value: null,
        basis: 'unknown',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      }
    }
    expect(buildEstimateDag(lanes)).toEqual(before)
    expect(before.criticalPathHours).toBe(4)
  })

  it('uses remaining hours, excludes completed work and retains the running minimum', () => {
    const dag = buildEstimateDag([
      goalLane('A', { state: 'merged', estimatedHours: 100 }),
      goalLane('B', {
        state: 'running',
        estimatedHours: 8,
        elapsedAgentHours: 10,
        minimumRemainingHours: 0.5,
        dependencies: ['A'],
      }),
      goalLane('C', { dependencies: ['B'] }),
    ])
    expect(dag.criticalPath).toEqual(['B', 'C'])
    expect(dag.criticalPathHours).toBe(1.5)
    expect(dag.nodes[0]).toMatchObject({ durationHours: 0, critical: false })
  })

  it('honors an exact sampled remaining-duration map for scheduling simulations without mutation', () => {
    const lanes = [goalLane('A'), goalLane('B', { dependencies: ['A'] })]
    const durations = new Map([
      ['A', 4],
      ['B', 2],
    ])
    const before = JSON.stringify(lanes)
    const dag = buildEstimateDag(lanes, durations)
    expect(dag.criticalPathHours).toBe(6)
    expect(dag.nodes[1]!.earliestStartHours).toBe(4)
    expect(JSON.stringify(lanes)).toBe(before)
    expect([...durations]).toEqual([
      ['A', 4],
      ['B', 2],
    ])
  })

  it('handles fractional durations without false slack on critical nodes', () => {
    const dag = buildEstimateDag([
      goalLane('A', { estimatedHours: 0.1 }),
      goalLane('B', { estimatedHours: 0.2, dependencies: ['A'] }),
      goalLane('C', { estimatedHours: 0.3, dependencies: ['B'] }),
    ])
    expect(dag.criticalPath).toEqual(['A', 'B', 'C'])
    expect(dag.nodes.every((node) => node.slackHours === 0 && node.critical)).toBe(true)
    const tiny = buildEstimateDag([
      goalLane('small', { estimatedHours: 1e-18 }),
      goalLane('large', { estimatedHours: 2e-18 }),
    ])
    expect(tiny.nodes.find((node) => node.laneId === 'small')!.critical).toBe(false)
  })

  it('returns a zero-duration empty or fully merged goal', () => {
    expect(buildEstimateDag([])).toEqual({
      nodes: [],
      topologicalOrder: [],
      criticalPath: [],
      criticalPathHours: 0,
    })
    const dag = buildEstimateDag([goalLane('done', { state: 'merged' })])
    expect(dag.criticalPath).toEqual([])
    expect(dag.criticalPathHours).toBe(0)
    expect(dag.nodes[0]).toMatchObject({ durationHours: 0, slackHours: 0, critical: false })
  })

  it('rejects duplicate identities, missing prerequisites, self edges and cycles', () => {
    expect(() => buildEstimateDag([goalLane('A'), goalLane('A')])).toThrow('duplicate-lane')
    expect(() => buildEstimateDag([goalLane('A', { dependencies: ['missing'] })])).toThrow(
      'missing-dependency',
    )
    expect(() => buildEstimateDag([goalLane('A', { dependencies: ['A'] })])).toThrow(
      'self-dependency',
    )
    expect(() =>
      buildEstimateDag([
        goalLane('A', { dependencies: ['B'] }),
        goalLane('B', { dependencies: ['A'] }),
        goalLane('C'),
      ]),
    ).toThrow(UI_TEXT.estimateCycle)
    expect(() =>
      buildEstimateDag([goalLane('A', { dependencies: ['B', 'B'] }), goalLane('B')]),
    ).toThrow()
  })

  it.each([
    new Map<string, number>(),
    new Map([
      ['A', 1],
      ['extra', 1],
    ]),
    new Map([['other', 1]]),
  ])('requires exact sampled-duration coverage %#', (durations) => {
    expect(() => buildEstimateDag([goalLane('A')], durations)).toThrow('duration-coverage')
  })

  it.each([NaN, Infinity, -1])('rejects invalid sampled duration %s', (duration) => {
    expect(() => buildEstimateDag([goalLane('A')], new Map([['A', duration]]))).toThrow(
      'invalid-duration',
    )
  })

  it('never revives completed work or samples running work below its calibrated floor', () => {
    expect(() =>
      buildEstimateDag([goalLane('A', { state: 'merged' })], new Map([['A', 1]])),
    ).toThrow('merged-duration')
    expect(() =>
      buildEstimateDag(
        [goalLane('A', { state: 'running', minimumRemainingHours: 0.5 })],
        new Map([['A', 0.1]]),
      ),
    ).toThrow('minimum-duration')
  })

  it('rejects duration overflow and overlarge graphs instead of emitting invalid forecasts', () => {
    expect(() =>
      buildEstimateDag([
        goalLane('A', { estimatedHours: Number.MAX_VALUE }),
        goalLane('B', { estimatedHours: Number.MAX_VALUE, dependencies: ['A'] }),
      ]),
    ).toThrow('duration-overflow')
    expect(() =>
      buildEstimateDag(
        Array.from({ length: ESTIMATE_MAX_ITEMS + 1 }, (_, index) => goalLane(`L${String(index)}`)),
      ),
    ).toThrow('lane-limit')
  })

  it.each(['M103', 'M104'])(
    'certifies the captured %s topology using explicit unit-hour test assumptions',
    (milestone) => {
      const records = repository.lanes.filter((lane) => lane.laneId.startsWith(`${milestone}:`))
      expect(records.map((record) => record.estimatedHours)).toEqual(records.map(() => null))
      // Original plan hours are unavailable; one hour is solely a topology-test weight.
      const dag = buildEstimateDag(
        records.map((record) => goalLane(record.laneId, { dependencies: record.dependencies })),
      )
      expect(dag.topologicalOrder).toHaveLength(records.length)
      const expected =
        milestone === 'M103'
          ? ['M103:0', 'M103:A', 'M103:W', 'M103:E']
          : ['M104:0', 'M104:C', 'M104:H']
      expect(dag.criticalPath).toEqual(expected)
      expect(dag.criticalPathHours).toBe(expected.length)
    },
  )

  it('resolves and analyzes forty lanes inside the D97 local performance envelope', async () => {
    const snapshot = goalSnapshot()
    snapshot.lanes = Array.from({ length: ESTIMATE_LOCAL_BUDGET_LANES }, (_, index) => ({
      lane: goalLane(`M112:L${String(index)}`, {
        dependencies: index === 0 ? [] : [`M112:L${String(index - 1)}`],
      }),
    }))
    snapshot.milestones[0]!.laneIds = snapshot.lanes.map((entry) => entry.lane.id)
    snapshot.milestones = [snapshot.milestones[0]!]
    snapshot.issues = []
    snapshot.pullRequests = []
    snapshot.releases = []
    const start = performance.now()
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M112')!, snapshot.asOf, {
      snapshot: vi.fn().mockResolvedValue(snapshot),
    })
    const dag = buildEstimateDag(lanes)
    expect(dag.criticalPathHours).toBe(ESTIMATE_LOCAL_BUDGET_LANES)
    expect(performance.now() - start).toBeLessThan(ESTIMATE_LOCAL_BUDGET_MS)
  })
})

describe('M117 goal and DAG determinism', () => {
  let code: string
  beforeAll(() => {
    const bundle = buildSync({
      stdin: {
        contents: `
          import { goalSnapshot } from './helpers/estimatorGoalFixtures';
          import { resolveEstimateGoal } from '../../src/core/estimator/goal';
          import { buildEstimateDag } from '../../src/core/estimator/dag';
          (async () => {
            const snapshot = goalSnapshot();
            const lanes = await resolveEstimateGoal({kind:'release',release:'0.16.0'}, snapshot.asOf,
              {snapshot: () => Promise.resolve(snapshot)});
            process.stdout.write(JSON.stringify({lanes,dag:buildEstimateDag(lanes)}));
          })().catch(error => {process.stderr.write(String(error));process.exitCode=1});
        `,
        resolveDir: path.resolve(import.meta.dirname),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    })
    code = bundle.outputFiles[0]!.text
  })

  it('produces identical bytes twice and in children with different TZ and LANG', async () => {
    const expected = await deterministicRun()
    expect(await deterministicRun()).toBe(expected)
    for (const env of [
      { TZ: 'Pacific/Auckland', LANG: 'ja_JP.UTF-8' },
      { TZ: 'America/Los_Angeles', LANG: 'fr_FR.UTF-8' },
    ]) {
      const child = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' })
      expect(child.status, child.stderr).toBe(0)
      expect(child.stdout).toBe(expected)
    }
  })
})
