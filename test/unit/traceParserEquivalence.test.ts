import { describe, expect, it } from 'vitest'
import {
  createTraceLogBuilder,
  parseTraceLine,
  parseTraceLog,
  type TraceAttempt,
  type TraceLogFacts,
  type TraceRun,
} from '../../src/core/usage/insights'

/**
 * The pre-optimization whole-text parser, copied verbatim as the reference:
 * the new line-at-a-time parser must agree with it on every generated log.
 */
function referenceParseTraceLog(text: string): TraceLogFacts {
  const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/
  const TURN_RUN = /event="runtime\.run\.lifecycle" run_kind="turn" .*?run_id=([\w-]+)/
  const SURFACE = /event="tool\.surface\.registered" run_id=([\w-]+) .*?registered_tool_count=(\d+)/
  const ADMISSION = /event="model\.attempt\.lifecycle" run_id="([^"]+)".*phase="admission"/
  const CHILD_RUN = /event="native_subagent\.child" .*?child_run_id=([\w-]+)/
  const LINE_BREAK = /\r?\n/
  const runs = new Map<string, TraceRun>()
  const attempts: TraceAttempt[] = []
  let firstMs: number | undefined
  let lastMs: number | undefined
  const withRun = (runId: string, change: Partial<Omit<TraceRun, 'runId'>>): void => {
    const current = runs.get(runId) ?? {
      runId,
      isTurn: false,
      isChild: false,
      registeredTools: undefined,
    }
    runs.set(runId, { ...current, ...change })
  }
  for (const line of text.split(LINE_BREAK)) {
    const stamp = TIMESTAMP.exec(line)?.[1]
    if (stamp === undefined) {
      continue
    }
    const atMs = Date.parse(stamp)
    firstMs ??= atMs
    lastMs = atMs
    const child = CHILD_RUN.exec(line)
    if (child?.[1] !== undefined) {
      withRun(child[1], { isChild: true })
      continue
    }
    const turn = TURN_RUN.exec(line)
    if (turn?.[1] !== undefined) {
      withRun(turn[1], { isTurn: true })
      continue
    }
    const surface = SURFACE.exec(line)
    if (surface?.[1] !== undefined && surface[2] !== undefined) {
      withRun(surface[1], { registeredTools: Number(surface[2]) })
      continue
    }
    const admission = ADMISSION.exec(line)
    if (admission?.[1] !== undefined) {
      attempts.push({ atMs, runId: admission[1] })
    }
  }
  return { firstMs, lastMs, attempts, runs }
}

// Deterministic generator: every event kind, both line endings, garbage.
function stamp(i: number): string {
  return i % 3 === 0
    ? '2026-09-23T03:49:59Z'
    : `2026-09-23T03:50:${String(i % 60).padStart(2, '0')}.${String(i % 1000).padStart(3, '0')}Z`
}

function lineEnding(i: number): string {
  return i % 2 === 0 ? '\n' : '\r\n'
}

function generateLog(seed: number, lines: number): string {
  let state = seed
  const next = (mod: number): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state % mod
  }
  const kinds: ((i: number) => string)[] = [
    (i) =>
      `${stamp(i)} INFO tbh.local.runtime x event="runtime.run.lifecycle" run_kind="turn" phase="started" command_id=r${String(i)} run_id=r${String(i)} outcome="running"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.tool x event="tool.surface.registered" run_id=r${String(i)} epoch_ordinal=0 registered_tool_count=${String(i % 31)} active_tool_count=1 outcome="registered"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="r${String(i)}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="r${String(i)}" phase="terminal" outcome="completed"`,
    (i) =>
      `${stamp(i)} INFO tbh.local.task x event="native_subagent.child" child_run_id=c${String(i)} state="started"`,
    (i) => `${stamp(i)} INFO heartbeat without any event marker`,
    (i) =>
      `garbage line ${String(i)} without a timestamp but with event="model.attempt.lifecycle" run_id="x" phase="admission"`,
    (i) => `${stamp(i)} INFO event="model.attempt.lifecycle" run_id="unclosed phase="admission"`,
    (i) =>
      `${stamp(i)} INFO event="other.thing" run_kind="turn" child_run_id=z${String(i)} phase="admission" registered_tool_count=3`,
    () =>
      `2026-13-45T99:99:99Z INFO event="model.attempt.lifecycle" run_id="bad" phase="admission"`,
    (i) =>
      `${'x'.repeat(5000)} ${stamp(i)} event="model.attempt.lifecycle" run_id="late" phase="admission"`,
    (i) =>
      `${stamp(i)} ${'y'.repeat(5000)} event="tool.surface.registered" run_id=big registered_tool_count=7`,
  ]
  let text = ''
  for (let i = 0; i < lines; i++) text += `${kinds[next(kinds.length)]?.(i) ?? ''}${lineEnding(i)}`
  return text
}

function streamParse(text: string): TraceLogFacts {
  const builder = createTraceLogBuilder()
  for (const line of text.split(/\r?\n/)) parseTraceLine(builder, line)
  return {
    firstMs: builder.firstMs,
    lastMs: builder.lastMs,
    attempts: builder.attempts,
    runs: builder.runs,
  }
}

describe('trace parser equivalence', () => {
  it.each([1, 7, 42, 999])(
    'the optimized parser equals the old whole-text parser (seed %s)',
    (seed) => {
      const text = generateLog(seed, 400)
      expect(parseTraceLog(text)).toEqual(referenceParseTraceLog(text))
    },
  )

  it('agrees on a partial last line without a terminator', () => {
    const full = generateLog(5, 100)
    // The final line arrives without its terminator (a torn write).
    const partial = full.slice(0, full.lastIndexOf('\n'))
    expect(partial.endsWith('\n')).toBe(false)
    expect(parseTraceLog(partial)).toEqual(referenceParseTraceLog(partial))
    const truncated = full.slice(0, 271)
    expect(parseTraceLog(truncated)).toEqual(referenceParseTraceLog(truncated))
  })

  it('the streaming line reader equals the whole-text parse', () => {
    const text = generateLog(11, 400)
    expect(streamParse(text)).toEqual(parseTraceLog(text))
  })

  it('an empty log parses to nothing on every path', () => {
    const expected = { firstMs: undefined, lastMs: undefined, attempts: [], runs: new Map() }
    expect(parseTraceLog('')).toEqual(expected)
    expect(referenceParseTraceLog('')).toEqual(expected)
    expect(streamParse('')).toEqual(expected)
  })
})
