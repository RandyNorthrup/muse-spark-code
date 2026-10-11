import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  REPORT_KINDS,
  REPORT_SECTION_ROWS,
  REPORT_GIT_MAX_COMMITS,
  REPORT_SOURCE_TIMEOUT_MS,
  REPORT_GITHUB_RATE_FLOOR,
  REPORT_CHECK_RUNS_MAX,
  REPORT_HISTORY_MAX_PER_KIND,
  REPORT_LOCAL_BUDGET_MS,
  REPORT_PLAN_BUDGET_MS,
  REPORT_TEXT_COLUMNS,
  REPORT_SAVE_RETENTION_DEFAULT,
  REPORT_EMAIL_CODE_TTL_MS,
  REPORT_EMAIL_CODE_TRIES,
  REPORT_EMAIL_PER_HOUR,
  REPORT_EMAIL_PER_DAY,
  REPORT_SMS_PER_HOUR,
  REPORT_SMS_PER_DAY,
  REPORT_EXIT_CODES,
  REPORT_FORMATS,
  REPORT_FAIL_ON,
  REPORT_MAX_SECTIONS,
  SLASH_COMMAND_NAMES,
} from '../../src/shared/constants'
import {
  reportDocumentSchema,
  reportOptionsSchema,
  reportSourceSchema,
  reportRowSchema,
  reportSectionSchema,
  reportValueSchema,
  reportDiffSchema,
  type ReportDocument,
  type ReportRenderer,
  type ReportTheme,
} from '../../src/shared/reportSchema'
import {
  reportsMethods,
  reportHistoryEntrySchema,
  type ReportsHostPort,
} from '../../src/shared/hostApi/reports'
import type { ReportCollector, ReportSourcePorts } from '../../src/core/reporting/sources/types'
import {
  reportRequiredGatesSchema,
  reportPackageFactsSchema,
  reportSessionActivitySchema,
  reportCiRunSchema,
} from '../../src/core/reporting/sources/types'
import {
  reportDocument,
  reportOptions,
  buildSourceSnapshot,
  unavailableSource,
  availableSource,
  fakeSourcePort,
  reportFactSnapshot,
} from './helpers/reporting/snapshot'
import { PACKAGE_FIXTURE } from './helpers/reporting/plans'

const fixtureCollector: ReportCollector = (_snapshot, options) => reportDocument(options.kind)
const fixtureRenderer: ReportRenderer = (doc, locale, theme) =>
  `${doc.header.kind}:${locale}:${theme.foreground}`

function setContentHash(document: ReportDocument): void {
  const { asOf: _asOf, contentHash: _hash, ...header } = document.header
  document.header.contentHash = createHash('sha256')
    .update(JSON.stringify({ ...document, header }))
    .digest('hex')
}

function fullComparisonDocument(): ReportDocument {
  const document = reportDocument()
  const section = document.sections[0]!
  document.needsYou.rows = [
    {
      key: '0-question',
      cells: { detail: { type: 'text', value: 'Owner decision pending' } },
      sourceIds: ['plan'],
    },
  ]
  document.sections = Array.from({ length: REPORT_MAX_SECTIONS }, (_, index) => ({
    ...structuredClone(section),
    id: `section-${String(index)}`,
  }))
  setContentHash(document)
  return reportDocumentSchema.parse(document)
}

describe('M113 frozen report contracts', () => {
  it('fixes D93 limits, formats and CLI outcomes without changing M93', () => {
    expect([
      REPORT_SECTION_ROWS,
      REPORT_GIT_MAX_COMMITS,
      REPORT_SOURCE_TIMEOUT_MS,
      REPORT_GITHUB_RATE_FLOOR,
      REPORT_CHECK_RUNS_MAX,
      REPORT_HISTORY_MAX_PER_KIND,
      REPORT_LOCAL_BUDGET_MS,
      REPORT_PLAN_BUDGET_MS,
      REPORT_TEXT_COLUMNS,
    ]).toEqual([10, 5000, 5000, 10, 500, 50, 2000, 200, 80])
    expect([
      REPORT_SAVE_RETENTION_DEFAULT,
      REPORT_EMAIL_CODE_TTL_MS,
      REPORT_EMAIL_CODE_TRIES,
      REPORT_EMAIL_PER_HOUR,
      REPORT_EMAIL_PER_DAY,
      REPORT_SMS_PER_HOUR,
      REPORT_SMS_PER_DAY,
    ]).toEqual([30, 900_000, 5, 6, 20, 2, 10])
    expect(REPORT_EXIT_CODES).toEqual({
      generated: 0,
      failed: 1,
      usage: 2,
      notFound: 3,
      conditionHeld: 4,
    })
    expect(REPORT_FORMATS).toEqual(['md', 'html', 'json', 'text'])
    expect(REPORT_FAIL_ON).toEqual(['unavailable', 'drift', 'blocked', 'channelLag', 'ciFailing'])
    expect(SLASH_COMMAND_NAMES.report).toBe('report')
  })
  it.each(REPORT_KINDS)('accepts the shared shape for %s', (kind) => {
    expect(reportDocumentSchema.parse(reportDocument(kind)).header.kind).toBe(kind)
    expect(reportOptionsSchema.parse(reportOptions(kind)).kind).toBe(kind)
  })
  it('rejects foreign versions, kinds, translated labels and undeclared sort keys', () => {
    const doc = reportDocument()
    expect(
      reportSectionSchema.safeParse({ ...doc.sections[0], label: 'Translated label' }).success,
    ).toBe(false)
    expect(reportValueSchema.safeParse({ type: 'label', value: 'Translated label' }).success).toBe(
      false,
    )
    for (const raw of [
      { ...doc, format: 'report-v2' },
      { ...doc, header: { ...doc.header, kind: 'invented' } },
      { ...doc, needsYou: { ...doc.needsYou, label: 'Needs you' } },
      { ...doc, needsYou: { ...doc.needsYou, sortKey: 'insertion' } },
      { ...doc, header: { ...doc.header, contentHash: 'bad-hash' } },
      { ...doc, header: { ...doc.header, asOf: 'yesterday' } },
    ])
      expect(reportDocumentSchema.safeParse(raw).success).toBe(false)
  })
  it('rejects unknown fields at every document and value boundary', () => {
    const doc = reportDocument()
    expect(reportDocumentSchema.safeParse({ ...doc, prompt: 'forged' }).success).toBe(false)
    expect(
      reportDocumentSchema.safeParse({ ...doc, header: { ...doc.header, apiKey: 'forged' } })
        .success,
    ).toBe(false)
    expect(reportSectionSchema.safeParse({ ...doc.needsYou, command: 'forged' }).success).toBe(
      false,
    )
    expect(
      reportRowSchema.safeParse({ ...doc.sections[0]!.rows[0], output: 'forged' }).success,
    ).toBe(false)
    expect(
      reportValueSchema.safeParse({ type: 'text', value: 'data', translated: true }).success,
    ).toBe(false)
    expect(reportSourceSchema.safeParse({ ...doc.sources[0], credentials: 'forged' }).success).toBe(
      false,
    )
    expect(
      reportDocumentSchema.safeParse({ ...doc, footer: { ...doc.footer, token: 'forged' } })
        .success,
    ).toBe(false)
    expect(reportOptionsSchema.safeParse({ ...reportOptions(), command: 'forged' }).success).toBe(
      false,
    )
  })
  it('requires Needs you first, unique sections, row keys, columns and sources', () => {
    const doc = reportDocument()
    const section = doc.sections[0]!
    expect(
      reportDocumentSchema.safeParse({ ...doc, needsYou: { ...doc.needsYou, id: 'last' } }).success,
    ).toBe(false)
    expect(reportDocumentSchema.safeParse({ ...doc, sections: [section, section] }).success).toBe(
      false,
    )
    expect(
      reportDocumentSchema.safeParse({ ...doc, sources: [...doc.sources, ...doc.sources] }).success,
    ).toBe(false)
    expect(
      reportSectionSchema.safeParse({ ...section, rows: [...section.rows, ...section.rows] })
        .success,
    ).toBe(false)
    expect(
      reportSectionSchema.safeParse({
        ...section,
        columns: [...section.columns, ...section.columns],
      }).success,
    ).toBe(false)
  })
  it('requires every row cell to match its columns and reference a named source', () => {
    const doc = reportDocument()
    const section = doc.sections[0]!
    const row = section.rows[0]!
    expect(
      reportSectionSchema.safeParse({
        ...section,
        rows: [{ ...row, cells: { wrong: { type: 'text', value: 'wrong column' } } }],
      }).success,
    ).toBe(false)
    expect(
      reportSectionSchema.safeParse({ ...section, rows: [{ ...row, cells: {} }] }).success,
    ).toBe(false)
    expect(
      reportSectionSchema.safeParse({
        ...section,
        rows: [{ ...row, cells: { ...row.cells, extra: { type: 'text', value: 'extra' } } }],
      }).success,
    ).toBe(false)
    expect(
      reportSectionSchema.safeParse({ ...section, rows: [{ ...row, sourceIds: ['plan', 'plan'] }] })
        .success,
    ).toBe(false)
    expect(
      reportDocumentSchema.safeParse({ ...doc, sources: [unavailableSource('git').record] })
        .success,
    ).toBe(false)
  })
  it.each(['partial', 'unavailable', 'notApplicable'])(
    'requires an honest reason for %s',
    (status) => {
      const source = { ...unavailableSource('git').record, status }
      expect(reportSourceSchema.safeParse(source).success).toBe(true)
      expect(reportSourceSchema.safeParse({ ...source, reason: '' }).success).toBe(false)
      expect(reportSourceSchema.safeParse({ ...source, reason: null }).success).toBe(false)
    },
  )
  it('cannot claim freshness without an observation, or omit its source list', () => {
    const doc = reportDocument()
    expect(
      reportSourceSchema.safeParse({ ...doc.sources[0], freshness: { state: 'fresh', ageMs: 0 } })
        .success,
    ).toBe(false)
    expect(
      reportSourceSchema.safeParse({ ...doc.sources[0], freshness: { state: 'unknown', ageMs: 0 } })
        .success,
    ).toBe(false)
    expect(reportDocumentSchema.safeParse({ ...doc, sources: [] }).success).toBe(false)
    expect(reportDocumentSchema.safeParse({ ...doc, sections: [], sources: [] }).success).toBe(
      false,
    )
  })
  it('bounds document arrays and strings, refusing negative, unsafe or fractional counts', () => {
    const doc = reportDocument()
    expect(
      reportSectionSchema.safeParse({
        ...doc.needsYou,
        rows: Array.from({ length: 20_001 }, (_, i) => ({
          key: `row-${String(i)}`,
          cells: { detail: { type: 'text', value: '' } },
          sourceIds: [],
        })),
      }).success,
    ).toBe(false)
    expect(reportValueSchema.safeParse({ type: 'text', value: 'x'.repeat(65_537) }).success).toBe(
      false,
    )
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(reportValueSchema.safeParse({ type: 'count', value }).success).toBe(false)
    }
    expect(reportSectionSchema.safeParse({ ...doc.needsYou, columns: [] }).success).toBe(false)
    expect(
      reportSectionSchema.safeParse({
        ...doc.needsYou,
        columns: Array.from({ length: 65 }, (_, i) => ({ key: `col-${String(i)}`, label: 'name' })),
      }).success,
    ).toBe(false)
    expect(
      reportDocumentSchema.safeParse({
        ...doc,
        sections: Array.from({ length: 65 }, (_, i) => ({
          ...doc.needsYou,
          id: `section-${String(i)}`,
        })),
      }).success,
    ).toBe(false)
    expect(
      reportDocumentSchema.safeParse({
        ...doc,
        sources: [
          doc.sources[0],
          ...Array.from({ length: 100 }, (_, i) => unavailableSource(`source-${String(i)}`).record),
        ],
      }).success,
    ).toBe(false)
    expect(
      reportRowSchema.safeParse({
        ...doc.sections[0]!.rows[0],
        sourceIds: Array.from({ length: 101 }, (_, i) => `source-${String(i)}`),
      }).success,
    ).toBe(false)
    expect(reportRowSchema.safeParse({ ...doc.sections[0]!.rows[0], key: 'bad key' }).success).toBe(
      false,
    )
    expect(
      reportRowSchema.safeParse({ ...doc.sections[0]!.rows[0], key: 'x'.repeat(257) }).success,
    ).toBe(false)
  })
  it('keeps cost certainty, timestamps and display types explicit', () => {
    for (const value of [
      { type: 'usd', value: null, certainty: 'unknown' },
      { type: 'usd', value: '1.25', certainty: 'reported' },
      { type: 'count', value: 12 },
      { type: 'number', value: -1 },
      { type: 'percent', value: 100 },
      { type: 'durationMs', value: 1.5 },
      { type: 'timestamp', value: '2026-10-06T12:00:00-07:00' },
      { type: 'boolean', value: true },
      { type: 'textList', value: ['a', 'b'] },
    ])
      expect(reportValueSchema.safeParse(value).success).toBe(true)
    expect(reportValueSchema.safeParse({ type: 'usd', value: 1 }).success).toBe(false)
    expect(
      reportValueSchema.safeParse({ type: 'usd', value: -1, certainty: 'estimated' }).success,
    ).toBe(false)
  })
  it('types the injected collector, renderer and source ports without a backend', async () => {
    const snapshot = buildSourceSnapshot()
    const theme: ReportTheme = {
      background: '#fff',
      foreground: '#000',
      muted: '#444',
      border: '#777',
      accent: '#00f',
    }
    expect(fixtureRenderer(fixtureCollector(snapshot, reportOptions()), 'de', theme)).toBe(
      'project:de:#000',
    )
    const port: ReportSourcePorts['questions'] = fakeSourcePort(
      'questions',
      availableSource('questions', []),
    )
    const result = await port.read({
      asOf: snapshot.asOf,
      workspaceKey: snapshot.workspaceKey,
      options: reportOptions(),
      signal: new AbortController().signal,
    })
    expect(result.record.status).toBe('ok')
  })
})

describe('portable reports method family', () => {
  it('compares changed rows in Needs you and every ordinary section at the document limit', () => {
    const before = fullComparisonDocument()
    const after = structuredClone(before)
    after.needsYou.rows[0]!.cells['detail'] = { type: 'text', value: 'Owner decision answered' }
    for (const section of after.sections)
      section.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    setContentHash(after)
    expect(reportDocumentSchema.parse(after)).toEqual(after)
    expect(after.header.contentHash).not.toBe(before.header.contentHash)
    const beforeSections = [before.needsYou, ...before.sections]
    const afterSections = [after.needsYou, ...after.sections]
    const result = reportsMethods['reports/compare'].result.parse({
      status: 'compared',
      diff: {
        from: before.header,
        to: after.header,
        sections: beforeSections.map((section, index) => ({
          id: section.id,
          label: section.label,
          added: [],
          removed: [],
          changed: [
            {
              key: section.rows[0]!.key,
              before: section.rows[0],
              after: afterSections[index]!.rows[0],
            },
          ],
          unchangedRows: 0,
        })),
      },
    })
    if (result.status !== 'compared') throw new Error('Expected complete comparison')
    expect(result.diff.sections).toHaveLength(65)
    expect(result.diff.sections.map((section) => section.id)).toEqual(
      beforeSections.map((section) => section.id),
    )
    for (const [index, section] of result.diff.sections.entries()) {
      expect(section.changed[0]!.before).toEqual(beforeSections[index]!.rows[0])
      expect(section.changed[0]!.after).toEqual(afterSections[index]!.rows[0])
      expect(section.changed[0]!.before).not.toEqual(section.changed[0]!.after)
    }
  })
  it('compares the union of disjoint section ids without raising document bounds', () => {
    const before = fullComparisonDocument()
    const after = structuredClone(before)
    for (const section of after.sections) section.id = `new-${section.id}`
    setContentHash(after)
    expect(reportDocumentSchema.parse(after)).toEqual(after)
    const needsYou = {
      id: before.needsYou.id,
      label: before.needsYou.label,
      added: [],
      removed: [],
      changed: [],
      unchangedRows: 1,
    }
    const diff = {
      from: before.header,
      to: after.header,
      sections: [
        needsYou,
        ...before.sections.map((section) => ({
          ...needsYou,
          id: section.id,
          label: section.label,
          removed: section.rows,
          unchangedRows: 0,
        })),
        ...after.sections.map((section) => ({
          ...needsYou,
          id: section.id,
          label: section.label,
          added: section.rows,
          unchangedRows: 0,
        })),
      ],
    }
    const result = reportsMethods['reports/compare'].result.parse({ status: 'compared', diff })
    if (result.status !== 'compared') throw new Error('Expected complete comparison')
    expect(result.diff.sections).toEqual(diff.sections)
    expect(result.diff.sections).toHaveLength(129)
    expect(
      reportDiffSchema.safeParse({
        ...diff,
        sections: [...diff.sections, { ...needsYou, id: 'overflow' }],
      }).success,
    ).toBe(false)
    expect(
      reportDocumentSchema.safeParse({
        ...before,
        sections: [...before.sections, { ...before.sections[0], id: 'overflow' }],
      }).success,
    ).toBe(false)
  })
  it('validates run, history and open payloads with explicit failures', async () => {
    const doc = reportDocument()
    const host: ReportsHostPort = {
      capability: 'reports',
      run: () => Promise.resolve({ status: 'generated', document: doc }),
      history: () =>
        Promise.resolve({ status: 'listed', entries: [{ id: 'one', header: doc.header }] }),
      open: () => Promise.resolve({ status: 'opened' }),
      get: () => Promise.resolve({ status: 'retrieved', document: doc }),
      compare: () =>
        Promise.resolve({
          status: 'compared',
          diff: { from: doc.header, to: doc.header, sections: [] },
        }),
    }
    const run = reportsMethods['reports/run']
    const history = reportsMethods['reports/history']
    const open = reportsMethods['reports/open']
    expect(
      run.result.parse(
        await host.run(run.params.parse({ workspaceKey: 'fixture', options: reportOptions() })),
      ).status,
    ).toBe('generated')
    expect(
      history.result.parse(
        await host.history(history.params.parse({ workspaceKey: 'fixture', kind: 'project' })),
      ).status,
    ).toBe('listed')
    expect(
      open.result.parse(await host.open(open.params.parse({ document: doc, format: 'html' })))
        .status,
    ).toBe('opened')
    expect(reportHistoryEntrySchema.parse({ id: 'one', header: doc.header }).id).toBe('one')
    for (const method of Object.values(reportsMethods)) {
      expect(
        method.result.safeParse({ status: 'failed', reason: 'Unavailable host' }).success,
      ).toBe(true)
      expect(method.result.safeParse({ status: 'failed', reason: '' }).success).toBe(false)
      expect(
        method.result.safeParse({
          status: 'failed',
          reason: 'Unavailable host',
          credentials: 'forged',
        }).success,
      ).toBe(false)
      expect(method.params.safeParse({ credentials: 'forged' }).success).toBe(false)
    }
    expect(
      run.params.safeParse({
        workspaceKey: 'fixture',
        options: reportOptions(),
        credentials: 'forged',
      }).success,
    ).toBe(false)
    expect(
      history.params.safeParse({ workspaceKey: 'fixture', kind: 'project', credentials: 'forged' })
        .success,
    ).toBe(false)
    expect(
      open.params.safeParse({ document: doc, format: 'html', credentials: 'forged' }).success,
    ).toBe(false)
    expect(
      history.result.safeParse({
        status: 'listed',
        entries: Array.from({ length: 51 }, () => ({ id: 'one', header: doc.header })),
      }).success,
    ).toBe(false)
    expect(open.params.safeParse({ document: doc, format: 'executable' }).success).toBe(false)
    expect(run.result.safeParse({ status: 'failed', reason: 'x'.repeat(65_537) }).success).toBe(
      false,
    )
    expect(history.params.safeParse({ workspaceKey: '../escape', kind: 'project' }).success).toBe(
      false,
    )
    expect(
      history.params.safeParse({ workspaceKey: String.raw`..\escape`, kind: 'project' }).success,
    ).toBe(false)
  })
  it('retrieves saved ids and compares row fields within history authorization scope', async () => {
    const before = reportDocument()
    const after = structuredClone(before)
    after.header.contentHash = 'b'.repeat(64)
    after.sections[0]!.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    const scope = { workspaceKey: 'fixture-workspace', kind: 'project' }
    const get = reportsMethods['reports/get']
    const compare = reportsMethods['reports/compare']
    // The fake uses only saved bytes, so reconnecting cannot regenerate history.
    const saved = new Map([
      ['before', before],
      ['after', after],
    ])
    const host: Pick<ReportsHostPort, 'get' | 'compare'> = {
      get(params) {
        const document = saved.get(params.id)
        return Promise.resolve(
          document && params.workspaceKey === scope.workspaceKey && params.kind === scope.kind
            ? { status: 'retrieved', document: structuredClone(document) }
            : { status: 'failed', reason: 'Saved report unavailable in this scope' },
        )
      },
      async compare(params) {
        const left = await host.get({
          workspaceKey: params.workspaceKey,
          kind: params.kind,
          id: params.fromId,
        })
        const right = await host.get({
          workspaceKey: params.workspaceKey,
          kind: params.kind,
          id: params.toId,
        })
        if (left.status === 'failed' || right.status === 'failed')
          return { status: 'failed', reason: 'Saved report unavailable in this scope' }
        return {
          status: 'compared',
          diff: {
            from: left.document.header,
            to: right.document.header,
            sections: [
              {
                id: 'status',
                label: 'status',
                added: [],
                removed: [],
                unchangedRows: 0,
                changed: [
                  {
                    key: 'M12',
                    before: left.document.sections[0]!.rows[0]!,
                    after: right.document.sections[0]!.rows[0]!,
                  },
                ],
              },
            ],
          },
        }
      },
    }
    expect(get.result.parse(await host.get(get.params.parse({ ...scope, id: 'before' })))).toEqual({
      status: 'retrieved',
      document: before,
    })
    const result = compare.result.parse(
      await host.compare(compare.params.parse({ ...scope, fromId: 'before', toId: 'after' })),
    )
    expect(result.status).toBe('compared')
    if (result.status !== 'compared') throw new Error('Expected saved comparison')
    expect(result.diff.sections[0]!.changed[0]).toMatchObject({
      key: 'M12',
      before: { cells: { state: { value: 'planned' } } },
      after: { cells: { state: { value: 'merged' } } },
    })
    for (const denied of [{ workspaceKey: 'other' }, { kind: 'usage' }, { id: 'absent' }]) {
      const deniedResult = await host.get(get.params.parse({ ...scope, id: 'before', ...denied }))
      expect(deniedResult.status).toBe('failed')
    }
    const missingResult = await host.compare({
      ...scope,
      kind: 'project',
      fromId: 'before',
      toId: 'absent',
    })
    expect(missingResult.status).toBe('failed')
    for (const id of ['../escape', String.raw`..\escape`, 'x'.repeat(257)]) {
      expect(get.params.safeParse({ ...scope, id }).success).toBe(false)
      expect(compare.params.safeParse({ ...scope, fromId: id, toId: 'after' }).success).toBe(false)
      expect(compare.params.safeParse({ ...scope, fromId: 'before', toId: id }).success).toBe(false)
    }
    expect(get.params.safeParse(scope).success).toBe(false)
    expect(compare.params.safeParse({ ...scope, fromId: 'before' }).success).toBe(false)
    expect(
      compare.params.safeParse({ ...scope, fromId: 'before', toId: 'after', credentials: 'forged' })
        .success,
    ).toBe(false)
    expect(
      reportDiffSchema.safeParse({
        ...result.diff,
        sections: [
          {
            ...result.diff.sections[0],
            changed: [{ ...result.diff.sections[0]!.changed[0], key: 'wrong' }],
          },
        ],
      }).success,
    ).toBe(false)
    expect(compare.result.safeParse({ status: 'compared', diff: before }).success).toBe(false)
  })
})

describe('normalized reporting facts', () => {
  it('retains required milestone gates and declared package scripts even before any run', () => {
    const { sources } = reportFactSnapshot()
    const plan = sources.plan.data!
    expect(reportRequiredGatesSchema.parse(plan.milestones[0]!.requiredGates)).toEqual([
      'quality',
      'check:reference',
    ])
    expect(reportPackageFactsSchema.parse(sources.package.data)).toEqual({
      qualityScripts: [
        { name: 'quality', command: 'npm run quality:gates && npm run test:a11y' },
        { name: 'quality:gates', command: 'npm run typecheck && npm run check:reference' },
        { name: 'check:reference', command: 'node scripts/gen-reference.mjs --check' },
      ],
    })
    expect(sources.checkRuns.data).toEqual([])
    const fixturePackage: unknown = JSON.parse(PACKAGE_FIXTURE)
    expect(fixturePackage).toMatchObject({
      scripts: Object.fromEntries(
        sources.package.data!.qualityScripts.map(({ name, command }) => [name, command]),
      ),
    })
    expect(reportRequiredGatesSchema.safeParse(undefined).success).toBe(false)
    expect(reportRequiredGatesSchema.safeParse(['']).success).toBe(false)
    expect(reportPackageFactsSchema.safeParse({}).success).toBe(false)
    expect(
      reportPackageFactsSchema.safeParse({ qualityScripts: [{ name: 'quality' }] }).success,
    ).toBe(false)
    expect(
      reportPackageFactsSchema.safeParse({ qualityScripts: [], credentials: 'forged' }).success,
    ).toBe(false)
  })
  it('retains actual turns and approvals independently of a flattened portable transcript', () => {
    const session = reportFactSnapshot().sources.session.data!
    expect(session.export.transcript).toHaveLength(2)
    expect(reportSessionActivitySchema.parse(session.activity)).toEqual({
      turns: { status: 'available', count: 1 },
      approvals: { status: 'available', approved: 1, denied: 2, auto: 0, expired: 1 },
    })
    const differentlyGrouped = {
      ...session,
      activity: {
        turns: { status: 'available', count: 2 },
        approvals: { status: 'available', approved: 0, denied: 0, auto: 2, expired: 0 },
      },
    }
    expect(differentlyGrouped.export).toEqual(session.export)
    expect(reportSessionActivitySchema.parse(differentlyGrouped.activity)).not.toEqual(
      session.activity,
    )
    const missing = { status: 'unavailable', reason: 'Legacy portable history lacks these facts' }
    expect(reportSessionActivitySchema.parse({ turns: missing, approvals: missing })).toEqual({
      turns: missing,
      approvals: missing,
    })
    expect(
      reportSessionActivitySchema.safeParse({
        turns: { status: 'unavailable', count: 0 },
        approvals: missing,
      }).success,
    ).toBe(false)
    expect(
      reportSessionActivitySchema.safeParse({
        turns: { status: 'unavailable' },
        approvals: missing,
      }).success,
    ).toBe(false)
    if (session.activity.approvals.status !== 'available')
      throw new Error('Expected available decisions')
    for (const field of ['approved', 'denied', 'auto', 'expired']) {
      const approvals = { ...session.activity.approvals }
      Reflect.deleteProperty(approvals, field)
      expect(
        reportSessionActivitySchema.safeParse({ ...session.activity, approvals }).success,
      ).toBe(false)
    }
    expect(
      reportSessionActivitySchema.safeParse({
        turns: session.activity.turns,
        approvals: { status: 'available', approved: 1 },
      }).success,
    ).toBe(false)
    expect(
      reportSessionActivitySchema.safeParse({
        ...session.activity,
        turns: { status: 'available', count: -1 },
      }).success,
    ).toBe(false)
  })
  it('keeps green HEAD, failing default-branch and pending release CI separately attributable', () => {
    const runs = reportFactSnapshot().sources.github.data!.runs.map((run) =>
      reportCiRunSchema.parse(run),
    )
    expect(runs.map((run) => [run.ref.kind, run.ref.name, run.conclusion])).toEqual([
      ['head', 'm12/0', 'success'],
      ['default-branch', 'main', 'failure'],
      ['release-tag', 'v0.14.2', null],
    ])
    expect(new Set(runs.map((run) => run.sha)).size).toBe(3)
    expect(new Set(runs.map((run) => run.url)).size).toBe(3)
    expect(reportCiRunSchema.parse({ ...runs[0], conclusion: 'future-outcome' }).conclusion).toBe(
      'future-outcome',
    )
    for (const field of ['ref', 'sha', 'workflow', 'conclusion', 'url']) {
      const incomplete = { ...runs[0] }
      Reflect.deleteProperty(incomplete, field)
      expect(reportCiRunSchema.safeParse(incomplete).success).toBe(false)
    }
    expect(reportCiRunSchema.safeParse({ ...runs[0], ref: { name: 'main' } }).success).toBe(false)
    expect(
      reportCiRunSchema.safeParse({ ...runs[0], ref: { kind: 'unknown', name: 'main' } }).success,
    ).toBe(false)
    expect(reportCiRunSchema.safeParse({ ...runs[0], credentials: 'forged' }).success).toBe(false)
  })
})
