// M117 C-M117-1 R3: the adapter against this repository's real PLAN.md, not
// only fixtures. Guarded, small, hermetic (no git, no network): the snapshot
// reads the checked-in plan text with empty evidence. If the plan's own
// grammar drifts, these fail on purpose: the forecast must refuse loudly
// rather than estimate a silently partial DAG. Repository default timeout.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot, checkPlan } from '../../src/core/estimator/planSnapshot'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { tableCells, comparePlanText } from '../../src/core/reporting/plan/grammar'
import { readPlan } from '../../src/core/reporting/plan/reader'
import * as z from 'zod/mini'

const AS_OF = '2026-10-10T12:00:00.000Z'
const here = import.meta.dirname

function readPlanText(): string {
  return readFileSync(path.join(here, '..', '..', 'PLAN.md'), 'utf8')
}

const planText = readPlanText()

// The reviewed fixture covers all 398 declarations, independently expanded
// from Starts. Supply test-only hours/state so missing estimates or historical
// completion cannot conceal the real plan's declared prerequisite edges.
const prerequisites = z
  .record(z.string(), z.array(z.string()))
  .parse(
    JSON.parse(
      readFileSync(
        path.join(here, '..', 'fixtures', 'estimator', 'plan-prerequisites.json'),
        'utf8',
      ),
    ),
  )
const fixturePlan = (() => {
  let hoursIndex: number | undefined
  return planText
    .replaceAll(
      /\*\*Status (\d{4}-\d{2}-\d{2})(?: \([^]*?\))?: [^]*?\*\*/g,
      '**Status $1: planned.**',
    )
    .split('\n')
    .map((line) => {
      if (!line.trimStart().startsWith('|')) {
        if (line.trim() !== '') hoursIndex = undefined
        return line
      }
      const cells = tableCells(line)
      if (cells[0] === 'Lane' || cells[0] === 'Lane / receipt') {
        hoursIndex = cells.indexOf('Hours')
        if (hoursIndex === -1) {
          hoursIndex = cells.length
          cells.push('Hours')
        }
      } else if (hoursIndex !== undefined) {
        cells[hoursIndex] = /^[-: ]+$/.test(cells[0] ?? '') ? '---' : '1'
      }
      return `| ${cells.join(' | ')} |`
    })
    .join('\n')
})()
const fixtureMilestones = [
  ...new Set(Object.keys(prerequisites).map((id) => id.split(':', 1)[0] ?? '')),
]
const fixtureBranches = Object.keys(prerequisites).map((id) => ({
  name: id.replace(':', '/').toLowerCase(),
  merged: true,
}))

describe('M117 reviewed real-plan prerequisite fixture', () => {
  it('covers every real lane declaration', () => {
    const ids = readPlan(planText)
      .facts.milestones.flatMap((milestone) =>
        milestone.lanes.map((lane) => `${milestone.id}:${lane.id}`),
      )
      .toSorted(comparePlanText)
    expect(ids).toEqual(Object.keys(prerequisites).toSorted(comparePlanText))
  })
  it.each(fixtureMilestones)('F3 preserves every declared prerequisite in %s', (mid) => {
    const goal = parseEstimateGoal(mid)
    if (!goal) throw new Error('bad fixture milestone')
    const snapshot = buildPlanSnapshot(fixturePlan, goal, AS_OF, {
      branches: fixtureBranches.filter(
        (branch) => !branch.name.startsWith(`${mid.toLowerCase()}/`),
      ),
    })
    const ownLanes = snapshot.lanes.filter((entry) => entry.lane.id.startsWith(`${mid}:`))
    for (const entry of ownLanes) {
      expect(entry.lane.dependencies, entry.lane.id).toEqual(prerequisites[entry.lane.id])
    }
  })
})

/** Real milestone tables remain unchanged; whole-plan refusals are tested separately. */
function milestoneExcerpt(id: string): string {
  const start = planText.indexOf(`### ${id} —`)
  const remainder = planText.slice(start)
  const next = /\n### M\d+/.exec(remainder)
  return `## 6. Milestones\n\n${remainder.slice(0, next?.index ?? remainder.length)}\n${['M96', 'M96c', 'M100', 'M110'].map((mid) => `### ${mid} — External prerequisite\n\n**Status 2026-10-10: released.**\n`).join('\n')}`
}

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
    const snapshot = buildPlanSnapshot(milestoneExcerpt('M112'), goal, AS_OF, {})
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
    const merged = buildPlanSnapshot(milestoneExcerpt('M112'), goal, AS_OF, {
      branches: [{ name: 'm112/integration', merged: true }],
    })
    expect(merged.lanes.find((entry) => entry.lane.id === 'M112:Integration')?.lane.state).toBe(
      'merged',
    )
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
    const first = JSON.stringify(buildPlanSnapshot(milestoneExcerpt('M112'), goal, AS_OF, {}))
    const second = JSON.stringify(buildPlanSnapshot(milestoneExcerpt('M112'), goal, AS_OF, {}))
    expect(second).toBe(first)
  })

  it('starts M116:W after every other unfinished M116 lane', async () => {
    const goal = parseEstimateGoal('M116')
    if (goal === undefined) throw new Error('unparseable goal')
    const snapshot = buildPlanSnapshot(milestoneExcerpt('M116'), goal, AS_OF, {})
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

  it('reports zero problems for the whole repository plan', () => {
    expect(checkPlan(planText)).toEqual([])
  })

  it('estimates M112 on the full plan while unrelated milestones keep their own rows', async () => {
    await expect(resolveReal('M112')).resolves.toEqual([
      'M112:0',
      'M112:A',
      'M112:Integration',
      'M112:Q',
      'M112:U',
    ])
  })

  it('refuses M116 when its restored integration prerequisites have no hours', async () => {
    await expect(resolveReal('M116')).rejects.toThrow(/missing-estimate:/)
  })

  it('refuses release forecasts only on genuinely missing hours, never plan shape', () => {
    const goal = parseEstimateGoal('release:0.16.0')
    if (goal === undefined) throw new Error('unparseable goal')
    // 0.16.0's M103 lanes have no hour estimates yet: membership resolves
    // and every declaration parses, so the refusal names the hours.
    try {
      buildPlanSnapshot(planText, goal, AS_OF, {})
      throw new Error('release:0.16.0 unexpectedly succeeded')
    } catch (error: unknown) {
      expect(String(error)).toMatch(/missing-estimate: M103/)
      expect(String(error)).not.toMatch(/unknown-prerequisite|duplicate-lane|malformed-starts/)
    }
  })

  it('refuses M114 only on its unfinished prerequisite hours, never plan shape', () => {
    const goal = parseEstimateGoal('M114')
    if (goal === undefined) throw new Error('unparseable goal')
    // M114's C lane needs M104, whose waiting lanes have no hour estimates:
    // the closure resolves and the refusal names the hours.
    try {
      buildPlanSnapshot(planText, goal, AS_OF, {})
      throw new Error('M114 unexpectedly succeeded')
    } catch (error: unknown) {
      expect(String(error)).toMatch(/missing-estimate: M104/)
      expect(String(error)).not.toMatch(/unknown-prerequisite|duplicate-lane|malformed-starts/)
    }
  })
})
