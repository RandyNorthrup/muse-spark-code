import { describe, expect, it } from 'vitest'
import {
  classifyRun,
  estimateCostUsd,
  formatUsd,
  parseTraceLog,
  percentOf,
  summarizeInsights,
} from '../../src/core/usage/insights'

const T0 = Date.parse('2026-09-23T03:49:59.000Z')
const HOUR = 60 * 60 * 1000

/** The line shapes Muse Code 1.3.0 writes (docs/certification/m13.md). */
function traceLog(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

const turnStarted = (at: string, runId: string) =>
  `${at} INFO tbh.local.runtime x/run_lifecycle_diagnostic.rs:44 event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=${runId} run_id=${runId} outcome="running" cause="none" duration_ms=`
const surface = (at: string, runId: string, tools: number) =>
  `${at} INFO tbh.local.tool x/registration_selection_diagnostic.rs:17 event="tool.surface.registered" run_id=${runId} epoch_ordinal=0 registered_tool_count=${String(tools)} active_tool_count=${String(tools)} outcome="registered"`
const admission = (at: string, runId: string) =>
  `${at} INFO tbh.local.model x/diagnostic.rs:82 event="model.attempt.lifecycle" run_id="${runId}" attempt_id="${runId}:0:1" task_id="t" provider="meta" model="muse-spark-1.3" step=0 attempt=1 turn_retry_max_attempts=10 phase="admission" outcome="accepted"`
const terminal = (at: string, runId: string) =>
  `${at} INFO tbh.local.model x/diagnostic.rs:82 event="model.attempt.lifecycle" run_id="${runId}" attempt_id="${runId}:0:1" task_id="t" phase="terminal" outcome="completed"`

const sample = traceLog([
  turnStarted('2026-09-23T03:49:59.790Z', 'turn-1'),
  surface('2026-09-23T03:49:59.891Z', 'turn-1', 30),
  admission('2026-09-23T03:49:59.907Z', 'turn-1'),
  terminal('2026-09-23T03:50:03.000Z', 'turn-1'),
  surface('2026-09-23T03:49:59.914Z', 'reminder-1', 1),
  admission('2026-09-23T03:49:59.915Z', 'reminder-1'),
  admission('2026-09-23T03:50:10.000Z', 'reminder-1'),
  surface('2026-09-23T03:50:01.335Z', 'child-1', 28),
  admission('2026-09-23T03:50:01.400Z', 'child-1'),
  'not a trace line at all',
  `2026-09-23T03:51:17.230Z INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="terminal" command_id=turn-1 run_id=turn-1 outcome="completed"`,
])

describe('parseTraceLog', () => {
  it('reads the attempts, the turn run, and each run’s registered tool count', () => {
    const facts = parseTraceLog(sample)
    expect(facts.firstMs).toBe(Date.parse('2026-09-23T03:49:59.790Z'))
    expect(facts.lastMs).toBe(Date.parse('2026-09-23T03:51:17.230Z'))
    expect(facts.attempts.map((attempt) => attempt.runId)).toEqual([
      'turn-1',
      'reminder-1',
      'reminder-1',
      'child-1',
    ])
    expect(facts.runs.get('turn-1')).toEqual({
      runId: 'turn-1',
      isTurn: true,
      isChild: false,
      registeredTools: 30,
    })
    expect(facts.runs.get('reminder-1')).toEqual({
      runId: 'reminder-1',
      isTurn: false,
      isChild: false,
      registeredTools: 1,
    })
    expect(classifyRun(facts.runs.get('turn-1'))).toBe('turn')
    expect(classifyRun(facts.runs.get('reminder-1'))).toBe('reminder')
    expect(classifyRun(facts.runs.get('child-1'))).toBe('subagent')
    expect(classifyRun(undefined)).toBe('turn')
  })

  it('parses an empty log to nothing', () => {
    expect(parseTraceLog('')).toEqual({
      firstMs: undefined,
      lastMs: undefined,
      attempts: [],
      runs: new Map(),
    })
  })
})

describe('summarizeInsights', () => {
  it('counts attempts by origin inside the window and flags long sessions', () => {
    const recent = parseTraceLog(sample)
    const old = parseTraceLog(
      traceLog([
        turnStarted('2026-09-20T10:00:00.000Z', 'old-turn'),
        admission('2026-09-20T10:00:01.000Z', 'old-turn'),
        admission('2026-09-20T19:00:01.000Z', 'old-turn'),
      ]),
    )
    const now = T0 + HOUR
    const day = summarizeInsights([recent, old], now, 24 * HOUR)
    expect(day).toEqual({
      attempts: 4,
      sessions: 1,
      reminderAttempts: 2,
      subagentAttempts: 1,
      longSessionAttempts: 0,
    })
    const week = summarizeInsights([recent, old], now, 7 * 24 * HOUR)
    expect(week).toEqual({
      attempts: 6,
      sessions: 2,
      reminderAttempts: 2,
      subagentAttempts: 1,
      longSessionAttempts: 2,
    })
    expect(summarizeInsights([], now, HOUR)).toEqual({
      attempts: 0,
      sessions: 0,
      reminderAttempts: 0,
      subagentAttempts: 0,
      longSessionAttempts: 0,
    })
  })
})

describe('cost estimate', () => {
  it('prices fresh and cached input and output by the model’s tier', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 200_000 }
    expect(estimateCostUsd(usage, 'muse-spark-1.3')).toBeCloseTo(
      0.8 * 1.25 + 0.2 * 0.15 + 0.1 * 4.25,
    )
    expect(estimateCostUsd(usage, 'muse-spark-1.3-contributor')).toBeCloseTo(
      0.8 * 0.1 + 0.2 * 0.002 + 0.1 * 0.2,
    )
    // Cached tokens never exceed the input they sit inside.
    expect(
      estimateCostUsd({ inputTokens: 10, outputTokens: 0, cachedTokens: 50 }, 'x'),
    ).toBeCloseTo((10 * 0.15) / 1_000_000)
  })

  it('formats dollars with four decimals under a dollar, two above, and whole percents', () => {
    expect(formatUsd(0.01234)).toBe('$0.0123')
    expect(formatUsd(1.456)).toBe('$1.46')
    expect(percentOf(30, 31)).toBe(97)
    expect(percentOf(0, 0)).toBe(0)
  })
})

describe('subagent child runs (M18)', () => {
  it('classifies a run the CLI names as a native subagent child, whatever its tool count', () => {
    const at = '2026-09-23T07:14:39.806Z'
    const lines = [
      `${at} INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=parent run_id=parent outcome="running" cause="none" duration_ms=0`,
      `${at} INFO tbh.local.task x/diagnostic.rs:33 event="native_subagent.child" task_id=task-1 subagent_id="subagent-1" child_run_id=child-1 lane="native" state="started" reason="none"`,
      `${at} INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=child-1 run_id=child-1 outcome="running" cause="none" duration_ms=0`,
      `${at} INFO tbh.local.tool x event="tool.surface.registered" run_id=child-1 epoch_ordinal=0 registered_tool_count=27 active_tool_count=16 outcome="registered"`,
      `${at} INFO tbh.local.tool x event="tool.surface.registered" run_id=parent epoch_ordinal=0 registered_tool_count=30 active_tool_count=29 outcome="registered"`,
      `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="child-1" attempt_id=a1 phase="admission"`,
      `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="parent" attempt_id=a2 phase="admission"`,
    ].join('\n')
    const facts = parseTraceLog(lines)
    expect(classifyRun(facts.runs.get('child-1'))).toBe('subagent')
    expect(classifyRun(facts.runs.get('parent'))).toBe('turn')
    const summary = summarizeInsights([facts], Date.parse(at) + 1000, 60_000)
    expect(summary).toMatchObject({ attempts: 2, subagentAttempts: 1 })
  })
})
