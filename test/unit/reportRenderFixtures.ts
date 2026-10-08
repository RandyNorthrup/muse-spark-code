import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { EN } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { createReportRenderers } from '../../src/core/reporting/render'
import type { ReportLocalePort } from '../../src/core/reporting/render/display'
import type {
  ReportKind,
  ReportLabelKey,
  ReportTheme,
  ReportValue,
} from '../../src/shared/reportSchema'
import { reportDocument } from './helpers/reporting/snapshot'

export const REPORT_THEME: ReportTheme = {
  background: '#ffffff',
  foreground: '#1f1f1f',
  muted: '#404040',
  border: '#707070',
  accent: '#005fb8',
}
export const REPORT_THEMES: readonly ReportTheme[] = [
  REPORT_THEME,
  {
    background: '#1f1f1f',
    foreground: '#cccccc',
    muted: '#a6a6a6',
    border: '#848484',
    accent: '#4daafc',
  },
  {
    background: '#000000',
    foreground: '#ffffff',
    muted: '#ffffff',
    border: '#ffffff',
    accent: '#ffff00',
  },
  {
    background: '#ffffff',
    foreground: '#000000',
    muted: '#000000',
    border: '#000000',
    accent: '#000080',
  },
]
export const RENDERERS = createReportRenderers({ textForLocale: () => EN })
export const GOLDEN_ROOT = path.resolve(import.meta.dirname, '../fixtures/reports')

const KIND_SECTIONS: Record<ReportKind, readonly ReportLabelKey[]> = {
  project: ['releases', 'milestones', 'lanes', 'pullRequests', 'ci', 'usage', 'risks', 'nextSteps'],
  milestone: [
    'status',
    'goal',
    'dependencies',
    'lanes',
    'certification',
    'gates',
    'residuals',
    'questions',
  ],
  release: ['changelog', 'tag', 'channels', 'releaseRecord', 'ci'],
  changes: ['commits', 'files', 'changelog', 'pullRequests'],
  usage: ['totals', 'breakdown', 'limits'],
  session: [
    'model',
    'backend',
    'turns',
    'tokens',
    'cost',
    'tools',
    'files',
    'approvals',
    'questions',
    'checks',
    'paidUses',
  ],
  quality: ['gates', 'checks', 'ci', 'certification'],
  fleet: ['agents', 'workers', 'devices', 'nodes'],
  security: ['vault', 'grants', 'denials', 'locks', 'developerAudit'],
  accounts: ['accounts', 'limits', 'usage', 'swaps', 'confirmations'],
  estimate: ['criticalPath', 'limitingResource', 'setups', 'inputs', 'calibration'],
  playbook: ['decisions', 'drills', 'disabledRules', 'refusals'],
  issues: ['issues', 'status', 'pullRequests', 'nextSteps'],
  schedules: ['timeline', 'schedules', 'fires', 'refusals', 'cost'],
  keybindings: ['keybindings', 'conflicts'],
}

/** Normalized renderer fixture; collectors own the mapping from the real repository. */
export function renderFixture(kind: ReportKind = 'project') {
  const document = reportDocument(kind, [
    {
      id: 'plan',
      status: 'ok',
      reason: null,
      observedAt: '2026-10-06T12:00:00+00:00',
      freshness: { state: 'fresh', ageMs: 0 },
    },
    {
      id: 'git',
      status: 'partial',
      reason: 'Commit bound reached.',
      observedAt: '2026-10-06T11:00:00+00:00',
      freshness: { state: 'stale', ageMs: 3_600_000 },
    },
    {
      id: 'github',
      status: 'unavailable',
      reason: 'Network is off.',
      observedAt: null,
      freshness: { state: 'unknown', ageMs: null },
    },
    {
      id: 'usage',
      status: 'notApplicable',
      reason: 'Journal integration is not present.',
      observedAt: null,
      freshness: { state: 'unknown', ageMs: null },
    },
  ])
  document.header.scope = 'Fixture workspace'
  document.needsYou.rows = [
    {
      key: '0-owner',
      cells: { detail: { type: 'text', value: 'Choose the release channel.' } },
      sourceIds: ['plan'],
    },
    {
      key: '1-channel',
      cells: { detail: { type: 'text', value: 'Open VSX is behind the tag.' } },
      sourceIds: ['git'],
    },
    {
      key: '2-ci',
      cells: { detail: { type: 'text', value: 'Default branch quality failed.' } },
      sourceIds: ['github'],
    },
  ]
  document.sections = KIND_SECTIONS[kind].map((label, index) => ({
    id: label,
    label,
    sortKey: 'key',
    columns: [
      { key: 'name', label: 'name' },
      { key: 'state', label: 'status' },
    ],
    rows: [
      {
        key: 'a-M12',
        cells: {
          name: {
            type: 'text',
            value:
              index === 0
                ? 'M12: fixture contracts | <release> & "notes"'
                : 'M12: fixture contracts',
          },
          state: { type: 'label', value: 'planned' },
        },
        sourceIds: ['plan', 'git'],
      },
      {
        key: 'b-M110a0',
        cells: {
          name: { type: 'text', value: 'M110a0: fixture runtime\nA second commit.' },
          state: { type: 'label', value: 'merged' },
        },
        sourceIds: ['git'],
      },
    ],
    omittedRows: index === 0 ? 12 : 0,
  }))
  return finalizeReport(document)
}

export function valueFixture() {
  const document = renderFixture('usage')
  const values: Record<string, ReportValue> = {
    number: { type: 'number', value: 1234.5 },
    count: { type: 'count', value: 1234 },
    percent: { type: 'percent', value: 42 },
    usd: { type: 'usd', value: 1.46, certainty: 'reported' },
    unknown: { type: 'usd', value: null, certainty: 'unknown' },
    estimated: { type: 'usd', value: 2, certainty: 'estimated' },
    duration: { type: 'durationMs', value: 1250 },
    timestamp: { type: 'timestamp', value: '2026-10-06T12:00:00-07:00' },
    boolean: { type: 'boolean', value: true },
    off: { type: 'boolean', value: false },
    list: { type: 'textList', value: ['one', 'two'] },
  }
  document.sections = [
    {
      id: 'values',
      label: 'totals',
      sortKey: 'key',
      columns: [{ key: 'value', label: 'count' }],
      rows: Object.entries(values).map(([key, value]) => ({
        key,
        cells: { value },
        sourceIds: ['usage'],
      })),
      omittedRows: 0,
    },
  ]
  return finalizeReport(document)
}

type LocaleText = ReturnType<ReportLocalePort['textForLocale']>
function isLocaleText(input: unknown, locale: string): input is LocaleText {
  if (typeof input !== 'object' || input === null) return false
  const english: LocaleText = {
    reportLabels: EN.reportLabels,
    reportKinds: EN.reportKinds,
    reportUi: EN.reportUi,
    reportRowsMore: EN.reportRowsMore,
    toggleOn: EN.toggleOn,
    toggleOff: EN.toggleOff,
  }
  const subset = Object.fromEntries(
    Object.keys(english).map((key) => [key, Reflect.get(input, key)]),
  )
  return tableProblems(english, subset, { locale, isStrict: false }).length === 0
}

export async function localePort(locale: string): Promise<ReportLocalePort> {
  const parsed: unknown = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, `../../l10n/ui.${locale}.json`), 'utf8'),
  )
  if (!isLocaleText(parsed, locale)) throw new Error('Invalid reporting translation fixture')
  return { textForLocale: () => parsed }
}
