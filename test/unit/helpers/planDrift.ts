import { PLAN_FORMAT_FIXTURE } from './reporting/plans'

export function escapedCredentialCanary(): { canary: string; escaped: string } {
  const canary = `sk-${'A'.repeat(48)}`
  const escaped = canary.replaceAll(
    /./g,
    (char) => String.raw`\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  )
  return { canary, escaped }
}

const cases: readonly {
  readonly code: string
  readonly text: string
  readonly line: string
  readonly last?: boolean
}[] = [
  {
    code: 'milestone-heading',
    text: PLAN_FORMAT_FIXTURE.replace('### M12 —', '### Invalid: M12 —'),
    line: '### Invalid:',
  },
  {
    code: 'milestone-section',
    text: `${PLAN_FORMAT_FIXTURE}\n### M900 — Outside section six\n**Status 2026-10-05: planned.**\n`,
    line: '### M900',
  },
  {
    code: 'section-duplicate',
    text: `${PLAN_FORMAT_FIXTURE}\n## 7. Gates\n`,
    line: '## 7. Gates',
    last: true,
  },
  {
    code: 'milestone-status',
    text: PLAN_FORMAT_FIXTURE.replace('**Status 2026-10-05: planned.**\n', ''),
    line: '### M12 —',
  },
  {
    code: 'status-form',
    text: PLAN_FORMAT_FIXTURE.replace('Status 2026-10-05: planned', 'Status tomorrow: planned'),
    line: '**Status tomorrow',
  },
  {
    code: 'status-phrase',
    text: PLAN_FORMAT_FIXTURE.replace('planned.**', 'almost totally finished.**'),
    line: '**Status 2026-10-05: almost',
  },
  {
    code: 'lanes-columns',
    text: PLAN_FORMAT_FIXTURE.replace('| Hours |', '| Guesses |'),
    line: '| Lane |',
  },
  {
    code: 'lanes-row',
    text: PLAN_FORMAT_FIXTURE.replace(
      '| day 0 | Win11 VM | 10 |',
      '| day 0 | Win11 VM | 10 | extra |',
    ),
    line: '| 0 Contracts |',
  },
  {
    code: 'delivery-form',
    text: PLAN_FORMAT_FIXTURE.replace('1. **M12** — Establish', '1. M12 — Establish'),
    line: '1. M12',
  },
  {
    code: 'delivery-form',
    text: PLAN_FORMAT_FIXTURE.replace('2. **M110a0**', '- **M110a0**'),
    line: '- **M110a0**',
  },
  {
    code: 'delivery-form',
    text: PLAN_FORMAT_FIXTURE.replace('1. **M12**', '1) **M12**'),
    line: '1) **M12**',
  },
  {
    code: 'delivery-form',
    text: PLAN_FORMAT_FIXTURE.replace('Needs: M12.', 'Requires: M12.'),
    line: '2. **M110a0**',
  },
  {
    code: 'milestone-duplicate',
    text: PLAN_FORMAT_FIXTURE.replace('### M91b — Plugins', '### M12 — Plugins'),
    line: '### M12 — Plugins',
  },
]

export const PLAN_DRIFT_CASES = cases.map(({ code, text, line, last }) => {
  const rows = text.split('\n')
  const index = last
    ? rows.findLastIndex((row) => row.startsWith(line))
    : rows.findIndex((row) => row.startsWith(line))
  return { code, text, line: index + 1 }
})
