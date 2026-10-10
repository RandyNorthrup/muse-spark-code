// M117 C-M117-1 R2: the adapter against this repository's real PLAN.md, not
// only fixtures. Guarded, small, hermetic (no git, no network): the snapshot
// reads the checked-in plan text with empty evidence. If the plan's own
// grammar drifts, these fail on purpose: the forecast must refuse loudly
// rather than estimate a silently partial DAG. Repository default timeout.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { parseEstimateGoal } from '../../src/shared/estimate'

const AS_OF = '2026-10-10T12:00:00.000Z'
const here = import.meta.dirname

function readPlanText(): string {
  return readFileSync(path.join(here, '..', '..', 'PLAN.md'), 'utf8')
}

const planText = readPlanText()

async function resolveReal(text: string): Promise<string[]> {
  const goal = parseEstimateGoal(text)
  if (goal === undefined) throw new Error(`unparseable goal: ${text}`)
  const snapshot = buildPlanSnapshot(planText, goal, AS_OF, {})
  const lanes = await resolveEstimateGoal(goal, AS_OF, {
    snapshot: () => Promise.resolve(snapshot),
  })
  return lanes.map((lane) => lane.id)
}

describe('M117 plan snapshot on the real PLAN.md', () => {
  it('resolves M112 with the comma lane canonicalized and last depending on all', async () => {
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = buildPlanSnapshot(planText, goal, AS_OF, {})
    for (const entry of snapshot.lanes) {
      expect(entry.lane.id).toMatch(/^M112:[\w.-]+$/)
    }
    const lanes = await resolveEstimateGoal(goal, AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.map((lane) => lane.id)).toEqual([
      'M112:0',
      'M112:A',
      'M112:Integration',
      'M112:Q',
      'M112:U',
    ])
    expect(lanes.find((lane) => lane.id === 'M112:Integration')?.dependencies).toEqual([
      'M112:0',
      'M112:A',
      'M112:Q',
      'M112:U',
    ])
  })

  it('returns byte-identical real-plan snapshots on repeated reads', () => {
    const goal = parseEstimateGoal('M112')
    if (goal === undefined) throw new Error('unparseable goal')
    const first = JSON.stringify(buildPlanSnapshot(planText, goal, AS_OF, {}))
    const second = JSON.stringify(buildPlanSnapshot(planText, goal, AS_OF, {}))
    expect(second).toBe(first)
  })

  it('starts M116:W after every other unfinished M116 lane', async () => {
    const goal = parseEstimateGoal('M116')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = buildPlanSnapshot(planText, goal, AS_OF, {})
    const lanes = await resolveEstimateGoal(goal, AS_OF, {
      snapshot: () => Promise.resolve(snapshot),
    })
    expect(lanes.length).toBeGreaterThan(0)
    expect(lanes.find((lane) => lane.id === 'M116:W')?.dependencies).toEqual([
      'M116:0',
      'M116:I',
      'M116:K',
      'M116:P',
      'M116:U',
    ])
  })

  it('assigns release 0.16.0 its titled milestones instead of reporting empty', () => {
    const goal = parseEstimateGoal('release:0.16.0')
    if (goal === undefined) throw new Error('unparseable goal')
    // M98/M103/M104 have no hour estimates, so the release refuses naming
    // them: the point is it no longer reports no remaining work.
    expect(() => buildPlanSnapshot(planText, goal, AS_OF, {})).toThrow(/missing-estimate: M103/)
  })

  it('refuses M114 on its prerequisite the plan does not contain', () => {
    const goal = parseEstimateGoal('M114')
    if (goal === undefined) throw new Error('unparseable goal')
    expect(() => buildPlanSnapshot(planText, goal, AS_OF, {})).toThrow(/unknown-prerequisite: M11/)
  })

  it('still resolves M112 even though other milestones have unknown prerequisites', async () => {
    expect(await resolveReal('M112')).toContain('M112:Integration')
  })
})
