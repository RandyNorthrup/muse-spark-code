import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot, checkPlan } from '../../src/core/estimator/planSnapshot'
import { buildEstimateDag } from '../../src/core/estimator/dag'
import { parseEstimateGoal } from '../../src/shared/estimate'

const AS_OF = '2026-10-11T12:00:00.000Z'
function table(id: string, rows: string, columns = 'Lane | Starts | Hours') {
  return `### ${id} — Work\n\n**Status 2026-10-10: planned.**\n\n| ${columns} |\n| --- | --- | --- |\n${rows}\n`
}
function plan(rows = '| 0 | first | 1 |\n| Q | after 0 | 4 |') {
  return `## 6. Milestones\n\n${table('M112', rows)}`
}
function snapshot(text: string, target = 'M112:Q') {
  const goal = parseEstimateGoal(target)
  if (!goal) throw new Error('invalid fixture goal')
  return buildPlanSnapshot(text, goal, AS_OF)
}

describe('M117 R5 collected plan grammar', () => {
  it('F2 keeps explicit M-number local lanes even beside historical milestones', () => {
    const rows =
      '| 0 | first | 1 |\n| M1 | after lane 0 | 1 |\n| M2 | after lane M1 | 1 |\n| A | after lane M2 | 1 |'
    for (const history of [
      '',
      table('M1', '| Old | first | 1 |') + table('M2', '| Old | first | 1 |'),
    ]) {
      const text = `## 6. Milestones\n\n${table('M105', rows)}${history}`
      expect(checkPlan(text)).toEqual([])
      expect(snapshot(text, 'M105:A').lanes.map((entry) => entry.lane.id)).toEqual([
        'M105:0',
        'M105:A',
        'M105:M1',
        'M105:M2',
      ])
    }
  })
  it('F3 refuses ordering hidden in notes or trailing prose', () => {
    for (const starts of [
      'after 0 (finished last)',
      'day 0 (after the contract freeze)',
      'after 0 (before Q)',
      'after 0 (once ready)',
      'after 0 (when ready)',
      'after 0 (freeze)',
      'after 0 trailing',
      'after 0 (nested (after Q))',
    ]) {
      const text = plan(`| 0 | first | 1 |\n| Q | ${starts} | 4 |`)
      expect(() => snapshot(text), starts).toThrow(/malformed-starts: M112:Q line 10/)
    }
    expect(checkPlan(plan('| Q | day 0 (capture fixture) | 4 |'))).toEqual([])
  })
  it('F4 collects reader drift and invalid identities without blocking unrelated goals', () => {
    for (const other of [
      table('M113', '| S | first | 4 |', 'Lane | Unsupported | Hours'),
      table('M113', '| !!! | first | 4 |'),
      table('M113', '| A/B | first | 4 |'),
    ]) {
      const text = plan() + other
      expect(snapshot(text).lanes.map((entry) => entry.lane.id)).toEqual(['M112:0', 'M112:Q'])
      expect(checkPlan(text).join('; ')).toMatch(/(?:plan-drift|invalid-lane):.*line/)
      expect(() => snapshot(text, 'M113')).toThrow(/(?:plan-drift|invalid-lane):/)
    }
    const text = plan() + table('M113', '| S | after M112:Q | 4 |', 'Lane | Unsupported | Hours')
    expect(() => snapshot(text.replace('after 0', 'after M113'), 'M112:Q')).toThrow(/plan-drift:/)
  })
  it('F5 refuses missing estimator format and missing lane tables', () => {
    for (const text of [
      '',
      'ordinary unstructured text',
      '## 6. Milestones\n',
      '```quality-ledger\n{}\n```',
      '## 6. Milestones\n\n### M112 — Work\n\n**Status 2026-10-10: planned.**',
      '## 6. Milestones\n\n### M112 — Work\n\n**Status 2026-10-10: planned.**\n\n| Lane | Starts | Hours |',
    ]) {
      expect(checkPlan(text).join('; ')).toMatch(/plan-drift:.*(?:plan-format|lanes-missing)/)
    }
  })
  it('F4 parses Starts even in a table the base reader rejected', () => {
    const text = plan() + table('M113', '| S | after X | 4 |', 'Lane | Starts | Unsupported')
    expect(snapshot(text).lanes.map((entry) => entry.lane.id)).toEqual(['M112:0', 'M112:Q'])
    expect(checkPlan(text)).toEqual([
      expect.stringMatching(/^plan-drift: lanes-columns line \d+$/),
      'unknown-prerequisite: M113:X',
    ])
    expect(() => snapshot(text, 'M113:S')).toThrow(/plan-drift:.*unknown-prerequisite: M113:X/)
  })
  it('F4 scopes delivery reader drift to the selected release', () => {
    const text = `${plan()}\n### Delivery order (2026-10-10)\n\n1. **0.16.0: M112** — Release. Needs: main only.\n2. **0.17.0: M112** — Broken release.\n`
    expect(snapshot(text, 'release:0.16.0').lanes.map((entry) => entry.lane.id)).toEqual([
      'M112:0',
      'M112:Q',
    ])
    expect(checkPlan(text)).toEqual([expect.stringMatching(/^plan-drift: delivery-form line \d+$/)])
    expect(() => snapshot(text, 'release:0.17.0')).toThrow(/plan-drift: delivery-form/)
  })
  it('F4 isolates bad sibling rows and tables inside the same milestone', () => {
    const invalid = plan('| 0 | first | 1 |\n| Q | after 0 | 4 |\n| !!! | first | 4 |')
    const columns =
      plan() + '\n| Lane | Starts | Unsupported |\n| --- | --- | --- |\n| S | first | 4 |\n'
    for (const text of [invalid, columns]) {
      expect(snapshot(text).lanes.map((entry) => entry.lane.id)).toEqual(['M112:0', 'M112:Q'])
      expect(() => snapshot(text, 'M112')).toThrow(/(?:invalid-lane|plan-drift):/)
      expect(checkPlan(text).length).toBeGreaterThan(0)
    }
    expect(() => snapshot(invalid.replace('after 0', 'last'))).toThrow(/invalid-lane:/)
    expect(() => snapshot(columns.replace('planned.', 'released.'), 'M112:S')).toThrow(
      /plan-drift:/,
    )
  })
  it('F6 preserves explicit self prerequisites for the engine guard and checker', () => {
    for (const starts of ['after lane Q', 'after M112:Q', 'after M112']) {
      const text = plan(`| Q | ${starts} | 4 |`)
      const result = snapshot(text)
      expect(result.lanes[0]?.lane.dependencies).toEqual(['M112:Q'])
      expect(() => buildEstimateDag(result.lanes.map((entry) => entry.lane))).toThrow(
        /self-dependency/,
      )
      expect(checkPlan(text)).toEqual(['self-dependency: M112:Q'])
    }
  })
  it('F7 aggregates unknown whole milestones together with local and qualified refs', () => {
    const text = plan('| Q | after M998 and M999 and X and M997:Y | 4 |')
    const expected = 'unknown-prerequisite: M112:X, M997:Y, M998, M999'
    expect(checkPlan(text)).toEqual([expected])
    expect(() => snapshot(text)).toThrow(expected)
  })
})
