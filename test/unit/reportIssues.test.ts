// M115w WU: the issues report kind over real directories. The watchdog's
// own store writes the records, the production reader reads them, and the
// real report engine generates the report: owner-blocked issues first, the
// installed language's words, one repository by `--repo`, a repository
// nobody watches said, and a damaged record an unavailable source.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import { createReportingServices } from '../../src/runtime/reporting/engine'
import { createIssuesReportReader } from '../../src/runtime/reporting/playbookSchedulesInputs'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { WATCHDOG_STORE_SUBFOLDER } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { UI_TEXT, setUiText } from '../../src/shared/l10n/text'
import {
  defaultWatchdogPolicy,
  watchdogIssueSchema,
  type WatchdogIssue,
} from '../../src/shared/watchdog'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { installGerman } from './helpers/kindGermanTable'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/kindFixtures'
import { sectionById } from './helpers/reporting/reportKindFixtures'
import { fileRoots } from './helpers/tempDirs'
import { findingsFor } from './helpers/watchdog/fixtures'

const OWNER_REPOSITORY = 'RandyNorthrup/muse-spark-code'
const OTHER_REPOSITORY = 'someone/else'

const roots = fileRoots()
afterEach(() => {
  setUiText(EN, 'en')
})
const dir = (prefix: string): Promise<string> => roots.fresh(prefix)

function record(
  repository: string,
  number: number,
  state: WatchdogIssue['state'],
  extra: Partial<WatchdogIssue> = {},
): WatchdogIssue {
  return watchdogIssueSchema.parse({
    repository,
    issueNumber: number,
    issueId: number,
    state,
    runId: 'run-1',
    seenAtMs: 1,
    labelsApplied: [],
    triageRound: 0,
    lastTitle: `Issue ${String(number)}`,
    lastTextHash: 'h',
    lastCommentCount: 0,
    lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
    updatedAtMs: 1,
    ...extra,
  })
}

async function seed(data: string): Promise<void> {
  const store = createWatchdogStore(createNodeScheduleFs(data))
  await store.exclusive(OWNER_REPOSITORY, (live) => ({
    data: {
      policy: { ...defaultWatchdogPolicy(OWNER_REPOSITORY), postsBeyondAck: 'never' },
      issues: [
        record(OWNER_REPOSITORY, 5, 'closed'),
        record(OWNER_REPOSITORY, 12, 'awaitingInfo', {
          findings: findingsFor('needsInfo', 'No steps.'),
        }),
        record(OWNER_REPOSITORY, 9, 'planned', {
          findings: findingsFor('valid', 'It crashes.'),
          outcome: 'planEntry',
          pullRequestNumber: 31,
        }),
        record(OWNER_REPOSITORY, 10, 'triaged', {
          findings: findingsFor('duplicate', 'Same as #3.'),
        }),
        ...live.issues,
      ],
    },
    result: undefined,
  }))
  await store.exclusive(OTHER_REPOSITORY, (live) => ({
    data: {
      policy: { ...defaultWatchdogPolicy(OTHER_REPOSITORY), paused: true },
      issues: [record(OTHER_REPOSITORY, 1, 'acknowledged'), ...live.issues],
    },
    result: undefined,
  }))
}

function services(data: string, workspace: string, table = EN, locale = 'en') {
  return createReportingServices({
    workspaceRoot: workspace,
    storageRoot: path.join(data, 'reports'),
    l10n: { table, locale },
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
    issues: createIssuesReportReader({ agentDataFolder: data }),
  })
}

function issuesOptions(scope = '') {
  return {
    kind: 'issues' as const,
    scope,
    full: false,
    network: false,
    failOn: [],
    asOf: REPORT_FIXTURE_AS_OF,
  }
}

function cellText(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('value' in value))
    throw new TypeError('the cell holds a value')
  return String(value.value)
}

describe('issues report', () => {
  it('lists the watched issues with what waits on the person first', async () => {
    const data = await dir('muse-issues-data-')
    const workspace = await dir('muse-issues-ws-')
    await seed(data)
    const result = await services(data, workspace).generate?.(issuesOptions())
    if (result?.status !== 'generated') throw new Error('Expected an issues report')
    expect(result.document.sources.find((source) => source.id === 'issues')?.status).toBe('ok')
    const issues = sectionById(result.document.sections, 'issues/issues')
    expect(issues.rows.map((row) => cellText(row.cells['name']))).toEqual([
      `${OWNER_REPOSITORY}#9 Issue 9`,
      `${OWNER_REPOSITORY}#10 Issue 10`,
      `${OTHER_REPOSITORY}#1 Issue 1`,
      `${OWNER_REPOSITORY}#12 Issue 12`,
      `${OWNER_REPOSITORY}#5 Issue 5`,
    ])
    const [planned, triaged, , waiting] = issues.rows
    expect(planned?.cells['status']).toEqual({ type: 'text', value: EN.watchdog.states.planned })
    expect(planned?.cells['reason']).toEqual({ type: 'text', value: EN.watchdog.waits.planned })
    expect(planned?.cells['pullRequest']).toEqual({ type: 'text', value: '#31' })
    expect(triaged?.cells['verdict']).toEqual({
      type: 'text',
      value: EN.watchdog.verdicts.duplicate,
    })
    expect(triaged?.cells['reason']).toEqual({ type: 'text', value: EN.watchdog.waits.triaged })
    expect(waiting?.cells['reason']).toEqual({
      type: 'text',
      value: EN.watchdog.waits.awaitingInfo,
    })
    const limits = sectionById(result.document.sections, 'issues/limits')
    const settings = limits.rows.map(
      (row) => `${cellText(row.cells['name'])}=${cellText(row.cells['status'])}`,
    )
    expect(settings).toContain(`${OWNER_REPOSITORY} posts=never`)
    expect(settings).toContain(`${OWNER_REPOSITORY} close=never`)
    expect(settings).toContain(`${OTHER_REPOSITORY} paused=${EN.watchdog.cli.pausedWord}`)
  })

  it('picks one repository, and says a repository nobody watches', async () => {
    const data = await dir('muse-issues-scope-')
    const workspace = await dir('muse-issues-ws-')
    await seed(data)
    const one = await services(data, workspace).generate?.(issuesOptions(OTHER_REPOSITORY))
    if (one?.status !== 'generated') throw new Error('Expected an issues report')
    expect(sectionById(one.document.sections, 'issues/issues').rows).toHaveLength(1)
    const unwatched = await services(data, workspace).generate?.(issuesOptions('no/body'))
    if (unwatched?.status !== 'generated') throw new Error('Expected an issues report')
    const source = unwatched.document.sources.find((entry) => entry.id === 'issues')
    expect(source?.status).toBe('partial')
    expect(source?.reason).toBe(EN.watchdog.cli.notWatched)
    // Only the source disclosure stands in the table: no issue row.
    const shown = sectionById(unwatched.document.sections, 'issues/issues').rows
    expect(shown.map((row) => cellText(row.cells['name']))).toEqual([''])
    expect(cellText(shown[0]?.cells['reason'])).toBe(EN.watchdog.cli.notWatched)
  })

  it('reads empty when nothing is watched, and fails a damaged record out loud', async () => {
    const data = await dir('muse-issues-empty-')
    const workspace = await dir('muse-issues-ws-')
    const empty = await services(data, workspace).generate?.(issuesOptions())
    if (empty?.status !== 'generated') throw new Error('Expected an issues report')
    expect(empty.document.sources.find((entry) => entry.id === 'issues')?.status).toBe('ok')
    expect(sectionById(empty.document.sections, 'issues/issues').rows).toEqual([])
    expect(sectionById(empty.document.sections, 'issues/limits').rows).toEqual([])
    await seed(data)
    await writeFile(
      path.join(data, WATCHDOG_STORE_SUBFOLDER, 'RandyNorthrup__muse-spark-code.json'),
      '{"policy":',
      'utf8',
    )
    const damaged = await services(data, workspace).generate?.(issuesOptions())
    if (damaged?.status !== 'generated') throw new Error('Expected an issues report')
    expect(damaged.document.sources.find((entry) => entry.id === 'issues')?.status).toBe(
      'unavailable',
    )
  })

  it('speaks the installed language', async () => {
    const data = await dir('muse-issues-de-')
    const workspace = await dir('muse-issues-ws-')
    await seed(data)
    await installGerman(stderrLogger(() => undefined, 'warn'))
    const german = { ...UI_TEXT }
    const result = await services(data, workspace, german, 'de').generate?.(issuesOptions())
    if (result?.status !== 'generated') throw new Error('Expected an issues report')
    const issues = sectionById(result.document.sections, 'issues/issues')
    expect(issues.rows[0]?.cells['status']).toEqual({
      type: 'text',
      value: german.watchdog.states.planned,
    })
    expect(german.watchdog.states.planned).not.toBe(EN.watchdog.states.planned)
  })
})
