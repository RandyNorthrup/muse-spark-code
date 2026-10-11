// The public roadmap generator's rules (M122), run on in-memory PLAN.md,
// CHANGELOG.md and entries.json fixtures through the real PLAN reader.
import { describe, expect, it } from 'vitest'
import { generateRoadmap, staleReason } from '../../scripts/lib/roadmap.mjs'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { findMilestone } from '../../src/core/reporting/plan/selection'
import { REPORT_EXIT_CODES, REPORT_PLAN_MAX_BYTES } from '../../src/shared/constants'

const plan = {
  readPlan,
  findMilestone,
  generatedCode: REPORT_EXIT_CODES.generated,
  maxBytes: REPORT_PLAN_MAX_BYTES,
}
const MILESTONES = [
  ['M1', 'released'],
  ['M2', 'built'],
  ['M3', 'built'],
  ['M4', 'planned'],
  ['M5', 'building'],
  ['SECFIX', 'complete'],
]
const RECORDS = [
  '**0.17.0 preparation (2026-10-08, release branch).** Being prepared.',
  '**0.18.0 preparation (2026-10-09, release branch).** Being prepared.',
]
const HEADINGS = [
  ['0.18.0', '2026-10-09'],
  ['0.17.0', '2026-10-08'],
  ['0.16.0', '2026-10-07'],
]
const ENTRIES = [
  {
    id: 'M1',
    title: 'Older feature',
    summary: 'Something that shipped before.',
    area: 'chat',
    release: '0.16.0',
  },
  {
    id: 'M2',
    title: 'Prepared feature',
    summary: 'Something merged for the older release being prepared.',
    area: 'chat',
    release: '0.17.0',
  },
  {
    id: 'M3',
    title: 'Newer feature',
    summary: 'Something merged for the newer release being prepared.',
    area: 'agents',
    release: '0.18.0',
  },
  { id: 'M4', title: 'Planned feature', summary: 'Something not started.', area: 'platform' },
  {
    id: 'M5',
    title: 'Growing feature',
    summary: 'Something partly merged.',
    area: 'platform',
    release: '0.17.0',
  },
  { id: 'SECFIX', public: false, note: 'repair round covered by M2' },
]

function planText(milestones, records) {
  return [
    '# Fixture plan',
    '',
    '## 6. Milestones',
    '',
    ...milestones.flatMap(([id, status, date = '2026-10-01', title = 'Fixture (2026-10-01)']) => [
      `### ${id} — ${title}`,
      `**Status ${date}: ${status}.**`,
      '',
    ]),
    '## 10. Definition of done and release records',
    '',
    ...records.flatMap((record) => [record, '']),
  ].join('\n')
}

function changelogText(headings) {
  return [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    ...headings.flatMap(([version, date]) => [`## [${version}] - ${date}`, '', '- Fixture.', '']),
  ].join('\n')
}

function generate({
  milestones = MILESTONES,
  records = RECORDS,
  headings = HEADINGS,
  entries = ENTRIES,
} = {}) {
  return generateRoadmap({
    planText: planText(milestones, records),
    changelogText: changelogText(headings),
    entriesText: JSON.stringify({ about: 'Fixture entries.', entries }),
    plan,
    format: (markdown) => Promise.resolve(markdown),
  })
}

function withEntry(id, change) {
  return ENTRIES.map((entry) => (entry.id === id ? { ...entry, ...change } : entry))
}

/** The text under a `## ` heading, up to the next one. */
function section(content, heading) {
  const start = content.indexOf(`\n## ${heading}\n`)
  if (start === -1) return null
  const end = content.indexOf('\n## ', start + 1)
  return content.slice(start, end === -1 ? undefined : end)
}

describe('gen-roadmap', () => {
  it('is wired into quality:gates as check:roadmap', async () => {
    const { readFile } = await import('node:fs/promises')
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts['check:roadmap']).toBe('node scripts/gen-roadmap.mjs --check')
    expect(pkg.scripts['quality:gates']).toContain('check:roadmap')
  })

  describe('releases being prepared', () => {
    it('lists every prepared, unreleased version in its own next-release section, oldest first', async () => {
      const { content, problems } = await generate()
      expect(problems).toEqual([])
      expect(section(content, 'In the next release (0.17.0)')).toContain('**Prepared feature**')
      expect(section(content, 'In the next release (0.17.0)')).not.toContain('Newer feature')
      expect(section(content, 'In the next release (0.18.0)')).toContain('**Newer feature**')
      expect(content.indexOf('## In the next release (0.17.0)')).toBeLessThan(
        content.indexOf('## In the next release (0.18.0)'),
      )
      expect(content).toContain(
        '[In the next release (0.17.0)](#in-the-next-release-0170) · [In the next release (0.18.0)](#in-the-next-release-0180)',
      )
      expect(section(content, 'In progress')).toContain(
        'Something partly merged. _First parts are in the next release (0.17.0)._',
      )
      const shipped = section(content, 'Shipped')
      expect(shipped).toContain('### 0.16.0 (2026-10-07)')
      expect(shipped).not.toContain('0.17.0')
      expect(shipped).not.toContain('0.18.0')
    })

    it('moves a version under Shipped once PLAN records its release', async () => {
      const { content, problems } = await generate({
        records: [...RECORDS, '**0.17.0 released (2026-10-10, tag `v0.17.0`).** Published.'],
      })
      expect(problems).toEqual([])
      expect(section(content, 'In the next release (0.17.0)')).toBeNull()
      expect(section(content, 'In the next release (0.18.0)')).toContain('**Newer feature**')
      expect(section(content, 'Shipped')).toContain('### 0.17.0 (2026-10-08)')
      expect(section(content, 'Shipped')).toContain('**Prepared feature**')
      expect(section(content, 'In progress')).toContain('_First parts shipped in 0.17.0._')
    })

    it('refuses a prepared version with no dated changelog heading', async () => {
      const { content, problems } = await generate({
        records: [...RECORDS, '**0.19.0 preparation (2026-10-10, draft).** Being prepared.'],
      })
      expect(problems).toContain(
        'PLAN.md §10 prepares 0.19.0, but CHANGELOG.md has no dated 0.19.0 heading',
      )
      expect(content).toBe('')
    })
  })

  describe('public text', () => {
    it.each([
      ['summary', 'Works alongside m2 now.', 'm2'],
      ['summary', 'Covered by SECFIX.', 'SECFIX'],
      ['summary', 'Covered by secfix.', 'secfix'],
      ['summary', 'Follows M3.', 'M3'],
      ['title', 'Like m4', 'm4'],
    ])('rejects a known milestone or working id in the %s (%s)', async (key, text, token) => {
      const { content, problems } = await generate({ entries: withEntry('M1', { [key]: text }) })
      expect(problems).toContain(`M1: "${key}" names the milestone or working id ${token}`)
      expect(content).toBe('')
    })

    it('still rejects unknown milestone and decision numbers', async () => {
      const { problems } = await generate({
        entries: withEntry('M1', { summary: 'Decided in D12 for M99.' }),
      })
      expect(problems).toContain('M1: "summary" names a milestone or decision id')
    })

    it('accepts words that only contain an id, and ids in internal notes', async () => {
      const { problems } = await generate({
        entries: withEntry('M1', { summary: 'A secfixer and an m2x stay ordinary words.' }),
      })
      expect(problems).toEqual([])
    })
  })

  describe('malformed entries', () => {
    it.each([
      ['missing', { title: 'No id', summary: 'Nothing.', area: 'chat' }],
      ['a number', { id: 2, title: 'Number id', summary: 'Nothing.', area: 'chat' }],
      ['untrimmed', { id: ' M2', title: 'Spaced id', summary: 'Nothing.', area: 'chat' }],
      ['empty', { id: '', title: 'Empty id', summary: 'Nothing.', area: 'chat' }],
    ])('reports an id that is %s as a malformed entry instead of failing', async (_, bad) => {
      const { content, problems } = await generate({ entries: [...ENTRIES, bad] })
      expect(problems).toContain(
        'entries.json entry 7: "id" must be a non-empty trimmed string naming a PLAN.md milestone',
      )
      expect(content).toBe('')
    })
  })

  describe('source fingerprint', () => {
    const MUTATIONS = [
      [
        'a milestone status date',
        {
          milestones: MILESTONES.map((row) =>
            row[0] === 'M2' ? ['M2', 'built', '2026-10-05'] : row,
          ),
        },
      ],
      [
        'a milestone heading date',
        {
          milestones: MILESTONES.map((row) =>
            row[0] === 'M2' ? ['M2', 'built', '2026-10-01', 'Fixture (2026-10-02)'] : row,
          ),
        },
      ],
      [
        'a status that is listed the same way',
        { milestones: MILESTONES.map((row) => (row[0] === 'M2' ? ['M2', 'complete'] : row)) },
      ],
      [
        'a release record date',
        { records: [RECORDS[0].replace('2026-10-08', '2026-10-07'), RECORDS[1]] },
      ],
      [
        'a changelog heading with nothing listed',
        { headings: [...HEADINGS, ['0.15.0', '2026-10-01']] },
      ],
      ['an internal note', { entries: withEntry('SECFIX', { note: 'another repair round' }) }],
    ]

    it.each(MUTATIONS)(
      'changes when %s changes, even though the listing reads the same',
      async (_, change) => {
        const before = await generate()
        const after = await generate(change)
        expect(after.problems).toEqual([])
        expect(after.content).not.toBe(before.content)
        const changed = after.content
          .split('\n')
          .filter((line, index) => line !== before.content.split('\n')[index])
        expect(changed).toHaveLength(1)
        expect(changed[0]).toMatch(/^<!-- Source fingerprint: [\da-f]{64} -->$/)
        expect(staleReason(before.content, after.content)).toBe(
          'ROADMAP.md was generated from other PLAN.md, CHANGELOG.md or docs/roadmap/entries.json facts (its source fingerprint differs); run npm run roadmap:generate',
        )
      },
    )

    it('is the same for the same inputs', async () => {
      const first = await generate()
      const second = await generate()
      expect(second.content).toBe(first.content)
    })
  })

  describe('the gate', () => {
    it('passes a current file and names the first stale line otherwise', async () => {
      const { content } = await generate()
      expect(staleReason(content, content)).toBeNull()
      const edited = content.replace('Something that shipped before.', 'Edited by hand.')
      const line = content.split('\n').findIndex((text) => text.includes('shipped before')) + 1
      expect(staleReason(edited, content)).toBe(
        `ROADMAP.md is stale from line ${String(line)}; run npm run roadmap:generate`,
      )
      expect(staleReason('', content)).toBe(
        'ROADMAP.md is stale from line 1; run npm run roadmap:generate',
      )
    })

    it('refuses a PLAN milestone without an entry', async () => {
      const { content, problems } = await generate({
        entries: ENTRIES.filter(({ id }) => id !== 'M4'),
      })
      expect(problems).toContain(
        'M4: PLAN.md milestone has no entry in docs/roadmap/entries.json (add one; internal work uses "public": false)',
      )
      expect(content).toBe('')
    })

    it('refuses an entry for a milestone PLAN.md does not have', async () => {
      const { content, problems } = await generate({
        entries: [...ENTRIES, { id: 'M99', public: false, note: 'unknown' }],
      })
      expect(
        problems.some((problem) => problem.startsWith('M99: PLAN.md has no such milestone')),
      ).toBe(true)
      expect(content).toBe('')
    })
  })
})
