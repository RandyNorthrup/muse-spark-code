import { EN } from '../../src/shared/l10n/en'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { createReportRenderers } from '../../src/core/reporting/render'
import type { ReportKind, ReportLabelKey, ReportTheme } from '../../src/shared/reportSchema'
import { reportDocument } from './helpers/reporting/kindFixtures'
import type {
  ReportsCommandDeps,
  ReportsServices,
} from '../../src/runtime/reporting/reportsCommand'

/** The terminal report command's deps with both streams captured by the caller. */
export function reportsCommandDeps(parts: {
  readonly services: ReportsServices
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}): ReportsCommandDeps {
  return {
    text: EN,
    services: parts.services,
    keepHistory: true,
    locale: 'en',
    localePort: { textForLocale: () => EN },
    theme: REPORT_THEME,
    now: () => '2026-10-14T00:00:00.000Z',
    readSaved: () => Promise.reject(new Error('unused')),
    writeOut: () => Promise.resolve(),
    stdout: parts.stdout,
    stderr: parts.stderr,
  }
}

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
  playbook: ['decisions', 'hookVerification', 'disabledRules', 'refusals'],
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
