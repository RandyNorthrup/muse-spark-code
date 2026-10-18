// Lane USAGETRUE: usage and cost say what really happened (F20–F24).
// Pure proof through the REAL modules, fed with REAL shapes: `session/tokenUsage`
// frames shaped like Muse Code SDK 1.4.4's SessionTokenUsageParams (msp.d.ts,
// one frame per model completion), with per-completion magnitudes in the shape
// of the CLI's own durable `model_completed` records (usage + duration_ms +
// effective model, read-only evidence under the Muse sessions root; account
// ids absent). No doubles of our modules: the recording runs into a real
// UsageJournalStore on a real temporary folder, then the real aggregate,
// service and text.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { USAGE_DAYS_FOLDER, USAGE_FOLDER, USAGE_VERSION_FOLDER } from '../../src/shared/constants'
import { afterEach, describe, expect, it } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { MuseUsageDeltas, museCodeLimitInput } from '../../src/core/backends/musecode/usageDeltas'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { createTestRecording } from './helpers/testRecording'
import { createUsageService } from '../../src/core/usage/usageService'
import { usageText } from '../../src/core/usage/usageText'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import type { UsageLimitSnapshot, UsageRecord } from '../../src/shared/usageJournal'

const roots: string[] = []
afterEach(async () => {
  setUiText(EN, 'en')
  setUsageText(USAGE_EN)
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})

// The review lane's shape, scaled down: contributor-tier completions with the
// CLI's own per-request counters (cached inside input, reasoning inside
// output) and each request's own wall time, spread over two hours of one day.
const MODEL = 'muse-wonder-full-1.0-contributor'
const STANDING_MODEL = 'muse-wonder-full-1.0'
const COMPLETIONS = [
  {
    at: new Date(2026, 9, 14, 9, 10).getTime(),
    input: 1_000_000,
    cached: 950_000,
    output: 10_000,
    reasoning: 100,
    durationMs: 30_000,
  },
  {
    at: new Date(2026, 9, 14, 9, 50).getTime(),
    input: 1_200_000,
    cached: 1_140_000,
    output: 12_000,
    reasoning: 200,
    durationMs: 40_000,
  },
  {
    at: new Date(2026, 9, 14, 10, 20).getTime(),
    input: 800_000,
    cached: 760_000,
    output: 8000,
    reasoning: 48,
    durationMs: 50_000,
  },
] as const
const TOTAL_CACHED = 2_850_000
const TOTAL_REASONING = 348
const PLAN_NAME = 'Muse Code Max Usage subscription'

function tokenUsageFrame(
  sessionId: string,
  completion: (typeof COMPLETIONS)[number],
  cumulativeInput: number,
  cumulativeOutput: number,
) {
  return {
    method: 'session/tokenUsage',
    params: {
      sessionId,
      // The effective model that produced this usage (SDK 1.4.4): the tier
      // the request was really sent as, not the session's standing model.
      modelId: MODEL,
      // Counted once under the provider's cache convention: the superset the
      // journal's cached-input invariant is checked against.
      promptTokens: completion.input,
      totalTokens: completion.input + completion.output,
      // This model call's own wall time (SDK 1.4.4).
      durationMs: completion.durationMs,
      turnId: 'turn-1',
      finishReason: 'tool_calls',
      // Raw counters verbatim from the durable record.
      usage: {
        inputTokens: completion.input,
        outputTokens: completion.output,
        cachedTokens: completion.cached,
        reasoningTokens: completion.reasoning,
      },
      cumulative: { promptTokens: cumulativeInput, outputTokens: cumulativeOutput },
      viewCursor: 'cursor',
    },
  }
}

function tokenUsageEvent(sessionId: string, frame: ReturnType<typeof tokenUsageFrame>): AgentEvent {
  const mapped = mapNotification(frame)
  if (typeof mapped === 'string') throw new Error(`unmapped test frame: ${mapped}`)
  if (!('event' in mapped)) throw new Error(`unmapped test frame: ${mapped.sessionId}`)
  expect(mapped.sessionId).toBe(sessionId)
  return mapped.event
}

async function recordedThroughRealJournal(shouldRepeatFirst = false): Promise<{
  readonly records: readonly UsageRecord[]
  readonly limits: readonly UsageLimitSnapshot[]
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'usagetrue-'))
  roots.push(root)
  const warnings: string[] = []
  let nowMs = COMPLETIONS[0].at
  const { recording, store } = createTestRecording(
    {
      root,
      writerId: 'usage-truth-writer',
      client: 'test',
      now: () => nowMs,
      newId: (() => {
        let next = 0
        return () => `id-${String((next += 1))}`
      })(),
    },
    warnings,
  )
  const sessionId = '01a13b83-c144-7603-8aa4-c81f912efdd3'
  const deltas = new MuseUsageDeltas(recording, sessionId, STANDING_MODEL, true, () => nowMs)
  deltas.receive({ type: 'turnStarted', turnId: 'turn-1' })
  let cumulativeInput = 0
  let cumulativeOutput = 0
  for (const [index, completion] of COMPLETIONS.entries()) {
    nowMs = completion.at
    cumulativeInput += completion.input
    cumulativeOutput += completion.output
    const frame = tokenUsageFrame(sessionId, completion, cumulativeInput, cumulativeOutput)
    deltas.receive(tokenUsageEvent(sessionId, frame))
    // T1: the CLI can deliver the same completion-bearing frame twice.
    if (!shouldRepeatFirst || index !== 0) continue
    deltas.receive(tokenUsageEvent(sessionId, frame))
  }
  deltas.receive({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
  recording.limit({
    backend: 'museCode',
    provider: 'museCode',
    source: 'museCode',
    observedAt: nowMs,
    windows: [{ id: 'window', usedPercent: 12, resetsAt: nowMs + 3_600_000, windowMins: 300 }],
    plan: PLAN_NAME,
  })
  await recording.flush()
  expect(warnings).toEqual([])
  const journal = await store.read()
  return { records: journal.records, limits: journal.limits }
}

function serviceFor(records: readonly UsageRecord[], limits: readonly UsageLimitSnapshot[]) {
  return createUsageService({
    now: () => COMPLETIONS[2].at,
    host: 'linuxlt',
    table: { locale: 'en', table: USAGE_EN },
    journal: {
      read: () =>
        Promise.resolve({
          records,
          rollups: [],
          limits,
          recordCount: records.length + limits.length,
          newerVersionRecords: 0,
          tornLines: 0,
        }),
      deleteHistory: () => Promise.resolve(),
    },
    history: () => ({ enabled: true }),
    setHistory: () => Promise.resolve(),
    readBudgets: () => Promise.resolve([]),
    readLiveLimits: () => Promise.resolve([]),
    readAttempts: () => Promise.resolve([]),
    providerConsoles: () => [],
    exportFile: () => Promise.reject(new Error('unused')),
    saveFile: () => Promise.resolve(true),
    confirmDelete: () => Promise.resolve(false),
  })
}

describe('usage says what really happened (F20-F24)', () => {
  it('records every per-completion counter the CLI reports (F20)', async () => {
    const { records, limits } = await recordedThroughRealJournal()
    expect(records).toHaveLength(COMPLETIONS.length)
    expect(records.map((record) => record.tokens.input)).toEqual(
      COMPLETIONS.map((completion) => completion.input),
    )
    expect(records.map((record) => record.tokens.cached)).toEqual(
      COMPLETIONS.map((completion) => completion.cached),
    )
    expect(records.map((record) => record.tokens.reasoning)).toEqual(
      COMPLETIONS.map((completion) => completion.reasoning),
    )
    const state = await serviceFor(records, limits).snapshot({
      range: 'today',
      groupBy: 'model',
      metric: 'cost',
    })
    const text = usageText(state, 'plain', 'summary')
    expect(text).toContain(`Cached Input: ${TOTAL_CACHED.toLocaleString('en-US')}`)
    expect(text).toContain(`Reasoning Tokens: ${String(TOTAL_REASONING)}`)
    expect(text).not.toContain('Cached Input: Unknown')
    expect(text).not.toContain('Reasoning Tokens: Unknown')
    expect(text).not.toContain('Cache Hit Rate: Unknown')
    expect(text).toContain('Cache Hit Rate: 95%')
  })

  it('records a twice-delivered completion once (T1)', async () => {
    const { records } = await recordedThroughRealJournal(true)
    expect(records).toHaveLength(COMPLETIONS.length)
    expect(records.map((record) => record.tokens.input)).toEqual(
      COMPLETIONS.map((completion) => completion.input),
    )
  })

  it('names the meter tier as the limit plan, absent only for an empty tier (T2)', () => {
    const reading = {
      observedAtMs: 100,
      tier: 'opaque',
      window: { usedPercent: 110, resetsAtMs: 200, windowDurationMins: 300 },
      weekly: { usedPercent: 20, resetsAtMs: 500 },
    }
    // A nonempty tier names the plan, even an opaque one: the label reader,
    // not the journal, falls back to the generic subscription name then.
    expect(museCodeLimitInput(reading)).toEqual({
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: 100,
      plan: 'opaque',
      windows: [
        { id: 'window', usedPercent: 110, resetsAt: 200, windowMins: 300 },
        { id: 'weekly', usedPercent: 20, resetsAt: 500 },
      ],
    })
    const unnamed = museCodeLimitInput({ ...reading, tier: '' })
    expect('plan' in unnamed).toBe(false)
    expect(unnamed).toEqual({
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: 100,
      windows: [
        { id: 'window', usedPercent: 110, resetsAt: 200, windowMins: 300 },
        { id: 'weekly', usedPercent: 20, resetsAt: 500 },
      ],
    })
  })

  it('starts each completion at its own start, not the turn start (T3)', async () => {
    const { records } = await recordedThroughRealJournal()
    expect(records.map((record) => record.startedAt)).toEqual(
      COMPLETIONS.map((completion) => completion.at - completion.durationMs),
    )
  })

  it('times each request by its own duration (F21)', async () => {
    const { records, limits } = await recordedThroughRealJournal()
    expect(records.map((record) => record.durationMs)).toEqual(
      COMPLETIONS.map((completion) => completion.durationMs),
    )
    const state = await serviceFor(records, limits).snapshot({
      range: 'today',
      groupBy: 'model',
      metric: 'cost',
    })
    const text = usageText(state, 'plain', 'summary')
    expect(text).toContain('Total Request Time: 120s')
    expect(text).not.toContain('Median Latency (p50): 128s')
  })

  it('prices the plan at the used tier and names it from the meter (F22)', async () => {
    const { records, limits } = await recordedThroughRealJournal()
    for (const record of records) {
      expect(record.cost.certainty).toBe('plan')
      expect(record.cost.apiEquivalentUsd).toBeDefined()
    }
    const state = await serviceFor(records, limits).snapshot({
      range: 'today',
      groupBy: 'model',
      metric: 'cost',
    })
    const text = usageText(state, 'plain', 'summary')
    expect(text).not.toContain('Plan: Unknown')
    expect(text).toContain(PLAN_NAME)
  })

  it('breaks down by the model and tier each request was sent as (F23)', async () => {
    const { records, limits } = await recordedThroughRealJournal()
    expect(records.map((record) => record.model)).toEqual(COMPLETIONS.map(() => MODEL))
    const state = await serviceFor(records, limits).snapshot({
      range: 'today',
      groupBy: 'model',
      metric: 'cost',
    })
    const text = usageText(state, 'plain', 'models')
    expect(text).toContain(`museCode / ${MODEL}`)
    // The standing model without its tier must not appear as a whole label.
    expect(text).not.toContain(`museCode / ${STANDING_MODEL}:`)
  })

  it('reads version 2 limit snapshots with and without plan as current (T7)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'usagetrue-v2-'))
    roots.push(root)
    const day = '2026-10-14'
    const at = new Date(2026, 9, 14, 9, 10).getTime()
    const limit = {
      type: 'limit',
      id: 'limit-1',
      at,
      day,
      timezoneOffsetMins: -120,
      client: 'test',
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: at,
      windows: [{ id: 'window', usedPercent: 12, resetsAt: at + 3_600_000, windowMins: 300 }],
    }
    const lines = [
      // What this release wrote before the version 3 bump, and what the
      // previous release wrote: both must read, never drop as invalid.
      { ...limit, v: 2, plan: PLAN_NAME },
      { ...limit, v: 2, id: 'limit-2' },
      // The version 1 shape still migrates after the union reorder.
      { ...limit, v: 1, id: 'limit-0' },
      { ...limit, v: 3, id: 'limit-3', plan: PLAN_NAME },
      // A genuinely newer line stays a newer-version line, not an invalid one.
      { ...limit, v: 4, id: 'limit-4', plan: PLAN_NAME },
    ]
    const folder = path.join(root, USAGE_FOLDER, USAGE_VERSION_FOLDER, USAGE_DAYS_FOLDER, day)
    await mkdir(folder, { recursive: true })
    await writeFile(
      path.join(folder, 't7.jsonl'),
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    )
    const warnings: string[] = []
    const store = new UsageJournalStore(new NodeUsageFs(root), {
      writerId: 'usage-truth-t7',
      now: () => at,
      isEnabled: () => true,
      onWriteError: () => {
        warnings.push('usageWriteFailed')
      },
    })
    const journal = await store.read()
    expect(warnings).toEqual([])
    expect(journal.invalidLines).toBe(0)
    expect(journal.newerVersionRecords).toBe(1)
    expect(journal.limits).toHaveLength(4)
    for (const snapshot of journal.limits) expect(snapshot.v).toBe(3)
    expect(journal.limits.map((snapshot) => snapshot.plan)).toEqual([
      PLAN_NAME,
      undefined,
      undefined,
      PLAN_NAME,
    ])
  })

  it('never prints today twice without saying what separates the rows (F24)', async () => {
    const { records, limits } = await recordedThroughRealJournal()
    const state = await serviceFor(records, limits).snapshot({
      range: 'today',
      groupBy: 'provider',
      metric: 'cost',
    })
    const daily = usageText(state, 'plain', 'daily')
    const dayRows = daily.split('\n').filter((line) => line.includes('request'))
    expect(dayRows.length).toBeGreaterThan(0)
    // Today is one day: either a single row, or hour rows that name the hour.
    const bareDayRows = dayRows.filter((line) => !/\d{1,2}:\d{2}/.test(line))
    expect(bareDayRows.length).toBeLessThanOrEqual(1)
  })
})
