import { describe, expect, it, vi } from 'vitest'
import { REPORT_KINDS, REPORT_MAX_ID_CHARS, REPORT_MAX_ROWS } from '../../src/shared/constants'
import {
  reportDocumentSchema,
  type ReportDocument,
  type ReportRow,
  type ReportValue,
} from '../../src/shared/reportSchema'
import { readPlan } from '../../src/core/reporting/plan/reader'
import {
  compare,
  dedupeRowKeys,
  dedupeUnknownRowKeys,
} from '../../src/core/reporting/collect/common'
import { compareReports } from '../../src/core/reporting/diff'
import type {
  PlanFacts,
  PlanMilestone,
  SourceSnapshot,
} from '../../src/core/reporting/sources/types'
import { collectFixture, fullSnapshot, getSection } from './helpers/reporting/collect'
import { availableSource } from './helpers/reporting/snapshot'
import { PLAN_FORMAT_FIXTURE } from './helpers/reporting/plans'

type ReportKind = (typeof REPORT_KINDS)[number]

interface RowIdentityCase {
  readonly kind: ReportKind
  /** Table name; the two reviewer scenarios appear under their fixture names. */
  readonly name: string
  readonly scope?: string
  readonly mutate: (snapshot: SourceSnapshot) => SourceSnapshot
  /** Both records stay visible. */
  readonly records: (document: ReportDocument) => void
  /** Expected plan-drift code shown in the planFormat section, if any. */
  readonly drift?: string
}

function textCells(document: ReportDocument, sectionId: string, cell = 'name'): string[] {
  return getSection(document, sectionId)
    .rows.map((row) => row.cells[cell])
    .filter(
      (cell): cell is Extract<ReportValue, { readonly type: 'text'; readonly value: string }> =>
        cell?.type === 'text',
    )
    .map((cell) => cell.value)
}

function needsYouNames(document: ReportDocument): string[] {
  return document.needsYou.rows
    .map((row) => row.cells['name'])
    .filter(
      (cell): cell is Extract<ReportValue, { readonly type: 'text'; readonly value: string }> =>
        cell?.type === 'text',
    )
    .map((cell) => cell.value)
}

const duplicatePlanQuestions: PlanFacts['questions'] = [
  { id: 'Q-DUP', text: 'First body', milestoneIds: ['M12'], state: 'open' },
  { id: 'Q-DUP', text: 'Second body', milestoneIds: ['M12'], state: 'open' },
]

function withPlan(snapshot: SourceSnapshot, patch: Partial<PlanFacts>): SourceSnapshot {
  return {
    ...snapshot,
    sources: {
      ...snapshot.sources,
      plan: availableSource('plan', {
        ...snapshot.sources.plan.data!,
        ...patch,
      }),
    },
  }
}

function withPlanQuestions(
  snapshot: SourceSnapshot,
  questions: PlanFacts['questions'],
): SourceSnapshot {
  return withPlan(snapshot, { questions })
}

function withMilestone(snapshot: SourceSnapshot, patch: Partial<PlanMilestone>): SourceSnapshot {
  return withPlan(snapshot, {
    milestones: snapshot.sources.plan.data!.milestones.map((entry) =>
      entry.id === 'M12' ? { ...entry, ...patch } : entry,
    ),
  })
}

function duplicateLaneSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  const lane = snapshot.sources.plan.data!.milestones[0]!.lanes[0]!
  return withMilestone(snapshot, { lanes: [lane, { ...lane }] })
}

function duplicateGithubReleaseSnapshot(
  snapshot: SourceSnapshot,
  assets?: readonly string[],
): SourceSnapshot {
  const github = snapshot.sources.github.data!
  const release = github.releases[0]!
  return {
    ...snapshot,
    sources: {
      ...snapshot.sources,
      github: availableSource('github', {
        ...github,
        releases: [release, { ...release, assets: assets ?? release.assets }],
      }),
    },
  }
}

/** PLAN_FORMAT_FIXTURE with `### M110a0` rewritten to `### M12` (RVCM1132E scenario 1). */
function milestoneDuplicateSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  return {
    ...snapshot,
    sources: {
      ...snapshot.sources,
      plan: availableSource(
        'plan',
        readPlan(PLAN_FORMAT_FIXTURE.replace('### M110a0', '### M12')).facts,
      ),
    },
  }
}

/** PLAN_FORMAT_FIXTURE plus a second `### 0.14.2` block (RVCM1132E scenario 2). */
function releaseDuplicateSnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  const heading =
    PLAN_FORMAT_FIXTURE.split('\n').find((line) => line.startsWith('### 0.14.2')) ?? ''
  return {
    ...snapshot,
    sources: {
      ...snapshot.sources,
      plan: availableSource(
        'plan',
        readPlan(
          `${PLAN_FORMAT_FIXTURE}${heading.replace('2026-10-05', '2026-10-06')}\nA second record.\n`,
        ).facts,
      ),
    },
  }
}

const cases: readonly RowIdentityCase[] = [
  {
    kind: 'project',
    name: 'PLAN_FORMAT_FIXTURE with ### M110a0 rewritten to ### M12',
    mutate: milestoneDuplicateSnapshot,
    records: (document) => {
      expect(textCells(document, 'milestones').filter((name) => name === 'M12')).toHaveLength(2)
    },
    drift: 'milestone-duplicate',
  },
  {
    kind: 'project',
    name: 'duplicated plan question id stays twice in needs you',
    mutate: (snapshot) => withPlanQuestions(snapshot, duplicatePlanQuestions),
    records: (document) => {
      expect(needsYouNames(document).filter((name) => name === 'Q-DUP')).toHaveLength(2)
    },
  },
  {
    kind: 'project',
    name: 'duplicated plan risk keeps both risk rows',
    mutate: (snapshot) => {
      const plan = snapshot.sources.plan.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          plan: availableSource('plan', {
            ...plan,
            risks: [
              { id: 'R-DUP', text: 'First risk', milestoneIds: ['M12'] },
              { id: 'R-DUP', text: 'Second risk', milestoneIds: ['M12'] },
            ],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'risks').filter((name) => name === 'R-DUP')).toHaveLength(2)
    },
  },
  {
    kind: 'project',
    name: 'duplicated plan residual keeps both residual rows',
    mutate: (snapshot) => {
      const plan = snapshot.sources.plan.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          plan: availableSource('plan', {
            ...plan,
            residuals: [
              { id: 'R1', text: 'First residual' },
              { id: 'R1', text: 'Second residual' },
            ],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'risks').filter((name) => name === 'R1')).toHaveLength(2)
    },
  },
  {
    kind: 'project',
    name: 'duplicated lane triple keeps both lane rows',
    mutate: duplicateLaneSnapshot,
    records: (document) => {
      expect(textCells(document, 'lanes').filter((name) => name === 'K')).toHaveLength(2)
    },
  },
  {
    kind: 'project',
    name: 'duplicated store channel keeps both channel rows',
    mutate: (snapshot) => {
      const stores = snapshot.sources.stores.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          stores: availableSource('stores', [stores[0]!, { ...stores[0]! }]),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'channels').filter((name) => name === 'npm')).toHaveLength(2)
    },
  },
  {
    kind: 'project',
    name: 'duplicated pull request number keeps both pull request rows',
    mutate: (snapshot) => {
      const github = snapshot.sources.github.data!
      const pull = github.pullRequests[0]!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          github: availableSource('github', {
            ...github,
            pullRequests: [pull, { ...pull, title: 'A second listing' }],
          }),
        },
      }
    },
    records: (document) => {
      expect(getSection(document, 'pullRequests').rows).toHaveLength(2)
    },
  },
  {
    kind: 'milestone',
    name: 'duplicated question bodies stay visible, including a byte-identical pair',
    mutate: (snapshot) =>
      withPlanQuestions(snapshot, [
        ...duplicatePlanQuestions,
        { id: 'Q-SAME', text: 'Same body', milestoneIds: ['M12'], state: 'open' },
        { id: 'Q-SAME', text: 'Same body', milestoneIds: ['M12'], state: 'open' },
      ]),
    records: (document) => {
      expect(getSection(document, 'milestoneQuestions').rows).toHaveLength(4)
    },
  },
  {
    kind: 'milestone',
    name: 'duplicated lane triple keeps every lane row',
    mutate: duplicateLaneSnapshot,
    records: (document) => {
      expect(getSection(document, 'milestoneLanes').rows).toHaveLength(2)
    },
  },
  {
    kind: 'milestone',
    name: 'repeated checklist text keeps every checklist row',
    mutate: (snapshot) =>
      withMilestone(snapshot, {
        checklist: [
          { text: 'Same line', done: true },
          { text: 'Same line', done: false },
          { text: 'Same line', done: true },
        ],
      }),
    records: (document) => {
      expect(textCells(document, 'checklist')).toEqual(['Same line', 'Same line', 'Same line'])
    },
  },
  {
    kind: 'milestone',
    name: 'duplicated dependency id keeps both dependency rows',
    mutate: (snapshot) => withMilestone(snapshot, { dependencies: ['M1', 'M1'] }),
    records: (document) => {
      expect(getSection(document, 'milestoneDependencies').rows).toHaveLength(2)
    },
  },
  {
    kind: 'milestone',
    name: 'duplicated gate name keeps both gate rows',
    mutate: (snapshot) => withMilestone(snapshot, { requiredGates: ['quality', 'quality'] }),
    records: (document) => {
      expect(
        textCells(document, 'gateDeclarations').filter((name) => name === 'quality'),
      ).toHaveLength(2)
    },
  },
  {
    kind: 'release',
    name: 'PLAN_FORMAT_FIXTURE with a second ### 0.14.2 — 2026-10-06 block',
    scope: '0.14.2',
    mutate: releaseDuplicateSnapshot,
    records: (document) => {
      expect(textCells(document, 'releaseRecord', 'version')).toEqual(['0.14.2', '0.14.2'])
    },
    drift: 'release-duplicate',
  },
  {
    kind: 'release',
    name: 'two GitHub releases share one version with different assets',
    mutate: (snapshot) => duplicateGithubReleaseSnapshot(snapshot, ['other.vsix']),
    records: (document) => {
      expect(textCells(document, 'assets')).toEqual(['v0.14.2', 'v0.14.2'])
    },
  },
  {
    kind: 'release',
    name: 'two GitHub releases share one version and the same assets',
    mutate: duplicateGithubReleaseSnapshot,
    records: (document) => {
      expect(getSection(document, 'assets').rows).toHaveLength(2)
    },
  },
  {
    kind: 'release',
    name: 'duplicated changelog version and line keeps both line rows',
    mutate: (snapshot) => {
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          changelog: availableSource('changelog', {
            sections: [
              { version: 'Unreleased', date: null, lines: ['Kept change'] },
              { version: '0.14.2', date: '2026-10-05', lines: ['Same line'] },
              { version: '0.14.2', date: '2026-10-05', lines: ['Same line'] },
            ],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'changelog')).toEqual(['Same line', 'Same line'])
    },
  },
  {
    kind: 'release',
    name: 'duplicated tag name keeps both tag rows',
    mutate: (snapshot) => {
      const git = snapshot.sources.git.data!
      const tag = git.tags[0]!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          git: availableSource('git', { ...git, tags: [tag, { ...tag }] }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'tag')).toEqual(['v0.14.2', 'v0.14.2'])
    },
  },
  {
    kind: 'session',
    name: 'duplicated registry question keeps both question rows',
    mutate: (snapshot) => {
      const questions = snapshot.sources.questions.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          questions: availableSource('questions', [
            ...questions,
            { id: 'q-current', text: 'A second body', milestoneIds: [], state: 'open' as const },
          ]),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'questions').filter((name) => name === 'q-current')).toHaveLength(
        2,
      )
    },
  },
  {
    kind: 'session',
    name: 'duplicated check runs keep every check row',
    mutate: (snapshot) => {
      const checkRuns = snapshot.sources.checkRuns.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          checkRuns: availableSource('checkRuns', [...checkRuns, { ...checkRuns[1]! }]),
        },
      }
    },
    records: (document) => {
      expect(getSection(document, 'checks').rows).toHaveLength(3)
    },
  },
  {
    kind: 'usage',
    name: 'duplicated breakdown key keeps both breakdown rows',
    mutate: (snapshot) => {
      const usage = snapshot.sources.usage.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          usage: availableSource('usage', {
            ...usage,
            breakdown: [...usage.breakdown, { ...usage.breakdown[0]! }],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'breakdown')).toEqual(['fixture-model', 'fixture-model'])
    },
  },
  {
    kind: 'usage',
    name: 'duplicated limit key keeps both limit rows',
    mutate: (snapshot) => {
      const usage = snapshot.sources.usage.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          usage: availableSource('usage', {
            ...usage,
            limits: [...usage.limits, { ...usage.limits[0]! }],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'limits')).toEqual(['daily-budget', 'daily-budget'])
    },
  },
  {
    kind: 'usage',
    name: 'duplicated agent usage file keeps both agent rows',
    mutate: (snapshot) => {
      const agentUsage = snapshot.sources.agentUsage.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          agentUsage: availableSource('agentUsage', [...agentUsage, { ...agentUsage[0]! }]),
        },
      }
    },
    records: (document) => {
      expect(getSection(document, 'agentUsage').rows).toHaveLength(2)
    },
  },
  {
    kind: 'changes',
    name: 'duplicated commit sha keeps both commit rows',
    mutate: (snapshot) => {
      const git = snapshot.sources.git.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          git: availableSource('git', {
            ...git,
            commits: [...git.commits, { ...git.commits[0]! }],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'commits', 'commit').filter((sha) => sha === 'head')).toHaveLength(
        2,
      )
    },
  },
  {
    kind: 'changes',
    name: 'duplicated Unreleased changelog line keeps both line rows',
    mutate: (snapshot) => ({
      ...snapshot,
      sources: {
        ...snapshot.sources,
        changelog: availableSource('changelog', {
          sections: [
            { version: 'Unreleased', date: null, lines: ['Same line'] },
            { version: 'Unreleased', date: null, lines: ['Same line'] },
          ],
        }),
      },
    }),
    records: (document) => {
      expect(textCells(document, 'changelog')).toEqual(['Same line', 'Same line'])
    },
  },
  {
    kind: 'changes',
    name: 'duplicated pull request number keeps both pull request rows',
    mutate: (snapshot) => {
      const github = snapshot.sources.github.data!
      const pull = github.pullRequests[0]!
      const merged = { ...pull, isMerged: true as const }
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          github: availableSource('github', {
            ...github,
            pullRequests: [merged, { ...merged, title: 'A second listing' }],
          }),
        },
      }
    },
    records: (document) => {
      expect(getSection(document, 'pullRequests').rows).toHaveLength(2)
    },
  },
  {
    kind: 'quality',
    name: 'duplicated package script names keep both gate and missing-run rows',
    mutate: (snapshot) => {
      const pkg = snapshot.sources.package.data!
      const script = pkg.qualityScripts.find((entry) => entry.name === 'check:reference')!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          package: availableSource('package', {
            qualityScripts: [...pkg.qualityScripts, { ...script }],
          }),
        },
      }
    },
    records: (document) => {
      expect(
        textCells(document, 'gates').filter((name) => name === 'check:reference'),
      ).toHaveLength(2)
      expect(
        textCells(document, 'lastLocalRuns').filter((name) => name === 'check:reference'),
      ).toHaveLength(2)
    },
  },
  {
    kind: 'quality',
    name: 'duplicated certification path keeps both certification rows',
    mutate: (snapshot) => {
      const certification = snapshot.sources.certification.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          certification: availableSource('certification', {
            records: [...certification.records, { ...certification.records[0]! }],
          }),
        },
      }
    },
    records: (document) => {
      expect(getSection(document, 'certification').rows).toHaveLength(2)
    },
  },
  {
    kind: 'quality',
    name: 'duplicated CI runs keep every CI row',
    mutate: (snapshot) => {
      const github = snapshot.sources.github.data!
      return {
        ...snapshot,
        sources: {
          ...snapshot.sources,
          github: availableSource('github', {
            ...github,
            runs: [...github.runs, { ...github.runs[1]! }],
          }),
        },
      }
    },
    records: (document) => {
      expect(textCells(document, 'ci').filter((name) => name === 'Quality')).toHaveLength(3)
    },
  },
]

const forwardedKinds = [
  ['fleet', 'duplicated fleet rows stay visible'],
  ['security', 'duplicated security rows stay visible'],
  ['accounts', 'duplicated account rows stay visible'],
  ['estimate', 'duplicated estimate rows stay visible'],
  ['playbook', 'duplicated playbook decision rows stay visible'],
  ['issues', 'duplicated issue rows stay visible'],
  ['schedules', 'duplicated schedule rows stay visible'],
  ['keybindings', 'duplicated keybinding rows stay visible'],
] as const satisfies readonly (readonly [ReportKind, string])[]

function withDoubledForwardedRows(
  snapshot: SourceSnapshot,
  kind: (typeof forwardedKinds)[number][0],
): SourceSnapshot {
  const current = snapshot.sources[kind]
  if (current.data === null) return snapshot
  const data = current.data.map((section) => ({
    ...section,
    rows: [...section.rows, ...section.rows],
  }))
  const doubled = availableSource(current.record.id, data)
  switch (kind) {
    case 'fleet': {
      return { ...snapshot, sources: { ...snapshot.sources, fleet: doubled } }
    }
    case 'security': {
      return { ...snapshot, sources: { ...snapshot.sources, security: doubled } }
    }
    case 'accounts': {
      return { ...snapshot, sources: { ...snapshot.sources, accounts: doubled } }
    }
    case 'estimate': {
      return { ...snapshot, sources: { ...snapshot.sources, estimate: doubled } }
    }
    case 'playbook': {
      return { ...snapshot, sources: { ...snapshot.sources, playbook: doubled } }
    }
    case 'issues': {
      return { ...snapshot, sources: { ...snapshot.sources, issues: doubled } }
    }
    case 'schedules': {
      return { ...snapshot, sources: { ...snapshot.sources, schedules: doubled } }
    }
    case 'keybindings': {
      return { ...snapshot, sources: { ...snapshot.sources, keybindings: doubled } }
    }
    default: {
      return snapshot
    }
  }
}

const forwarded: readonly RowIdentityCase[] = forwardedKinds.map(([kind, name]) => ({
  kind,
  name,
  mutate: (snapshot) => withDoubledForwardedRows(snapshot, kind),
  records: (document) => {
    const source = fullSnapshot().sources[kind]
    if (source.data === null) throw new Error(`Missing fixture source ${kind}`)
    for (const section of source.data) {
      expect(getSection(document, section.id).rows).toHaveLength(section.rows.length * 2)
    }
  },
}))

const table: readonly RowIdentityCase[] = [...cases, ...forwarded]

describe('report row identity', () => {
  it('narrows only row keys while retaining malformed shapes for schema rejection', () => {
    const invalid = [null, 'row', {}, { key: 1 }, { rows: null }]
    const section = { rows: [...invalid, { key: 'k', extra: true }, { key: 'k', extra: false }] }
    expect(dedupeUnknownRowKeys([null, 'section', {}, { rows: null }, section])).toEqual([
      null,
      'section',
      {},
      { rows: null },
      { rows: [...invalid, { key: 'k', extra: true }, { key: 'k/2', extra: false }] },
    ])
    expect(section.rows.at(-1)).toEqual({ key: 'k', extra: false })
    for (const value of invalid) expect(dedupeUnknownRowKeys(value)).toBe(value)
  })

  it.each([true, false])('reserves later original keys and saved identities (full=%s)', (full) => {
    const snapshot = fullSnapshot()
    const facet = snapshot.sources.fleet.data![0]!
    const first: ReportRow = { ...facet.rows[0]!, key: 'fleet/item' }
    const legitimate: ReportRow = { ...facet.rows[1]!, key: 'fleet/item/2' }
    const duplicate: ReportRow = {
      ...first,
      cells: { detail: { type: 'text', value: 'duplicate' } },
    }
    const collect = (rows: ReportRow[]) =>
      collectFixture(
        'fleet',
        { full },
        {
          ...snapshot,
          sources: { ...snapshot.sources, fleet: availableSource('fleet', [{ ...facet, rows }]) },
        },
      )
    const before = collect([first, legitimate])
    const after = collect([first, duplicate, legitimate])
    const result = getSection(after, facet.id).rows
    expect(result.find((row) => row.key === legitimate.key)).toEqual(
      getSection(before, facet.id).rows.find((row) => row.key === legitimate.key),
    )
    expect(result.find((row) => row.cells['detail']?.value === 'duplicate')?.key).toBe(
      'fleet/item/3',
    )
    const diff = compareReports(before, after).sections.find((section) => section.id === facet.id)!
    expect(diff).toMatchObject({ changed: [], removed: [], unchangedRows: 2 })
    expect(diff.added).toHaveLength(1)
    const raw = dedupeRowKeys([first, duplicate, legitimate])
    expect(raw[0]).toBe(first)
    expect(raw[2]).toBe(legitimate)
    expect(dedupeUnknownRowKeys([{ ...facet, rows: [first, duplicate, legitimate] }])).toEqual([
      { ...facet, rows: raw },
    ])
    expect(dedupeRowKeys(raw)).toEqual(raw)
  })

  it('preserves maximum-length originals sharing a truncated suffix stem', () => {
    const stem = 'k'.repeat(REPORT_MAX_ID_CHARS - String(Number.MAX_SAFE_INTEGER).length - 1)
    const first: ReportRow = {
      key: `${stem}${'a'.repeat(REPORT_MAX_ID_CHARS - stem.length)}`,
      cells: { name: { type: 'text', value: 'first' } },
      sourceIds: [],
    }
    const second = { ...first, key: `${stem}${'b'.repeat(REPORT_MAX_ID_CHARS - stem.length)}` }
    const reserved = { ...first, key: `${stem}/2` }
    const rows = [first, first, second, second, reserved]
    const result = dedupeRowKeys(rows)
    expect(result.map((row) => row.key)).toEqual([
      first.key,
      `${stem}/3`,
      second.key,
      `${stem}/4`,
      reserved.key,
    ])
    expect(rows).toEqual([first, first, second, second, reserved])
  })

  it.each(['repeated', 'suffix-chain', 'shared-stem'] as const)(
    'bounds counted allocation probes for 20,000 %s rows',
    (shape) => {
      const base: ReportRow = {
        key: 'k',
        cells: { name: { type: 'text', value: 'row' } },
        sourceIds: [],
      }
      const stem = 'k'.repeat(REPORT_MAX_ID_CHARS - String(Number.MAX_SAFE_INTEGER).length - 1)
      let chain = 'k'
      const rows = Array.from({ length: REPORT_MAX_ROWS }, (_, index) => {
        if (shape === 'repeated') return base
        if (shape === 'shared-stem')
          return { ...base, key: `${stem}/${String(Math.floor(index / 2))}` }
        // Include a duplicate before the nested originals; the raw pre-parse
        // allocator also sees overlong keys before schema rejection.
        if (index > 1) chain += '/2'
        return { ...base, key: chain }
      })
      const originalHas = Set.prototype.has
      let probes = 0
      const limit = rows.length * 4
      const spy = vi.spyOn(Set.prototype, 'has').mockImplementation(function (
        this: Set<unknown>,
        value: unknown,
      ) {
        probes += 1
        // Abort a quadratic regression promptly, before it can freeze the host.
        if (probes > limit) throw new Error(`Allocation probe budget exceeded: ${String(probes)}`)
        return originalHas.call(this, value)
      })
      let result: ReportRow[]
      try {
        result = dedupeRowKeys(rows)
      } finally {
        spy.mockRestore()
      }
      expect(probes).toBeLessThanOrEqual(limit)
      expect(new Set(result.map((row) => row.key)).size).toBe(rows.length)
      const originals = new Set(rows)
      for (const row of result) {
        if (!originals.has(row)) expect(row.key.length).toBeLessThanOrEqual(REPORT_MAX_ID_CHARS)
      }
    },
  )

  it('covers every report kind in the table', () => {
    expect([...new Set(table.map((testCase) => testCase.kind))].toSorted(compare)).toEqual(
      [...REPORT_KINDS].toSorted(compare),
    )
  })

  it.each(table)('$kind row identity: $name', (testCase) => {
    for (const isFull of [true, false]) {
      const snapshot = testCase.mutate(fullSnapshot())
      const options = {
        full: isFull,
        ...(testCase.scope !== undefined && { scope: testCase.scope }),
      }
      const document = collectFixture(testCase.kind, options, snapshot)
      expect(() => reportDocumentSchema.parse(document)).not.toThrow()
      for (const section of document.sections) {
        expect(new Set(section.rows.map((row) => row.key)).size).toBe(section.rows.length)
      }
      expect(new Set(document.needsYou.rows.map((row) => row.key)).size).toBe(
        document.needsYou.rows.length,
      )
      testCase.records(document)
      if (testCase.drift !== undefined) {
        expect(textCells(document, 'planFormat')).toContain(testCase.drift)
      }
      expect(JSON.stringify(collectFixture(testCase.kind, options, snapshot))).toBe(
        JSON.stringify(document),
      )
    }
  })
})
