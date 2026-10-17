import { describe, expect, it } from 'vitest'
import {
  PLAN_CITATION_MIN_PHRASE,
  planCitationChecker,
  type PlanCitation,
} from './helpers/planCitation'

// PLAN.md is cited by heading and quoted phrase, never by line number
// (`./helpers/planCitation`). These cases hold both halves of that promise:
// a citation survives edits around its passage, and it fails when the passage
// itself is deleted, reworded, duplicated or moved.

const SMALL = `# Plan

## 2. Decisions

### D1 — First decision

Money stays exact from the wire to the
ledger; a rate is the one number allowed.

\`\`\`md
### D2 — Second decision
\`\`\`

#### A note under the first decision

The note keeps its own sentence about rounding.

### D2 — Second decision

Paid calls ask first, in every mode, each time.

## 3. Open questions

Nothing is open about exact money today.
`

const FIRST: PlanCitation = {
  heading: '### D1 — First decision',
  phrase: 'Money stays exact from the wire to the ledger',
}

function problem(plan: string, citation: PlanCitation): string | undefined {
  return planCitationChecker(plan)(citation)
}

describe('PLAN.md citations by heading and phrase', () => {
  it('resolves a phrase under its heading, across a line break', () => {
    expect(problem(SMALL, FIRST)).toBeUndefined()
  })

  it('counts a deeper heading as part of the section, and stops at the next equal one', () => {
    expect(
      problem(SMALL, { ...FIRST, phrase: 'The note keeps its own sentence about rounding.' }),
    ).toBeUndefined()
    expect(
      problem(SMALL, { ...FIRST, phrase: 'Paid calls ask first, in every mode, each time.' }),
    ).toBe(
      'the phrase "Paid calls ask first, in every mode, each time." is not under "### D1 — First decision"',
    )
  })

  it('stays resolved when lines are added above, between and below', () => {
    const lines = SMALL.split('\n')
    const at = lines.indexOf(FIRST.heading)
    const padded = [
      ...Array.from({ length: 500 }, (_, index) => `Added line ${String(index)}.`),
      ...lines.slice(0, at),
      '### D0 — A decision added above',
      '',
      'Its own words, which the citation never quoted.',
      '',
      ...lines.slice(at),
      '',
      '## 4. A section added below',
    ].join('\n')
    expect(problem(padded, FIRST)).toBeUndefined()
  })

  it('stays resolved when the passage is re-wrapped or the file has CRLF endings', () => {
    const rewrapped = SMALL.replace(
      'Money stays exact from the wire to the\nledger;',
      'Money stays exact\nfrom the wire\nto the ledger;',
    )
    expect(rewrapped).not.toBe(SMALL)
    expect(problem(rewrapped, FIRST)).toBeUndefined()
    expect(problem(SMALL.replaceAll('\n', '\r\n'), FIRST)).toBeUndefined()
  })

  it('fails when the phrase is deleted or reworded', () => {
    const deleted = SMALL.replace('Money stays exact from the wire to the\nledger; a', 'A')
    expect(deleted).not.toBe(SMALL)
    expect(problem(deleted, FIRST)).toBe(
      'the phrase "Money stays exact from the wire to the ledger" is not in PLAN.md',
    )
    expect(problem(SMALL.replace('stays exact', 'is exact'), FIRST)).toBe(
      'the phrase "Money stays exact from the wire to the ledger" is not in PLAN.md',
    )
  })

  it('fails when the phrase is in PLAN.md twice, wherever the second one is', () => {
    const twice = `${SMALL}\nMoney stays exact from the wire to the ledger, again.\n`
    expect(problem(twice, FIRST)).toBe(
      'the phrase "Money stays exact from the wire to the ledger" is in PLAN.md 2 times',
    )
  })

  it('fails when the phrase moved to another section', () => {
    const moved = SMALL.replace('Money stays exact from the wire to the\nledger; a', 'A').replace(
      'Nothing is open',
      'Money stays exact from the wire to the ledger. Nothing is open',
    )
    expect(problem(moved, FIRST)).toBe(
      'the phrase "Money stays exact from the wire to the ledger" is not under "### D1 — First decision"',
    )
  })

  it('fails when the heading is gone, renamed or written twice', () => {
    expect(problem(SMALL.replace('### D1 — First decision', '### D1 — Renamed'), FIRST)).toBe(
      'the heading "### D1 — First decision" is not in PLAN.md',
    )
    // The fenced copy of D2's heading is code, not a second heading.
    const second: PlanCitation = {
      heading: '### D2 — Second decision',
      phrase: 'Paid calls ask first, in every mode, each time.',
    }
    expect(problem(SMALL, second)).toBeUndefined()
    expect(problem(`${SMALL}\n### D2 — Second decision\n`, second)).toBe(
      'the heading "### D2 — Second decision" is in PLAN.md 2 times',
    )
  })

  it('refuses a heading that is not one and a phrase too short to mean anything', () => {
    expect(problem(SMALL, { heading: 'D1 — First decision', phrase: FIRST.phrase })).toBe(
      '"D1 — First decision" is not a Markdown heading line',
    )
    const short = 'x'.repeat(PLAN_CITATION_MIN_PHRASE - 1)
    expect(problem(`${SMALL}\n${short}\n`, { heading: FIRST.heading, phrase: short })).toBe(
      `the phrase is shorter than ${String(PLAN_CITATION_MIN_PHRASE)} characters`,
    )
  })
})
