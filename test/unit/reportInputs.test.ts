// M113 C-M113-2: bound session and usage inputs over real directories.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { STORED_SESSION_VERSION } from '../../src/shared/constants'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import { sessionSource } from '../../src/core/reporting/sources/session'
import {
  createSessionReportReader,
  createUsageReportReader,
  readStoredReportSession,
  readUsageReportJournal,
} from '../../src/runtime/reporting/reportInputs'
import { usageLocalDay } from '../../src/core/usage/aggregate'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'

setUiText(EN, 'en')

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function dir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

const NOW = Date.parse('2026-10-07T12:00:00Z')
const TODAY = usageLocalDay(NOW)
const AS_OF = new Date(NOW).toISOString()
const context = (options?: { sessionId?: string; scope?: string; by?: 'session' }) => ({
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

function usageEntry(id: string, session: string, day: string = TODAY) {
  return {
    v: 1,
    id,
    at: NOW,
    day,
    timezoneOffsetMins: 0,
    client: 'vscode',
    backend: 'modelApi',
    provider: 'meta',
    type: 'usage',
    model: 'muse-spark',
    kind: 'turn',
    tokens: { input: 100, output: 20 },
    cost: { usd: 0.25, certainty: 'reported' },
    outcome: 'completed',
    startedAt: NOW,
    session,
  }
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
    expect(await readUsageReportJournal(data)).toEqual({ records: [], rollups: [], limits: [] })
    await journalWith(data, [usageEntry('r1', 's1'), usageEntry('r2', 's2')])
    const journal = await readUsageReportJournal(data)
    expect(journal.records).toHaveLength(2)
    const reader = createUsageReportReader({ dataFolder: data, now: () => NOW })
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
      readJournal: () => readUsageReportJournal(data),
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
      readJournal: () => readUsageReportJournal(data),
    })
    await expect(reader.read(context({ sessionId: 'ghost' }))).rejects.toMatchObject({
      code: 'history',
    })
  })

  it('resolves a stored fallback session for a non-current id', async () => {
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
      readJournal: () => bundle.readUsageReportJournal(data),
    })
    const result = await sessionSource(reader, [], (text) => text).read(
      context({ sessionId: 'stored1' }),
    )
    expect(result.record.status).toBe('ok')
    expect(result.data?.activity.turns).toEqual({ status: 'available', count: 2 })
  })
})
