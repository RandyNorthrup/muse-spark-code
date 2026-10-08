import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { findMilestone, nextSteps } from '../../src/core/reporting/plan/selection'
import { tableCells } from '../../src/core/reporting/plan/grammar'
import { scrubPlanStrings, scrubPlanText } from '../../src/core/reporting/plan/grammar'
import { STATUS_PHRASES } from '../../src/core/reporting/plan/statusPhrases'
import { REPORT_PLAN_BUDGET_MS, REPORT_PLAN_MAX_BYTES } from '../../src/shared/constants'
import {
  PLAN_FORMAT_FIXTURE,
  NO_PLAN_FIXTURE,
  QUALITY_LEDGER_FIXTURE,
} from './helpers/reporting/plans'
import { PLAN_DRIFT_CASES, escapedCredentialCanary } from './helpers/planDrift'

const repositoryPlan = readFileSync(new URL('../../PLAN.md', import.meta.url), 'utf8')

describe('plan-format v1', () => {
  it('scrubs secrets in string arrays, nested object values and object keys', () => {
    const { escaped } = escapedCredentialCanary()
    const input = { rows: [escaped, { [escaped]: escaped }], dependencies: [escaped] }
    scrubPlanStrings(input)
    expect(input).toEqual({
      rows: ['[redacted]', { '[redacted]': '[redacted]' }],
      dependencies: ['[redacted]'],
    })
  })

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

  it('reads indented lane tables in the fixture and the real M91, M100 and M93 records', () => {
    const input = PLAN_FORMAT_FIXTURE.replaceAll(/^\|/gm, '      |')
    expect(readPlan(input).facts.milestones[0]?.lanes).toHaveLength(1)
    const parsed = readPlan(repositoryPlan)
    expect(parsed.facts.drift).toEqual([])
    for (const id of ['M91', 'M100', 'M93'])
      expect(parsed.facts.milestones.find((item) => item.id === id)?.lanes.length).toBeGreaterThan(
        0,
      )
  })

  it('rejects a delimiter width that differs from the header width', () => {
    const input = PLAN_FORMAT_FIXTURE.replace(
      '| --- | --- | --- | --- | --- | --- | ---: |',
      '| --- |',
    )
    expect(readPlan(input).facts.drift).toContainEqual(
      expect.objectContaining({ code: 'table-delimiter', line: 22 }),
    )
    expect(readPlan(input).facts.milestones[0]?.lanes).toEqual([])
  })

  it('uses delimiter rows to exclude every escape-hatch header regardless of its names', () => {
    const input = PLAN_FORMAT_FIXTURE.replace('| Item | Reason |', '| Location | Escape hatch |')
    const parsed = readPlan(input)
    expect(parsed.facts.risks).toHaveLength(1)
    expect(parsed.facts.risks[0]?.id).toBe('M12 fixture: No production escape hatch.')
    expect(
      readPlan(repositoryPlan).facts.risks.some(({ id }) => id === 'Location: Escape hatch'),
    ).toBe(false)
  })

  it('reports owner Decided and Owner answer markers as answered while retaining the decision text', () => {
    for (const marker of ['Decided 2026-10-06 (owner): yes', 'Owner answer (2026-10-06): yes']) {
      const input = PLAN_FORMAT_FIXTURE.replace(
        'The owner chooses the target.',
        () => `**${marker}.**`,
      )
      expect(readPlan(input).facts.questions[0]).toMatchObject({
        state: 'answered',
        text: expect.stringContaining(marker),
      })
    }
    const parsed = readPlan(repositoryPlan)
    for (const id of ['Q-M94a', 'Q-M94b', 'Q-M94c'])
      expect(parsed.facts.questions.find((item) => item.id === id)).toMatchObject({
        state: 'answered',
        text: expect.stringContaining('**Decided'),
      })
  })

  it('refuses oversized UTF-8 plans honestly before parsing either format', () => {
    for (const text of [
      'x'.repeat(REPORT_PLAN_MAX_BYTES + 1),
      'é'.repeat(REPORT_PLAN_MAX_BYTES / 2 + 1),
    ]) {
      const parsed = readPlan(text)
      expect(parsed.facts.milestones).toEqual([])
      expect(parsed.facts.drift).toEqual([
        {
          code: 'input-size',
          line: 1,
          detail: `maxUtf8Bytes=${String(REPORT_PLAN_MAX_BYTES)}`,
        },
      ])
    }
  })

  it('parses ten thousand milestones within the named plan budget without per-milestone rescans', () => {
    const text = `## 6. Milestones\n${Array.from({ length: 10_000 }, (_, index) => `### M${String(index)} — Synthetic\n**Status 2026-10-05: planned.**\n`).join('')}`
    const start = performance.now()
    const parsed = readPlan(text)
    const elapsed = performance.now() - start
    expect(parsed.facts.drift).toEqual([])
    expect(parsed.facts.milestones).toHaveLength(10_000)
    expect(elapsed).toBeLessThan(REPORT_PLAN_BUDGET_MS)
  })

  it('reports an unterminated folded status within the plan budget without rescanning its prefix', () => {
    const text = `## 6. Milestones\n### M12 — Folded\n**Status 2026-10-05: planned\n${'unclosed fold\n'.repeat(60_000)}`
    const start = performance.now()
    const parsed = readPlan(text)
    const elapsed = performance.now() - start
    expect(parsed.facts.drift).toContainEqual(expect.objectContaining({ code: 'status-form' }))
    expect(elapsed).toBeLessThan(REPORT_PLAN_BUDGET_MS)
  })

  it('decodes escaped credential strings before scrubbing every returned plan and ledger string', () => {
    const { canary, escaped } = escapedCredentialCanary()
    for (const text of [
      PLAN_FORMAT_FIXTURE.replace('The owner chooses the target.', () => escaped),
      QUALITY_LEDGER_FIXTURE.replace('Reporting fixture', () => escaped),
    ]) {
      const output = JSON.stringify(readPlan(text))
      expect(output.includes(canary)).toBe(false)
      expect(output.includes(escaped)).toBe(false)
      expect(output).toContain('[redacted]')
    }
    const nested = escaped.replaceAll('\\', String.raw`\u005c`)
    expect(scrubPlanText(nested)).toBe('[redacted]')
    expect(scrubPlanText('\\'.repeat(100_000))).toHaveLength(100_000)
  })

  it('accepts a lane prerequisite only after that exact lane or its milestone is merged', () => {
    const input = PLAN_FORMAT_FIXTURE.replace('Needs: M12.', 'Needs: m12:0.')
    expect(nextSteps(readPlan(input).facts).map(({ id }) => id)).toEqual(['M12'])
    const evidence = { branches: [{ name: 'm12/l0', commit: 'fixed', merged: true }] }
    expect(nextSteps(readPlan(input, evidence).facts).map(({ id }) => id)).toEqual([
      'M12',
      'M110a0',
    ])
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

  it('pairs an open PR only with its exact branch even when a historical lane branch is merged', () => {
    const input = PLAN_FORMAT_FIXTURE.replace('| 0 Contracts |', '| P Parser |')
    for (const isMerged of [false, true]) {
      const parsed = readPlan(input, {
        branches: [
          { name: 'm12/p-a', commit: 'old', merged: isMerged },
          { name: 'refs/remotes/origin/m12/p-b', commit: 'new', merged: false },
        ],
        pullRequests: [{ branch: 'm12/p-b', number: 17, state: 'open' }],
      })
      expect(parsed.facts.drift).toEqual([])
      expect(parsed.facts.milestones[0]?.lanes[0]).toMatchObject({
        branch: 'refs/remotes/origin/m12/p-b',
        state: 'inReview',
        pullRequest: 17,
      })
    }
  })

  it('reports ambiguous lane evidence without manufacturing a branch and PR pair', () => {
    const input = PLAN_FORMAT_FIXTURE.replace('| 0 Contracts |', '| P Parser |')
    for (const evidence of [
      {
        branches: [
          { name: 'm12/p-a', commit: 'old', merged: true },
          { name: 'm12/p-b', commit: 'new', merged: false },
        ],
        pullRequests: [{ branch: 'm12/p-c', number: 17, state: 'open' }],
      },
      {
        branches: [{ name: 'm12/P', commit: 'fixed', merged: false }],
        pullRequests: [{ branch: 'm12/p', number: 17, state: 'open' }],
      },
    ]) {
      const parsed = readPlan(input, evidence)
      expect(parsed.facts.drift).toContainEqual(
        expect.objectContaining({ code: 'lanes-ambiguous' }),
      )
      expect(parsed.facts.milestones[0]?.lanes[0]).toMatchObject({
        branch: null,
        pullRequest: null,
        state: 'planned',
      })
    }
  })

  it('retains lowercase, suffixed, working and lane Needs without making blocked delivery eligible', () => {
    for (const need of ['m12', 'M12', 'M12:P', 'm12/p', "M12's lane P", 'cifix14c']) {
      const input = PLAN_FORMAT_FIXTURE.replace('Needs: M12.', () => `Needs: ${need}.`).replace(
        '### CIFIX14C — CI repair (D1)\n**Status 2026-10-05: complete.**',
        '### CIFIX14C — CI repair (D1)\n**Status 2026-10-05: building.**',
      )
      const parsed = readPlan(input)
      expect(parsed.facts.drift).toEqual([])
      expect(parsed.facts.deliveryOrder[1]?.needs.length).toBeGreaterThan(0)
      expect(nextSteps(parsed.facts).map(({ id }) => id)).toEqual(['M12'])
    }
    const working = readPlan(
      PLAN_FORMAT_FIXTURE.replace('- **Depends on.** M12.', '- **Depends on.** cifix14c, m12:P.'),
    )
    expect(working.facts.milestones[1]?.dependencies).toEqual(['CIFIX14C', 'M12:P'])
    const suffixed = readPlan(
      PLAN_FORMAT_FIXTURE.replace('Needs: M12.', 'Needs: m12A.').replace('### M12 —', '### M12a —'),
    )
    expect(suffixed.facts.deliveryOrder[1]?.needs).toEqual(['M12a'])
    expect(nextSteps(suffixed.facts).map(({ id }) => id)).not.toContain('M110a0')
  })

  it('reports unparseable Needs as drift and keeps their delivery entries blocked', () => {
    for (const need of ['a mystery prerequisite', 'M12 and mystery', '']) {
      const parsed = readPlan(PLAN_FORMAT_FIXTURE.replace('Needs: M12.', () => `Needs: ${need}.`))
      expect(
        parsed.facts.drift.some(
          ({ code }) => code === 'delivery-needs' || code === 'delivery-form',
        ),
      ).toBe(true)
      expect(nextSteps(parsed.facts).map(({ id }) => id)).not.toContain('M110a0')
    }
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
