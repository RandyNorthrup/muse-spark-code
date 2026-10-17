// RVREPORTJOIN P2-1: every record-carrying source parses its own records
// one at a time (each array element, each JSONL line), so [good, bad, good]
// yields two rows and one problem through the real production source, never
// one record or nothing. Each case below drives the real source or reader
// factory with that input; the shared-helper hardening stays in
// reportEngineBoundaries.test.ts.
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { USAGE_DAYS_FOLDER } from '../../src/shared/constants'
import { agentUsageSource, type AgentUsageFile } from '../../src/core/reporting/sources/agentUsage'
import { certificationSource } from '../../src/core/reporting/sources/certification'
import { CheckRunJournal } from '../../src/core/reporting/checkRuns'
import { ReportStorage } from '../../src/core/reporting/history'
import { stubLocalSources } from './helpers/reporting/localStubs'
import { keybindingsSource } from '../../src/core/reporting/sources/keybindings'
import { packageSource } from '../../src/core/reporting/sources/package'
import { questionsSource } from '../../src/core/reporting/sources/questions'
import { sessionSource } from '../../src/core/reporting/sources/session'
import { createAccountsReportReader } from '../../src/runtime/reporting/reportInputs'
import { createSecurityReportReader } from '../../src/runtime/reporting/reportInputs'
import { readUsageReportJournal } from '../../src/runtime/reporting/reportInputs'
import { UsageJournalStore, USAGE_JOURNAL_ROOT } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import type {
  AccountsFacts,
  CheckRunRecord,
  ReportQuestion,
  SourceReadContext,
  UsageFacts,
} from '../../src/core/reporting/sources/types'
import type { ReportSection } from '../../src/shared/reportSchema'
import {
  availableSource,
  buildSourceSnapshot,
  REPORT_FIXTURE_AS_OF,
  reportOptions,
} from './helpers/reporting/kindFixtures'
import { facet, fixtureCollector } from './helpers/reporting/kindFixtures'
import { canaryVaultSnapshot } from './helpers/reporting/canaryVault'
import { malformed } from './helpers/reporting/reasonCases'
import { removeFolder } from './helpers/temporaryFolders'

const TEMP = path.resolve(import.meta.dirname, '../../temp')
const scrub = (text: string) => text

// The check-run journal below runs report storage directly (as in
// checkRuns.test.ts), so its identity probe is the fixture command.
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/kindLaunch')
  return withFixtureCommand(await original())
})

function contextFor(kind: Parameters<typeof reportOptions>[0]): SourceReadContext {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'workspace',
    options: reportOptions(kind),
    signal: new AbortController().signal,
  }
}

const goodBreakdown = (key: string): UsageFacts['breakdown'][number] => ({
  key,
  inputTokens: 10,
  outputTokens: 2,
  costUsd: null,
  certainty: 'unknown',
})
const badBreakdown = { ...goodBreakdown('bad'), inputTokens: -1 }
const agentLine = (id: string) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-06T11:00:00Z',
    message: {
      id,
      model: 'm',
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  })
const journalRecord = (id: string) => ({
  v: 2,
  type: 'usage',
  id,
  at: Date.parse('2026-10-06T11:00:00Z'),
  day: '2026-10-06',
  timezoneOffsetMins: 0,
  client: 'acp',
  backend: 'modelApi',
  provider: 'meta',
  model: 'm',
  kind: 'turn',
  tokens: { input: 10, output: 2 },
  cost: { certainty: 'reported' },
  outcome: 'completed',
  startedAt: Date.parse('2026-10-06T11:00:00Z'),
})
const COMMIT = 'a'.repeat(40)
const goodCheck = (check: string, durationMs: number): CheckRunRecord => ({
  check,
  outcome: 'passed',
  durationMs,
  commit: COMMIT,
  at: REPORT_FIXTURE_AS_OF,
})
const badCheck = { ...goodCheck('bad', 3), outcome: 'bogus' }

function usageFacts(): UsageFacts {
  return {
    period: 'session',
    inputTokens: 10,
    outputTokens: 2,
    cachedTokens: null,
    costUsd: null,
    certainty: 'unknown',
    breakdown: [
      goodBreakdown('a'),
      malformed(badBreakdown, goodBreakdown('a')),
      goodBreakdown('b'),
    ],
    limits: [],
  }
}

describe('production sources keep good records beside one bad record', () => {
  it('session keeps two breakdown rows and two check runs with named problems', async () => {
    const result = await sessionSource(
      {
        read: () =>
          Promise.resolve({
            source: {
              backend: 'modelApi',
              modelId: 'fixture-model',
              exportedAt: REPORT_FIXTURE_AS_OF,
              items: [
                {
                  itemId: 'u1',
                  kind: 'userMessage',
                  status: 'completed',
                  turnId: 't1',
                  text: 'Hello',
                },
              ],
            },
            activity: {
              turns: { status: 'available', count: 1 },
              approvals: { status: 'unavailable', reason: 'No approvals recorded.' },
            },
            usage: usageFacts(),
            checkRuns: [
              goodCheck('a', 1),
              malformed(badCheck, goodCheck('a', 1)),
              goodCheck('b', 2),
            ],
            observedAt: REPORT_FIXTURE_AS_OF,
          }),
      },
      [],
      scrub,
    ).read(contextFor('session'))
    expect(result.data?.usage.breakdown).toHaveLength(2)
    expect(result.data?.checkRuns).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('usage keeps two breakdown rows with a named problem', async () => {
    const sources = stubLocalSources({
      usage: () => Promise.resolve({ usage: usageFacts(), observedAt: REPORT_FIXTURE_AS_OF }),
    })
    const result = await sources.usage.read(contextFor('usage'))
    expect(result.data?.breakdown).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('agent usage keeps two files and two lines with named problems', async () => {
    // Sorted reads name the damage first: the mixed file's invalid lines
    // sort before the fully-unreadable file's missing facts.
    const texts: Record<string, string> = {
      'projects/w/a.jsonl': `${agentLine('a')}\n`,
      'projects/w/b.jsonl': `${agentLine('a')}\n{broken\n${agentLine('c')}\n`,
      'projects/w/c.jsonl': '{broken\n',
    }
    const io = {
      read: (file: string) => {
        const text = texts[file]
        return text === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(text)
      },
      list: () => Promise.reject(new Error('unused')),
    }
    const files: AgentUsageFile[] = Object.keys(texts).map((file) => ({
      agent: 'claudeCode',
      file,
      io,
    }))
    const result = await agentUsageSource(['claudeCode'], files, scrub).read(contextFor('usage'))
    expect(result.data).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('check runs keep two journal lines with a named problem', async () => {
    await mkdir(TEMP, { recursive: true })
    const directory = await mkdtemp(path.join(TEMP, 'record-boundary-checks-'))
    onTestFinished(() => removeFolder(directory))
    const storage = new ReportStorage(directory)
    const journal = new CheckRunJournal({ storage, scrub })
    await storage.transaction(['checks'], true, async (files) => {
      await files.write(
        'workspace.jsonl',
        [JSON.stringify(goodCheck('a', 1)), '{"bad":true}', JSON.stringify(goodCheck('b', 2))].join(
          '\n',
        ) + '\n',
      )
    })
    const result = await journal.source().read(contextFor('quality'))
    expect(result.data).toHaveLength(2)
    expect(result.record.status).toBe('partial')
  })

  it('questions keep two rows with a named problem', async () => {
    const good: ReportQuestion = { id: 'q1', text: 'First', state: 'open', milestoneIds: [] }
    const result = await questionsSource(
      {
        read: () =>
          Promise.resolve({
            questions: [
              good,
              malformed({ ...good, id: '' }, good),
              { ...good, id: 'q2', text: 'Second' },
            ],
            observedAt: REPORT_FIXTURE_AS_OF,
          }),
      },
      scrub,
    ).read(contextFor('project'))
    expect(result.data).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('accounts keep two usage rows with a named problem', async () => {
    const good: AccountsFacts['usage'][number] = {
      provider: 'meta',
      account: 'primary',
      label: 'Primary',
      period: 'day',
      inputTokens: 10,
      outputTokens: 2,
      costUsd: null,
      certainty: 'unknown',
    }
    const sources = stubLocalSources({
      accounts: createAccountsReportReader({
        dataDir: path.join(TEMP, 'record-boundary-no-registry'),
        readUsage: () =>
          Promise.resolve([
            good,
            malformed({ ...good, inputTokens: -1 }, good),
            { ...good, account: 'second' },
          ]),
      }),
    })
    const result = await sources.accounts.read(contextFor('accounts'))
    expect(result.data?.usage).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('security keeps two audit rows with a named problem', async () => {
    const snapshot = canaryVaultSnapshot()
    const good = snapshot.audit[0]!
    const sources = stubLocalSources({
      security: createSecurityReportReader({
        dataDir: path.join(TEMP, 'record-boundary-no-audit'),
        readVault: () =>
          Promise.resolve({
            ...snapshot,
            audit: [
              good,
              malformed({ ...good, decision: 'bogus' }, good),
              { ...good, outcome: 'denied' },
            ],
          }),
      }),
    })
    const result = await sources.security.read(contextFor('security'))
    expect(result.data?.audit).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('certification keeps two files with a named problem and no path in the reason', async () => {
    const good = '- [x] Done\n'
    const result = await certificationSource(
      {
        read: (file: string) =>
          file.endsWith('bad.md') ? Promise.reject(new Error('boom')) : Promise.resolve(good),
        list: (directory: string) =>
          Promise.resolve(
            directory === 'docs/certification'
              ? [
                  { name: 'm113-a.md', directory: false },
                  { name: 'm113-bad.md', directory: false },
                  { name: 'm113-c.md', directory: false },
                ]
              : [],
          ),
      },
      scrub,
    ).read(contextFor('project'))
    expect(result.data?.records).toHaveLength(2)
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.failed)
    expect(result.record.reason).not.toContain('m113-bad')
  })

  it('package keeps two scripts with a named problem', async () => {
    const result = await packageSource(
      {
        read: () =>
          Promise.resolve(
            JSON.stringify({ scripts: { quality: 'run-s a', a: 'echo hi', bad: 42 } }),
          ),
        list: () => Promise.reject(new Error('unused')),
      },
      scrub,
    ).read(contextFor('project'))
    expect(result.data?.qualityScripts.map((entry) => entry.name)).toEqual(['a', 'quality'])
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('keybindings keep two bindings with a named problem', async () => {
    const result = await keybindingsSource(() => ({
      contributes: {
        commands: [],
        keybindings: [
          { command: 'good.one', key: 'ctrl+g' },
          malformed({ command: 'bad' }, { command: 'good.one', key: 'ctrl+g' }),
          { command: 'good.two', key: 'ctrl+h' },
        ],
      },
    })).read(contextFor('keybindings'))
    const bindings = result.data?.find((section) => section.id === 'keybindings/keybindings')
    const commands = (bindings?.rows ?? []).map((row) =>
      row.cells['command']?.type === 'text' ? row.cells['command'].value : '',
    )
    expect(commands.filter((command) => command === 'good.one')).toHaveLength(3)
    expect(commands.filter((command) => command === 'good.two')).toHaveLength(3)
    expect(commands).not.toContain('bad')
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
  })

  it('usage journal keeps two records with the incomplete-journal problem', async () => {
    await mkdir(TEMP, { recursive: true })
    const dataFolder = await mkdtemp(path.join(TEMP, 'record-boundary-journal-'))
    onTestFinished(() => removeFolder(dataFolder))
    const store = new UsageJournalStore(new NodeUsageFs(dataFolder), {
      writerId: 'writer',
      now: () => Date.parse(REPORT_FIXTURE_AS_OF),
      isEnabled: () => true,
      onWriteError: () => {
        throw new Error('journal write failed')
      },
    })
    store.append(journalRecord('r1'))
    store.append(journalRecord('r2'))
    await store.flush()
    await appendFile(
      path.join(dataFolder, USAGE_JOURNAL_ROOT, USAGE_DAYS_FOLDER, '2026-10-06', 'writer.jsonl'),
      '{broken\n',
    )
    const journal = await readUsageReportJournal(dataFolder, EN)
    expect(journal.records).toHaveLength(2)
    expect(journal.partial).toContain(EN.reportDetailReasons.journalIncomplete)
  })

  it('forwarded sections keep two sections with an unavailable record for the bad one', () => {
    const good = facet('schedules', 'usage', 1)
    const snapshot = buildSourceSnapshot({
      schedules: availableSource('schedules', [
        good,
        malformed<ReportSection>({ bogus: true }, good),
        facet('schedules', 'limits', 1),
      ]),
    })
    const document = fixtureCollector(snapshot, reportOptions('schedules'))
    const ids = document.sections.map((section) => section.id)
    expect(ids).toContain('schedules/usage')
    expect(ids).toContain('schedules/limits')
    expect(
      document.sources.some(
        (source) => source.id === 'schedules/records/1' && source.status === 'unavailable',
      ),
    ).toBe(true)
  })
})
