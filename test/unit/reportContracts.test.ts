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
  SLASH_COMMAND_NAMES,
} from '../../src/shared/constants'
import {
  reportDocumentSchema,
  reportOptionsSchema,
  reportSourceSchema,
  reportRowSchema,
  reportSectionSchema,
  reportValueSchema,
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
  reportDocument,
  reportOptions,
  buildSourceSnapshot,
  unavailableSource,
  availableSource,
  fakeSourcePort,
} from './helpers/reporting/snapshot'

const fixtureCollector: ReportCollector = (_snapshot, options) => reportDocument(options.kind)
const fixtureRenderer: ReportRenderer = (doc, locale, theme) =>
  `${doc.header.kind}:${locale}:${theme.foreground}`

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
      { type: 'usd', value: 1.25, certainty: 'reported' },
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
  it('validates run, history and open payloads with explicit failures', async () => {
    const doc = reportDocument()
    const host: ReportsHostPort = {
      capability: 'reports',
      run: () => Promise.resolve({ status: 'generated', document: doc }),
      history: () =>
        Promise.resolve({ status: 'listed', entries: [{ id: 'one', header: doc.header }] }),
      open: () => Promise.resolve({ status: 'opened' }),
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
})
