import { createReportingServices } from '../../src/runtime/reporting/engine'
// M113 C-M113-2: bound session and usage inputs over real directories.
import { writeFile, appendFile, mkdir, symlink, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { reportInputsLoader } from '../../src/runtime/reporting/reportInputsLoader'
import { tempDirTracker } from './helpers/reporting/tempDir'
import { createUsageRecording } from '../../src/core/usage/recording'
import {
  createLocalReportSources,
  type LocalReportSourceDeps,
} from '../../src/core/reporting/sources'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { STORED_SESSION_VERSION } from '../../src/shared/constants'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import { sessionSource } from '../../src/core/reporting/sources/session'
import {
  createReportJournalReader,
  readHostReportSession,
  createSessionReportReader,
  createUsageReportReader,
  readStoredReportSession,
  readUsageReportJournal,
  reportTimezoneOffset,
} from '../../src/runtime/reporting/reportInputs'
import { usageLocalDay } from '../../src/core/usage/aggregate'
import type { UsageReportJournal } from '../../src/core/usage/reportUsage'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { Usd } from '../../src/shared/usd'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { reportingServicesFor } from './helpers/reporting/runtime'
import { usageReportFixtureRecord } from './helpers/usageFixture'

setUiText(EN, 'en')

const temps = tempDirTracker()
afterEach(async () => {
  setUiText(EN, 'en')
  await temps.cleanup()
})
const dir = (prefix: string) => temps.dir(prefix)

const NOW = Date.parse('2026-10-07T12:00:00Z')
const TODAY = usageLocalDay(NOW)
const AS_OF = new Date(NOW).toISOString()
const context = (options?: { sessionId?: string; scope?: string; by?: 'session' }) => ({
  reportText: EN,
  asOf: AS_OF,
  workspaceKey: 'fixture',
  options: {
    kind: 'session' as const,
    scope: options?.scope ?? '',
    full: false,
    network: false,
    failOn: [],
    asOf: AS_OF,
    ...(options?.sessionId !== undefined && { sessionId: options.sessionId }),
    ...(options?.by !== undefined && { by: options.by }),
  },
  signal: new AbortController().signal,
})

function storedSession(sessionId: string) {
  return {
    version: STORED_SESSION_VERSION,
    sessionId,
    workspaceRoot: '/fixture/workspace',
    modelId: 'fixture-model',
    approvalMode: 'promptUnmatched',
    effort: 'normal',
    createdAt: AS_OF,
    lastActivityAt: AS_OF,
    turnIds: ['t1', 't2'],
    todos: [],
    replay: [],
    transcript: [
      {
        turnId: 't1',
        item: {
          itemId: 'u1',
          kind: 'userMessage',
          status: 'completed',
          turnId: 't1',
          text: 'Start',
        },
      },
      {
        turnId: 't2',
        item: {
          itemId: 'tool1',
          kind: 'toolCall',
          status: 'completed',
          turnId: 't2',
          tool: 'read',
          patchSummary: { files: 1, added: 2, removed: 0 },
        },
      },
    ],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}

/**
 * One kept journal record plus a journal reader whose budget read always
 * throws, read for the usage kind so the budget machinery runs. With damage,
 * the journal is already partial (journalIncomplete) before budgets fail.
 */
async function rejectedBudgetSetup(data: string, isDamaged: boolean) {
  await journalWith(data, [usageEntry('r1', 's1')])
  if (isDamaged)
    await appendFile(
      path.join(data, 'usage/v1/days', TODAY, 'writer.jsonl'),
      '{broken}\n{"v":99}\n{"v":',
    )
  const readJournal = createReportJournalReader({
    dataFolder: data,
    now: () => NOW,
    timezoneOffsetMins: 0,
    readBudgets: () => Promise.reject(new Error('ledger gone')),
  })
  const run = {}
  const usageOptions = { ...context().options, kind: 'usage' as const, scope: 'today' }
  const journal = await readJournal({ ...context(), run, options: usageOptions })
  const usage = await createUsageReportReader({
    dataFolder: data,
    readJournal,
    now: () => NOW,
    timezoneOffsetMins: 0,
  })({ ...context(), run, options: usageOptions })
  return { readJournal, run, usageOptions, journal, usage }
}

function usageEntry(id: string, session: string, day: string = TODAY) {
  return usageReportFixtureRecord({
    at: NOW,
    day,
    id,
    timezoneOffsetMins: 0,
    session,
  })
}

function fakeReportHost<const Items extends readonly unknown[]>(
  items: Items,
  models: readonly { readonly modelId: string; readonly isActive: boolean }[],
) {
  return {
    info: {
      kind: 'museCode' as const,
      serverName: 'fake',
      serverVersion: '1',
      grantedCapabilities: [],
      canEditSessions: true,
    },
    readSession: vi.fn(() => Promise.resolve({ mode: 'inline', name: 'Fake', items, todos: [] })),
    listModels: vi.fn(() =>
      Promise.resolve(
        models.map((model) => ({
          modelId: model.modelId,
          displayLabel: model.modelId,
          contextLimit: undefined,
          isDefault: true,
          isActive: model.isActive,
        })),
      ),
    ),
  }
}

function partialOccurrences(partial: string | undefined, sentence: string): number {
  return partial === undefined ? 0 : partial.split(sentence).length - 1
}

function readDailyBudget() {
  return Promise.resolve([
    {
      budget: {
        id: 'daily',
        kind: 'paidDaily' as const,
        spentUsd: Usd.from('0.5').toAmount(),
        capUsd: Usd.from(1).toAmount(),
        stopped: false,
      },
    },
  ])
}

function dailyBudgetReads() {
  return readDailyBudget
}

function expectDailyBudgetRow(partial: string | undefined, limits: readonly unknown[]): void {
  expect(partial ?? '').not.toContain(EN.reportDetailReasons.budgetsUnavailable)
  expect(limits).toEqual([
    { key: 'paidDaily/daily', used: 0.5, limit: 1, resetsAt: null, unit: 'usd' },
  ])
}

async function journalWith(dataFolder: string, entries: readonly unknown[]): Promise<void> {
  const store = new UsageJournalStore(new NodeUsageFs(dataFolder), {
    writerId: 'test-writer',
    now: () => NOW,
    isEnabled: () => true,
    onWriteError: () => undefined,
  })
  for (const entry of entries) store.append(entry)
  await store.flush()
}

describe('bound report inputs', () => {
  it('reads a stored session by id and refuses path escapes', async () => {
    const sessions = await dir('report-sessions-')
    await writeFile(path.join(sessions, 'abc123.json'), JSON.stringify(storedSession('abc123')))
    const read = await readStoredReportSession(sessions, 'abc123')
    expect(read?.modelId).toBe('fixture-model')
    expect(read?.turnIds).toEqual(['t1', 't2'])
    expect(read?.items).toHaveLength(2)
    expect(read?.backend).toBe('modelApi')
    expect(await readStoredReportSession(sessions, 'missing')).toBeNull()
    expect(await readStoredReportSession(sessions, '../outside')).toBeNull()
    expect(await readStoredReportSession(sessions, '')).toBeNull()
    await writeFile(path.join(sessions, 'broken.json'), '{nope')
    await expect(readStoredReportSession(sessions, 'broken')).rejects.toBeInstanceOf(
      LocalSourceError,
    )
  })

  it('reads an empty journal on a fresh install and real rows after turns', async () => {
    const data = await dir('report-journal-')
    expect(await readUsageReportJournal(data, EN)).toEqual({ records: [], rollups: [], limits: [] })
    await journalWith(data, [usageEntry('r1', 's1'), usageEntry('r2', 's2')])
    const journal = await readUsageReportJournal(data, EN)
    expect(journal.records).toHaveLength(2)
    const reader = createUsageReportReader({
      dataFolder: data,
      now: () => NOW,
      timezoneOffsetMins: 0,
    })
    const facts = await reader(context({ scope: 'today' }))
    expect(facts.usage.inputTokens).toBe(200)
    expect(facts.usage.breakdown).toHaveLength(1)
  })

  it('builds the session source from live history and journal usage', async () => {
    const data = await dir('report-session-')
    await journalWith(data, [usageEntry('r1', 'live-session'), usageEntry('r2', 'other')])
    const reader = createSessionReportReader({
      resolveSession: () =>
        Promise.resolve({
          sessionId: 'live-session',
          backend: 'modelApi' as const,
          modelId: 'fixture-model',
          items: [
            { itemId: 'u1', kind: 'userMessage', status: 'completed', turnId: 't1', text: 'Hi' },
            {
              itemId: 'tool1',
              kind: 'toolCall',
              status: 'completed',
              turnId: 't1',
              tool: 'read',
              patchSummary: { files: 1, added: 3, removed: 1 },
              paid: 'imageGeneration',
            },
          ],
          turnIds: [],
        }),
      readJournal: () => readUsageReportJournal(data, EN),
    })
    const source = sessionSource(reader, [], (text) => text)
    const result = await source.read(context({ sessionId: 'live-session' }))
    expect(result.record.status).toBe('ok')
    expect(result.data?.activity.turns).toEqual({ status: 'available', count: 1 })
    expect(result.data?.activity.approvals.status).toBe('unavailable')
    expect(result.data?.export.modelId).toBe('fixture-model')
    expect(result.data?.usage.inputTokens).toBe(100)
    // Checks run arrive through the workspace check-run source, which the
    // collector prefers; the payload itself stays an empty list.
    expect(result.data?.checkRuns).toEqual([])
  })

  it('reports an unknown session as unavailable history, never an empty success', async () => {
    const data = await dir('report-missing-')
    const reader = createSessionReportReader({
      resolveSession: () => Promise.resolve(null),
      readJournal: () => readUsageReportJournal(data, EN),
    })
    await expect(reader.read(context({ sessionId: 'ghost' }))).rejects.toMatchObject({
      code: 'history',
    })
  })

  it('R5 discloses missing usage for a nonempty stored session', async () => {
    const sessions = await dir('report-fallback-')
    const data = await dir('report-fallback-journal-')
    await writeFile(path.join(sessions, 'stored1.json'), JSON.stringify(storedSession('stored1')))
    const bundle = {
      readStoredReportSession,
      readUsageReportJournal,
      createSessionReportReader,
    }
    const reader = bundle.createSessionReportReader({
      resolveSession: (sessionId) =>
        sessionId === undefined
          ? Promise.resolve(null)
          : bundle.readStoredReportSession(sessions, sessionId),
      readJournal: () => bundle.readUsageReportJournal(data, EN),
    })
    const result = await sessionSource(reader, [], (text) => text).read(
      context({ sessionId: 'stored1' }),
    )
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toContain(EN.reportDetailReasons.sessionUsageUnavailable)
    expect(result.data?.activity.turns).toEqual({ status: 'available', count: 2 })
  })
})

describe('RVCM1132 input regressions', () => {
  it('R5 discloses unattributable rollups alongside kept session usage', async () => {
    const data = await dir('partial-rollup-session-')
    await writeFile(path.join(data, 's1.json'), JSON.stringify(storedSession('s1')))
    await journalWith(data, [usageEntry('raw', 's1')])
    const journal = await readUsageReportJournal(data, EN)
    const reader = createSessionReportReader({
      resolveSession: () => readStoredReportSession(data, 's1'),
      readJournal: () =>
        Promise.resolve<UsageReportJournal>({
          ...journal,
          rollups: [
            {
              day: TODAY,
              client: 'vscode',
              backend: 'modelApi',
              provider: 'meta',
              model: 'muse-spark',
              kind: 'turn',
              histogram: [],
              totals: {
                records: 1,
                tokens: { input: 50 },
                units: {},
                costs: [],
                retries: 0,
                rateLimited: 0,
              },
            },
          ],
        }),
    })
    const result = await sessionSource(reader, [], (text) => text).read(
      context({ sessionId: 's1' }),
    )
    expect(result.record.status).toBe('partial')
    // Session totals sum only attributable records, so the disclosure says
    // the rollup is excluded from them, never included (RVCM1132B finding 1).
    expect(result.record.reason).toContain(EN.reportDetailReasons.rolledUpSessionExcluded)
    expect(result.record.reason).not.toContain(EN.reportDetailReasons.rolledUpBreakdownExcluded)
    expect(result.data?.usage.inputTokens).toBe(100)
  })

  it('R2 shares one journal snapshot between concurrent sources and refreshes next run', async () => {
    const data = await dir('shared-report-')
    await journalWith(
      data,
      Array.from({ length: 100 }, (_, index) => usageEntry(`r${String(index)}`, 's1')),
    )
    const beforeRead = vi.fn(() => Promise.resolve())
    const readJournal = createReportJournalReader({ dataFolder: data, beforeRead })
    const ctx = context({ sessionId: 's1' })
    const [left, right] = await Promise.all([readJournal(ctx), readJournal({ ...ctx })])
    expect(left).toBe(right)
    expect(left.records).toHaveLength(100)
    expect(beforeRead).toHaveBeenCalledTimes(1)
    const session = createSessionReportReader({
      resolveSession: () => readStoredReportSession(data, 's1'),
      readJournal,
    })
    await writeFile(path.join(data, 's1.json'), JSON.stringify(storedSession('s1')))
    const usage = createUsageReportReader({ dataFolder: data, readJournal, timezoneOffsetMins: 0 })
    const rows = await Promise.all([session.read(ctx), usage(ctx)])
    expect(rows.every((row) => row !== null && row.usage.inputTokens === 10_000)).toBe(true)
    await readJournal({ ...ctx, run: {} })
    expect(beforeRead).toHaveBeenCalledTimes(2)
  })

  it('R3 waits for production recording flush before collecting the journal', async () => {
    const data = await dir('flush-report-')
    const writer = new UsageJournalStore(new NodeUsageFs(data), {
      writerId: 'writer',
      now: () => NOW,
      isEnabled: () => true,
      onWriteError: () => {
        throw new Error('write failed')
      },
    })
    const { promise: held, resolve: release } = Promise.withResolvers<undefined>()
    const recording = createUsageRecording({
      client: 'acp',
      now: () => NOW,
      newId: () => 'pending',
      isEnabled: () => true,
      log: {
        trace: () => undefined,
        info: () => undefined,
        error: () => undefined,
        warn: () => {
          throw new Error('recording failed')
        },
      },
      writer: async () => {
        await held
        return writer
      },
    })
    recording.note(
      { input_tokens: 100, output_tokens: 20 },
      {
        backend: 'modelApi',
        provider: 'meta',
        model: 'muse-spark',
        kind: 'turn',
        outcome: 'completed',
        startedAt: NOW,
        session: 's1',
      },
    )
    const beforeRead = vi.fn(() => recording.flush())
    const readJournal = createReportJournalReader({ dataFolder: data, beforeRead })
    let hasFinished = false
    const pending = (async () => {
      const result = await readJournal(context())
      hasFinished = true
      return result
    })()
    await Promise.resolve()
    expect(hasFinished).toBe(false)
    expect(beforeRead).toHaveBeenCalledOnce()
    release(undefined)
    const flushed = await pending
    expect(flushed.records[0]?.tokens.input).toBe(100)
  })

  it('R4 exposes invalid, torn and newer journal entries as partial on both sources', async () => {
    const data = await dir('damaged-report-')
    await journalWith(data, [usageEntry('valid', 's1')])
    await appendFile(
      path.join(data, 'usage/v1/days', TODAY, 'writer.jsonl'),
      '{broken}\n{"v":99}\n{"v":',
    )
    await mkdir(path.join(data, 'usage/v1/rollups'), { recursive: true })
    await writeFile(path.join(data, 'usage/v1/rollups/2026-09.json'), '{"v":99}')
    const readJournal = createReportJournalReader({ dataFolder: data })
    const ctx = context({ sessionId: 's1' })
    const journal = await readJournal(ctx)
    expect(journal.records).toHaveLength(1)
    expect(journal.partial).toContain(EN.reportDetailReasons.journalIncomplete)
    const usage = await createUsageReportReader({
      dataFolder: data,
      readJournal,
      timezoneOffsetMins: 0,
    })(ctx)
    expect(usage.partial).toContain(EN.reportDetailReasons.journalIncomplete)
    const session = createSessionReportReader({
      resolveSession: () =>
        Promise.resolve({
          sessionId: 's1',
          backend: 'modelApi',
          modelId: 'fixture-model',
          items: [],
          turnIds: [],
        }),
      readJournal,
    })
    const observed = await sessionSource(session, [], (text) => text).read(ctx)
    expect(observed.record.status).toBe('partial')
  })

  it('R15b reads budgets only for the usage kinds that render limits', async () => {
    const data = await dir('budgets-kind-report-')
    await journalWith(data, [usageEntry('r1', 's1')])
    const readBudgets = vi.fn((): Promise<never> => {
      throw new Error('budgets down')
    })
    const readJournal = createReportJournalReader({ dataFolder: data, readBudgets })
    const sessionCtx = context({ sessionId: 's1' })
    const sessionJournal = await readJournal(sessionCtx)
    expect(readBudgets).not.toHaveBeenCalled()
    expect(sessionJournal.budgets).toBeUndefined()
    expect(sessionJournal.partial).toBeUndefined()
    const usageJournal = await readJournal({
      ...sessionCtx,
      run: {},
      options: { ...sessionCtx.options, kind: 'usage' as const },
    })
    expect(readBudgets).toHaveBeenCalledTimes(1)
    expect(usageJournal.partial).toContain(EN.reportDetailReasons.budgetsUnavailable)
  })

  it('R6 refuses file links but reads through linked directory ancestors', async () => {
    const root = await dir('linked-report-')
    const sessions = path.join(root, 'sessions')
    const outside = path.join(root, 'outside')
    await mkdir(sessions)
    await mkdir(outside)
    await writeFile(path.join(outside, 'linked.json'), JSON.stringify(storedSession('linked')))
    await symlink(path.join(outside, 'linked.json'), path.join(sessions, 'linked.json'))
    await expect(readStoredReportSession(sessions, 'linked')).rejects.toMatchObject({
      code: 'refused',
    })
    await symlink(
      outside,
      path.join(sessions, 'ancestor'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    // Ancestors of the real directory (a symlinked data folder, home, or
    // /var and /tmp on macOS) resolve through realpath and never refuse an
    // ordinary file (RVCM1132B finding 6); only a linked file itself refuses.
    const through = await readStoredReportSession(path.join(sessions, 'ancestor'), 'linked')
    expect(through?.sessionId).toBe('linked')
  })

  it('R7 refuses a stored session whose envelope has another identity', async () => {
    const sessions = await dir('identity-report-')
    await writeFile(path.join(sessions, 'requested.json'), JSON.stringify(storedSession('other')))
    await expect(readStoredReportSession(sessions, 'requested')).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('R1 reads primary-backend session history through the active host without resuming', async () => {
    const readSession = vi.fn(() =>
      Promise.resolve({
        mode: 'inline',
        name: 'Primary',
        items: storedSession('primary').transcript.map((entry) => entry.item),
        todos: [],
      }),
    )
    const host = {
      info: {
        kind: 'museCode' as const,
        serverName: 'fake',
        serverVersion: '1',
        grantedCapabilities: [],
        canEditSessions: true,
      },
      readSession,
      listModels: vi.fn(() =>
        Promise.resolve([
          {
            modelId: 'primary-model',
            displayLabel: 'Primary',
            contextLimit: undefined,
            isDefault: true,
            isActive: true,
          },
        ]),
      ),
    }
    const result = await readHostReportSession(host, 'primary', EN)
    expect(result).toMatchObject({
      backend: 'museCode',
      sessionId: 'primary',
      modelId: 'primary-model',
    })
    expect(result?.items).toHaveLength(2)
    expect(readSession).toHaveBeenCalledWith('primary', { recoverGoal: false })
  })

  it('R8 installs the caller language in a separately built input bundle', async () => {
    const root = await dir('language-report-')
    const outfile = path.join(root, 'inputs.cjs')
    await build({
      entryPoints: [path.resolve('src/runtime/reporting/reportInputsEntry.ts')],
      outfile,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      logLevel: 'silent',
    })
    const bundle = reportInputsLoader({
      bundlePath: outfile,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      loadBundle: createRequire(import.meta.url),
    })()
    const german: unknown = JSON.parse(await readFile(path.resolve('l10n/ui.de.json'), 'utf8'))
    // Production's table validation verifies the caller table before installation.
    const { loadUiTable } = await import('../../src/host/l10n')
    const { table } = await loadUiTable({
      language: 'de',
      readExtensionFile: () => Promise.resolve(JSON.stringify(german)),
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    })
    const result = await bundle
      .createSessionReportReader(
        {
          resolveSession: () =>
            Promise.resolve({
              sessionId: 's1',
              backend: 'museCode',
              modelId: 'm1',
              items: [],
              turnIds: [],
            }),
          readJournal: () => Promise.resolve({ records: [], rollups: [], limits: [] }),
        },
        table,
        'de',
      )
      .read({ ...context(), reportText: table })
    expect(result?.activity.approvals).toEqual({
      status: 'unavailable',
      reason: table.reportDetailReasons.sessionApprovalsUnavailable,
    })
    expect(table.reportDetailReasons.sessionApprovalsUnavailable).not.toBe(
      EN.reportDetailReasons.sessionApprovalsUnavailable,
    )
  })

  it('R18 scopes project usage to seven days and ignores milestone/release scopes', async () => {
    const data = await dir('scope-report-')
    await journalWith(data, [usageEntry('today', 's1'), usageEntry('prior', 's1', '2026-10-05')])
    const reader = createUsageReportReader({
      dataFolder: data,
      timezoneOffsetMins: 0,
      now: () => NOW,
    })
    const project = await reader({
      ...context(),
      options: { ...context().options, kind: 'project' },
    })
    expect(project.usage.inputTokens).toBe(200)
    const deps: LocalReportSourceDeps = {
      files: { read: () => Promise.reject(new Error('unused')), list: () => Promise.resolve([]) },
      git: { run: () => Promise.reject(new Error('unused')) },
      scrub: (text: string) => text,
      roots: [],
      usage: reader,
      enabledAgents: [],
      agentFiles: [],
    }
    const source = createLocalReportSources(deps).usage
    const milestone = await source.read({
      ...context(),
      options: { ...context().options, kind: 'milestone', scope: 'M113' },
    })
    expect(milestone.record.status).toBe('notApplicable')
  })

  it('RVCM1132B stamps budgets on the machine-local day, not UTC', async () => {
    const data = await dir('budget-day-report-')
    await journalWith(data, [usageEntry('r1', 's1')])
    // 2026-10-07T01:00Z is still 2026-10-06 in US Pacific (offset 420).
    const evening = Date.parse('2026-10-07T01:00:00Z')
    const readJournal = createReportJournalReader({
      dataFolder: data,
      now: () => evening,
      timezoneOffsetMins: 420,
      readBudgets: dailyBudgetReads(),
    })
    const usageOptions = { ...context().options, kind: 'usage' as const, scope: '' }
    const usageCtx = { ...context(), run: {}, options: usageOptions }
    const stamped = await readJournal(usageCtx)
    expect(stamped.budgetDay).toBe('2026-10-06')
    const usage = await createUsageReportReader({
      dataFolder: data,
      readJournal,
      now: () => evening,
      timezoneOffsetMins: 420,
    })(usageCtx)
    expectDailyBudgetRow(usage.partial, usage.usage.limits)
  })

  it('RVCM1132C reports an unknown model with its reason when no catalogue row is active', async () => {
    const items = storedSession('s1').transcript.map((entry) => entry.item)
    // Every row present but none flagged active (what the host returns when
    // the wire omits the optional flag on every row): the transcript stays
    // and the model is unknown, never a guess at the first entry.
    const host = fakeReportHost(items, [
      { modelId: 'first-model', isActive: false },
      { modelId: 'second-model', isActive: false },
    ])
    const result = await readHostReportSession(host, 's1', EN)
    expect(result?.modelId).toBe('unknown')
    expect(result?.partial).toBe(EN.reportDetailReasons.sessionModelUnavailable)
    expect(result?.items).toHaveLength(2)
    // Through the session source the report is partial with that reason.
    const data = await dir('unknown-model-report-')
    const reader = createSessionReportReader({
      resolveSession: () => Promise.resolve(result!),
      readJournal: () => readUsageReportJournal(data, EN),
    })
    const source = await sessionSource(reader, [], (text) => text).read(
      context({ sessionId: 's1' }),
    )
    expect(source.record.status).toBe('partial')
    expect(source.record.reason).toContain(EN.reportDetailReasons.sessionModelUnavailable)
    expect(source.data?.export.modelId).toBe('unknown')
  })

  it('RVCM1132B reports an empty model catalogue as a failure, not missing history', async () => {
    const host = fakeReportHost([], [])
    await expect(readHostReportSession(host, 's1', EN)).rejects.toMatchObject({ code: 'failed' })
  })

  it('RVCM1132C samples one timezone offset per report for the budget day and the period day', async () => {
    const data = await dir('shared-offset-report-')
    await journalWith(data, [usageEntry('r1', 's1')])
    // 2026-10-07T07:30Z falls on 2026-10-06 at offset 480 but 2026-10-07 at
    // offset 420: two samples would stamp the budget and the period apart.
    const evening = Date.parse('2026-10-07T07:30:00Z')
    const zone = vi
      .spyOn(Date.prototype, 'getTimezoneOffset')
      .mockReturnValueOnce(480)
      .mockReturnValue(420)
    try {
      const readJournal = createReportJournalReader({
        dataFolder: data,
        now: () => evening,
        timezoneOffsetMins: reportTimezoneOffset,
        readBudgets: dailyBudgetReads(),
      })
      const usageOptions = { ...context().options, kind: 'usage' as const, scope: '' }
      const run = {}
      const usage = await createUsageReportReader({
        dataFolder: data,
        readJournal,
        now: () => evening,
        timezoneOffsetMins: reportTimezoneOffset,
      })({ ...context(), run, options: usageOptions })
      const journal = await readJournal({ ...context(), run, options: usageOptions })
      // Both days keep the run's first sample, so the budget still applies.
      expect(journal.budgetDay).toBe('2026-10-06')
      expectDailyBudgetRow(usage.partial, usage.usage.limits)
    } finally {
      zone.mockRestore()
    }
  })

  it('RVCM1132C never repeats a partial reason on the usage or session source', async () => {
    const data = await dir('dedupe-partial-report-')
    // A thrown budget read leaves budgetsUnavailable while budgets stay
    // unset, which used to append the same sentence again below.
    const { readJournal, run, usageOptions, journal, usage } = await rejectedBudgetSetup(
      data,
      false,
    )
    const unavailable = EN.reportDetailReasons.budgetsUnavailable
    expect(partialOccurrences(journal.partial, unavailable)).toBe(1)
    expect(partialOccurrences(usage.partial, unavailable)).toBe(1)
    const session = await createSessionReportReader({
      resolveSession: () =>
        Promise.resolve({
          sessionId: 's1',
          backend: 'modelApi' as const,
          modelId: 'fixture-model',
          items: [],
          turnIds: [],
        }),
      readJournal,
    }).read({ ...context(), run, options: { ...usageOptions, sessionId: 's1' } })
    expect(partialOccurrences(session!.partial, unavailable)).toBe(1)
  })

  it('RVCM1132D prints the budget-read failure once when the journal was already partial', async () => {
    const data = await dir('dedupe-partial-damaged-')
    // The damaged journal already sets journalIncomplete, so the thrown
    // budget read joins both sentences into one string; the usage facts used
    // to append the budget sentence again because the set compared whole
    // elements, not sentences.
    const { journal, usage } = await rejectedBudgetSetup(data, true)
    const unavailable = EN.reportDetailReasons.budgetsUnavailable
    expect(journal.partial).toContain(EN.reportDetailReasons.journalIncomplete)
    expect(partialOccurrences(journal.partial, unavailable)).toBe(1)
    expect(partialOccurrences(usage.partial, unavailable)).toBe(1)
    expect(usage.partial).toContain(EN.reportDetailReasons.journalIncomplete)
  })

  it('RVCM1132B surfaces a failed session resolution as a failure, not missing history', async () => {
    const data = await dir('failed-session-report-')
    const reader = createSessionReportReader({
      resolveSession: () => Promise.reject(new LocalSourceError('failed')),
      readJournal: () => readUsageReportJournal(data, EN),
    })
    const result = await sessionSource(reader, [], (text) => text).read(
      context({ sessionId: 's1' }),
    )
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toBe(EN.reportSourceReasons.failed)
  })
})

describe('report input lazy ownership', () => {
  it('R19 never touches session or usage readers for unrelated report kinds', async () => {
    const usage = vi.fn(() => Promise.reject(new Error('must remain unloaded')))
    const read = vi.fn(() => Promise.reject(new Error('must remain unloaded')))
    const deps: LocalReportSourceDeps = {
      files: { read: () => Promise.reject(new Error('unused')), list: () => Promise.resolve([]) },
      git: { run: () => Promise.reject(new Error('unused')) },
      scrub: (text) => text,
      roots: [],
      session: { read },
      usage,
      enabledAgents: [],
      agentFiles: [],
    }
    const sources = createLocalReportSources(deps)
    for (const kind of ['quality', 'milestone', 'release', 'changes'] as const) {
      const ctx = {
        ...context(),
        options: { ...context().options, kind, scope: kind === 'milestone' ? 'M113' : '' },
      }
      const session = await sources.session.read(ctx)
      const usage = await sources.usage.read(ctx)
      expect(session.record.status).toBe('notApplicable')
      expect(usage.record.status).toBe('notApplicable')
    }
    expect(read).not.toHaveBeenCalled()
    expect(usage).not.toHaveBeenCalled()
  })

  it('R21 keeps the unused alternate e2e entry absent and outside knip exemptions', async () => {
    await expect(readFile(path.resolve('test/e2e/reportsLiveEntry.ts'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readFile(path.resolve('knip.jsonc'), 'utf8')).not.toContain('reportsLiveEntry.ts')
  })
})

it('R2 every engine generation gets a new snapshot even with reused options and stamp', async () => {
  const data = await dir('generation-report-')
  await journalWith(data, [usageEntry('first', 's1')])
  const readJournal = createReportJournalReader({ dataFolder: data })
  const usage = createUsageReportReader({ dataFolder: data, readJournal, timezoneOffsetMins: 0 })
  const services = createReportingServices({
    workspaceRoot: data,
    storageRoot: path.join(data, 'reports'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: 'test',
    keepHistory: false,
    enabledAgents: [],
    usage,
  })
  const options = { ...context({ scope: 'today' }).options, kind: 'usage' as const }
  const tokens = async () => {
    const result = await services.generate?.(options)
    if (result?.status !== 'generated') throw new Error('Expected usage report')
    const total = result.document.sections
      .find((section) => section.id === 'totals')
      ?.rows.find((row) => row.cells['inputTokens']?.type === 'count')?.cells['inputTokens']
    if (total === undefined) throw new Error('Expected token total')
    return total.type === 'count' ? total.value : null
  }
  expect(await tokens()).toBe(100)
  await journalWith(data, [usageEntry('second', 's1')])
  expect(await tokens()).toBe(200)
})

describe('RVCM1132C real PLAN.md reports', () => {
  let storage = ''
  let services: ReturnType<typeof createReportingServices> | undefined
  beforeAll(async () => {
    storage = await dir('real-plan-reports-')
    services = createReportingServices({
      workspaceRoot: process.cwd(),
      storageRoot: storage,
      l10n: { table: EN, locale: 'en' },
      generatorVersion: 'test',
      keepHistory: false,
      enabledAgents: [],
    })
  })

  it('generates a usage report against the repository real PLAN.md', async () => {
    const asOf = new Date().toISOString()
    const usage = await services?.generate?.({
      kind: 'usage',
      scope: 'today',
      asOf,
      full: false,
      network: false,
      failOn: [],
    })
    expect(usage?.status).toBe('generated')
  })

  it('generates a session report against the repository real PLAN.md', async () => {
    const asOf = new Date().toISOString()
    const session = await services?.generate?.({
      kind: 'session',
      scope: '',
      asOf,
      full: false,
      network: false,
      failOn: [],
    })
    expect(session?.status).toBe('generated')
  })

  it('generates every kind with a duplicated open-question id instead of failing', async () => {
    const workspace = await dir('duplicate-plan-reports-')
    // The milestones section keeps this plan parsed (format plan-format-v1),
    // so both duplicates really attach to M12; without it the reader returns
    // format none with no questions and the test cannot fail (RVCM1132D
    // finding 3).
    await writeFile(
      path.join(workspace, 'PLAN.md'),
      [
        '# Fixture plan',
        '',
        '## 3. Open questions',
        '- **Q-DUP — First form (2026-10-06).**',
        '  The first body for M12.',
        '- **Q-DUP — Second form (2026-10-06).**',
        '  The second body for M12.',
        '- **Q-SAME — Same form (2026-10-06).**',
        '  The same body for M12.',
        '- **Q-SAME — Same form (2026-10-06).**',
        '  The same body for M12.',
        '',
        '## 6. Milestones',
        '### M12 — Fixture',
        '**Status 2026-10-05: planned.**',
        '',
      ].join('\n'),
    )
    const duplicated = reportingServicesFor(workspace)
    const asOf = new Date().toISOString()
    for (const options of [
      { kind: 'usage', scope: 'today' },
      { kind: 'session', scope: '' },
      { kind: 'milestone', scope: 'M12' },
    ] as const) {
      const result = await duplicated.generate?.({
        ...options,
        asOf,
        full: false,
        network: false,
        failOn: [],
      })
      // Before the fix the milestone kind threw Invalid report document (exit 1).
      expect(result?.status).toBe('generated')
    }
  })
})
