import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { findMilestone, nextSteps } from '../../src/core/reporting/plan/selection'
import { tableCells } from '../../src/core/reporting/plan/grammar'
import { STATUS_PHRASES } from '../../src/core/reporting/plan/statusPhrases'
import {
  PLAN_FORMAT_FIXTURE,
  NO_PLAN_FIXTURE,
  QUALITY_LEDGER_FIXTURE,
} from './helpers/reporting/plans'
import { PLAN_DRIFT_CASES } from './helpers/planDrift'

const repositoryPlan = readFileSync(new URL('../../PLAN.md', import.meta.url), 'utf8')

describe('plan-format v1', () => {
  it('reads every grammar row without losing gates, questions, risks or release text', () => {
    const parsed = readPlan(PLAN_FORMAT_FIXTURE)
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.facts.format).toBe('plan-format-v1')
    expect(parsed.decisions).toEqual([{ id: 'D1', title: 'Backends (M12, 2026-10-05)', line: 4 }])
    expect(parsed.facts.milestones.map(({ id }) => id)).toEqual([
      'M12',
      'M110a0',
      'M91b',
      'CIFIX14C',
    ])
    expect(parsed.facts.milestones[0]).toMatchObject({
      status: 'planned',
      date: '2026-10-05',
      goal: 'A stable contract.',
      dependencies: [],
      requiredGates: ['quality', 'check:reference'],
      checklist: [
        { text: 'A recorded fixture.', done: true },
        { text: 'A certified renderer.', done: false },
      ],
      lanes: [
        {
          id: '0',
          scope: 'Schemas',
          hours: 10,
          state: 'planned',
          branch: null,
          pullRequest: null,
          certification: null,
        },
      ],
    })
    expect(parsed.facts.milestones[1]?.dependencies).toEqual(['M12'])
    expect(parsed.facts.questions.map(({ id }) => id)).toEqual(['Q-M12', 'Q-M91b'])
    expect(parsed.facts.questions[0]?.text).toContain('The owner chooses the target.')
    expect(parsed.facts.questions[1]?.milestoneIds).toEqual(['M91b'])
    expect(parsed.facts.risks[0]?.text).toContain('No production escape hatch.')
    expect(parsed.facts.releases).toEqual([
      { version: '0.14.2', date: '2026-10-05', text: '### 0.14.2 — 2026-10-05\nFixture release.' },
    ])
    expect(parsed.facts.deliveryOrder.map(({ id, needs }) => ({ id, needs }))).toEqual([
      { id: 'M12', needs: [] },
      { id: 'M110a0', needs: ['M12'] },
    ])
  })

  it('parses the entire repository plan with zero drift and exactly one Gates section', () => {
    const parsed = readPlan(repositoryPlan)
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.sections.filter(({ number }) => number === 7)).toHaveLength(1)
    expect(parsed.facts.milestones.some(({ id }) => id === 'M98')).toBe(true)
    expect(parsed.facts.milestones.length).toBeGreaterThan(110)
    expect(parsed.facts.deliveryOrder).toHaveLength(20)
    expect(parsed.facts.questions.some(({ id }) => id === 'Q-M113')).toBe(true)
    expect(parsed.facts.risks.length).toBeGreaterThan(20)
    expect(parsed.facts.residuals.length).toBeGreaterThan(20)
    expect(parsed.facts.releases.some(({ version }) => version === '0.11.0')).toBe(true)
  })

  it.each(PLAN_DRIFT_CASES)(
    'reports $code at the original line and exposes the same report fact',
    ({ code, text, line }) => {
      const drift = readPlan(text).facts.drift
      expect(drift).toContainEqual(expect.objectContaining({ code, line }))
      expect(drift.find((entry) => entry.code === code)?.detail).not.toBe('')
    },
  )

  it('masks fenced examples, keeps CRLF locations, and preserves folded checklist text', () => {
    const input = PLAN_FORMAT_FIXTURE.replace(
      '- [ ] A certified renderer.',
      '- [ ] A certified renderer.\n      With a recorded drill.',
    ).replace(
      '## 2. Resolved decisions',
      '```markdown\n## 7. Gates\n### M900 — Example\n```\n## 2. Resolved decisions',
    )
    const parsed = readPlan(input.replaceAll('\n', '\r\n'))
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.facts.milestones).toHaveLength(4)
    expect(parsed.facts.milestones[0]?.checklist[1]?.text).toBe(
      'A certified renderer. With a recorded drill.',
    )
    expect(readPlan(`${input}\n~~~~markdown\n### M900 — Example\n~~~~\n`).facts.drift).toEqual([])
  })

  it('maps all captured status phrases exactly and rejects new prose', () => {
    for (const [phrase, status] of Object.entries(STATUS_PHRASES)) {
      const parsed = readPlan(
        `## 6. Milestones\n### M12 — Status\n**Status 2026-10-05: ${phrase}.**\n`,
      )
      expect(parsed.facts.drift).toEqual([])
      expect(parsed.facts.milestones[0]?.status).toBe(status)
    }
    expect(
      readPlan('## 6. Milestones\n### M12 — Status\n**Status 2026-10-05: constructor.**').facts
        .drift,
    ).toContainEqual(expect.objectContaining({ code: 'status-phrase' }))
  })

  it('uses the current status over an explicitly historical note and accepts dated list statuses', () => {
    const input =
      '## 6. Milestones\n### M12 — Status\n**Status 2026-10-01 (historical): planned.**\n- **Status 2026-10-05: built and certified**\n'
    expect(readPlan(input).facts.milestones[0]).toMatchObject({
      status: 'certified',
      date: '2026-10-05',
    })
  })

  it('reads current heading variants and treats follow-ups as distinct exact ids', () => {
    const parsed = readPlan(
      '## 6. Milestones\n### M43–M56 — Parity\n**Status 2026-10-05: building.**\n### M26 follow-up — Badges\n**Status 2026-10-05: complete.**\n',
    )
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.facts.milestones.map(({ id }) => id)).toEqual(['M43–M56', 'M26-follow-up'])
    expect(findMilestone(parsed.facts, 'M26').exitCode).toBe(3)
  })

  it('keeps escaped pipes and code spans in their table cells', () => {
    expect(tableCells('| 0 | a \\| b | `x|y` |')).toEqual(['0', 'a | b', '`x|y`'])
  })

  it('derives lane status only from branch ancestry, open PRs and normalized certification paths', () => {
    const input = PLAN_FORMAT_FIXTURE.replace('| 0 Contracts |', '| P Parser |')
    const parsed = readPlan(input, {
      branches: [{ name: 'refs/remotes/origin/m12/p', commit: 'fixed', merged: false }],
      pullRequests: [{ branch: 'm12/p', number: 17, state: 'open' }],
      certificationPaths: [String.raw`docs\certification\m12-p.md`],
    })
    expect(parsed.facts.milestones[0]?.lanes[0]).toMatchObject({
      branch: 'refs/remotes/origin/m12/p',
      state: 'inReview',
      pullRequest: 17,
      certification: 'docs/certification/m12-p.md',
    })
    expect(
      readPlan(input, {
        branches: [{ name: 'feature/m12-p-parser', commit: 'fixed', merged: true }],
      }).facts.milestones[0]?.lanes[0]?.state,
    ).toBe('merged')
    expect(
      readPlan(input, { branches: [{ name: 'm12/p', commit: 'fixed', merged: false }] }).facts
        .milestones[0]?.lanes[0]?.state,
    ).toBe('inProgress')
    expect(
      readPlan(input, { certificationPaths: ['docs/certification/m12.md'] }).facts.milestones[0]
        ?.lanes[0],
    ).toMatchObject({ state: 'planned', certification: 'docs/certification/m12.md' })
    expect(
      readPlan(input, { branches: [{ name: 'm120/p', commit: 'fixed', merged: true }] }).facts
        .milestones[0]?.lanes[0]?.state,
    ).toBe('planned')
  })

  it.each(['12', 'M12', 'm12', 'M110a0', 'm91b', 'cifix14c'])(
    'selects %s by exact case-insensitive id',
    (id) => {
      const result = findMilestone(readPlan(PLAN_FORMAT_FIXTURE).facts, id)
      expect(result.exitCode).toBe(0)
    },
  )

  it('returns exit 3 with edit-distance suggestions and id-order ties', () => {
    const facts = readPlan(PLAN_FORMAT_FIXTURE).facts
    expect(findMilestone(facts, 'M999')).toEqual({ exitCode: 3, nearest: ['M91b', 'M12'] })
    expect(findMilestone(facts, 'M1').exitCode).toBe(3)
    const tied = readPlan(
      '## 6. Milestones\n### M13 — Later\n**Status 2026-10-05: planned.**\n### M11 — Earlier\n**Status 2026-10-05: planned.**',
    ).facts
    expect(findMilestone(tied, '12')).toEqual({ exitCode: 3, nearest: ['M11', 'M13'] })
  })

  it('offers the first incomplete delivery entries only when every Need is complete', () => {
    const facts = readPlan(PLAN_FORMAT_FIXTURE).facts
    expect(nextSteps(facts).map(({ id }) => id)).toEqual(['M12'])
    expect(
      nextSteps(readPlan(PLAN_FORMAT_FIXTURE.replace('planned.**', 'merged.**')).facts).map(
        ({ id }) => id,
      ),
    ).toEqual(['M110a0'])
    expect(
      nextSteps(readPlan(PLAN_FORMAT_FIXTURE.replace('Needs: none.', 'Needs: M999.')).facts),
    ).toEqual([])
  })

  it('distinguishes no plan from a broken plan and ignores example ledgers', () => {
    expect(readPlan(NO_PLAN_FIXTURE).facts).toMatchObject({
      format: 'none',
      milestones: [],
      drift: [],
    })
    expect(readPlan(`\`\`\`markdown\n${QUALITY_LEDGER_FIXTURE}\n\`\`\``).facts.format).toBe('none')
  })

  it('normalizes reference case before deduplication and checks every declared primary Need', () => {
    const parsed = readPlan(
      PLAN_FORMAT_FIXTURE.replace('- **Depends on.** M12.', '- **Depends on.** M12, m12.'),
    )
    expect(parsed.facts.milestones[1]?.dependencies).toEqual(['M12'])
    const two = readPlan(PLAN_FORMAT_FIXTURE.replace('Needs: none.', 'Needs: M91b, M110a0.'))
    expect(nextSteps(two.facts)).toEqual([])
  })

  it('keeps an open PR as lane evidence when local branch refs are unavailable', () => {
    const parsed = readPlan(PLAN_FORMAT_FIXTURE.replace('| 0 Contracts |', '| P Parser |'), {
      pullRequests: [{ branch: 'm12/p', number: 17, state: 'open' }],
    })
    expect(parsed.facts.milestones[0]?.lanes[0]).toMatchObject({
      state: 'inReview',
      branch: 'm12/p',
      pullRequest: 17,
    })
  })

  it('recognizes the captured lane-zero l0 branch spelling without treating a neighboring lane as zero', () => {
    const found = readPlan(PLAN_FORMAT_FIXTURE, {
      branches: [{ name: 'm12/l0', commit: 'fixed', merged: true }],
    })
    expect(found.facts.milestones[0]?.lanes[0]).toMatchObject({
      id: '0',
      branch: 'm12/l0',
      state: 'merged',
    })
    const other = readPlan(PLAN_FORMAT_FIXTURE, {
      branches: [{ name: 'm12/l01', commit: 'fixed', merged: true }],
    })
    expect(other.facts.milestones[0]?.lanes[0]?.state).toBe('planned')
  })

  it('reads the initial release version from its record rather than assuming this repository version', () => {
    const input =
      '## 6. Milestones\n### M12 — Status\n**Status 2026-10-05: planned.**\n## 10. Releases\n**Status 2026-10-05:** Certified.\n**Published 2026-10-05:** fixture v2.4.0.\n'
    expect(readPlan(input).facts.releases[0]).toMatchObject({
      version: '2.4.0',
      date: '2026-10-05',
    })
  })

  it('retains preparation records without satisfying a completed release dependency', () => {
    const parsed = readPlan(
      `${PLAN_FORMAT_FIXTURE.replace('Needs: none.', 'Needs: 9.9.9.')}\n**9.9.9 preparation (2026-10-05, owner authorized).**\nPreparation is in progress.\n`,
    )
    expect(parsed.facts.releases.some(({ version }) => version === '9.9.9')).toBe(true)
    expect(nextSteps(parsed.facts)).toEqual([])
  })
})
