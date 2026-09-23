// What is driving the account's usage (PLAN.md D17), read from the Muse
// Code CLI's own trace logs on this machine, the way Claude Code's Account &
// Usage dialog reads its local sessions. One `cli-<uuid>.log` is one `muse
// serve` process; each model attempt is one `model.attempt.lifecycle …
// phase="admission"` line carrying the run it belongs to. A turn's own run
// is the one `runtime.run.lifecycle run_kind="turn"` names; every other run
// in the file is a child the CLI started for that turn: a bundled reminder
// agent (goal, skill, verify: it registers one tool, its decision) or a
// native subagent (it registers the full toolset). Measured 2026-09-22: a
// reply-only turn was 1 attempt of its own and 30 from reminder agents.
// Pure: the host reads the files, this module reads the lines. Also the
// Model API cost estimate from Meta's published per-token prices.

import {
  LONG_SESSION_MS,
  MODEL_API_PRICES_PER_MILLION,
  CONTRIBUTOR_MODEL_SUFFIX,
  REMINDER_RUN_TOOL_COUNT_MAX,
  TOKENS_PER_MILLION,
} from '../../shared/constants'
import type { UsageInsights } from '../../shared/usage'

export interface TraceAttempt {
  readonly atMs: number
  readonly runId: string
}

export interface TraceRun {
  readonly runId: string
  /** The turn's own run (`runtime.run.lifecycle run_kind="turn"`). */
  readonly isTurn: boolean
  /** A native subagent's run (`native_subagent.child … child_run_id=`), M18: its own turn in a child session. */
  readonly isChild: boolean
  /** From `tool.surface.registered`; undefined when the run registered none. */
  readonly registeredTools: number | undefined
}

/** One trace log, one CLI process: its attempts and the runs they belong to. */
export interface TraceLogFacts {
  readonly firstMs: number | undefined
  readonly lastMs: number | undefined
  readonly attempts: readonly TraceAttempt[]
  readonly runs: ReadonlyMap<string, TraceRun>
}

export type AttemptClass = 'turn' | 'reminder' | 'subagent'

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/
const TURN_RUN = /event="runtime\.run\.lifecycle" run_kind="turn" .*?run_id=([\w-]+)/
const SURFACE = /event="tool\.surface\.registered" run_id=([\w-]+) .*?registered_tool_count=(\d+)/
const ADMISSION = /event="model\.attempt\.lifecycle" run_id="([^"]+)".*phase="admission"/
/** A subagent's child run, seen live 2026-09-23: its run id is the child session's turn. */
const CHILD_RUN = /event="native_subagent\.child" .*?child_run_id=([\w-]+)/
const LINE_BREAK = /\r?\n/

function withRun(
  runs: Map<string, TraceRun>,
  runId: string,
  change: Partial<Omit<TraceRun, 'runId'>>,
): void {
  const current = runs.get(runId) ?? {
    runId,
    isTurn: false,
    isChild: false,
    registeredTools: undefined,
  }
  runs.set(runId, { ...current, ...change })
}

export function parseTraceLog(text: string): TraceLogFacts {
  const runs = new Map<string, TraceRun>()
  const attempts: TraceAttempt[] = []
  let firstMs: number | undefined
  let lastMs: number | undefined
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
      withRun(runs, child[1], { isChild: true })
      continue
    }
    const turn = TURN_RUN.exec(line)
    if (turn?.[1] !== undefined) {
      withRun(runs, turn[1], { isTurn: true })
      continue
    }
    const surface = SURFACE.exec(line)
    if (surface?.[1] !== undefined && surface[2] !== undefined) {
      withRun(runs, surface[1], { registeredTools: Number(surface[2]) })
      continue
    }
    const admission = ADMISSION.exec(line)
    if (admission?.[1] !== undefined) {
      attempts.push({ atMs, runId: admission[1] })
    }
  }
  return { firstMs, lastMs, attempts, runs }
}

/**
 * A subagent's child run is named by the CLI (its own `run_kind="turn"` in
 * the child session, so the turn flag alone cannot tell); a run with no
 * surface line is the turn's own; a one-tool child is a reminder.
 */
export function classifyRun(run: TraceRun | undefined): AttemptClass {
  if (run === undefined) {
    return 'turn'
  }
  if (run.isChild) {
    return 'subagent'
  }
  if (run.isTurn || run.registeredTools === undefined) {
    return 'turn'
  }
  return run.registeredTools <= REMINDER_RUN_TOOL_COUNT_MAX ? 'reminder' : 'subagent'
}

const EMPTY_INSIGHTS: UsageInsights = {
  attempts: 0,
  sessions: 0,
  reminderAttempts: 0,
  subagentAttempts: 0,
  longSessionAttempts: 0,
}

/** The attempts admitted in the last `windowMs`, by what asked for them. */
export function summarizeInsights(
  logs: readonly TraceLogFacts[],
  nowMs: number,
  windowMs: number,
): UsageInsights {
  const since = nowMs - windowMs
  let totals = EMPTY_INSIGHTS
  for (const log of logs) {
    const inWindow = log.attempts.filter(
      (attempt) => attempt.atMs >= since && attempt.atMs <= nowMs,
    )
    if (inWindow.length === 0) {
      continue
    }
    const isLong =
      log.firstMs !== undefined &&
      log.lastMs !== undefined &&
      log.lastMs - log.firstMs >= LONG_SESSION_MS
    let reminder = 0
    let subagent = 0
    for (const attempt of inWindow) {
      const kind = classifyRun(log.runs.get(attempt.runId))
      if (kind === 'reminder') {
        reminder += 1
      } else if (kind === 'subagent') {
        subagent += 1
      }
    }
    totals = {
      attempts: totals.attempts + inWindow.length,
      sessions: totals.sessions + 1,
      reminderAttempts: totals.reminderAttempts + reminder,
      subagentAttempts: totals.subagentAttempts + subagent,
      longSessionAttempts: totals.longSessionAttempts + (isLong ? inWindow.length : 0),
    }
  }
  return totals
}

const PERCENT = 100

/** A whole percentage; 0 of nothing is 0. */
export function percentOf(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * PERCENT)
}

export interface BillableUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /** Cached input tokens, counted inside `inputTokens` (the Responses API convention). */
  readonly cachedTokens: number
}

/**
 * Dollars for one conversation's tokens at Meta's published per-token
 * prices (the tier is the model's: contributor models carry the suffix).
 */
export function estimateCostUsd(usage: BillableUsage, modelId: string): number {
  const prices = modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX)
    ? MODEL_API_PRICES_PER_MILLION.contributor
    : MODEL_API_PRICES_PER_MILLION.standard
  const cached = Math.min(usage.cachedTokens, usage.inputTokens)
  const fresh = usage.inputTokens - cached
  return (
    (fresh * prices.input + cached * prices.cachedInput + usage.outputTokens * prices.output) /
    TOKENS_PER_MILLION
  )
}

const CENTS_DECIMALS = 2
const SMALL_DECIMALS = 4

/** "$0.0123" under a dollar, "$1.23" from there. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? SMALL_DECIMALS : CENTS_DECIMALS)}`
}
