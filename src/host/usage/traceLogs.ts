// Reads the Muse Code CLI's trace logs for the usage insights (PLAN.md D17):
// `~/.local/share/muse/local-tracing/bootstrap/cli-<uuid>.log`, one per
// `muse serve` process, newest first, a bounded number of bounded files. A
// running host holds its log locked; that file is skipped, not waited for.
// The lines are read by the pure parser in src/core/usage/insights.ts.

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseTraceLog, summarizeInsights, type TraceLogFacts } from '../../core/usage/insights'
import {
  MUSE_TRACE_LOG_SEGMENTS,
  TRACE_LOG_FILE_SUFFIX,
  TRACE_LOG_MAX_BYTES,
  TRACE_LOG_MAX_FILES,
  USAGE_INSIGHTS_TTL_MS,
  USAGE_WINDOW_DAY_MS,
  USAGE_WINDOW_WEEK_MS,
} from '../../shared/constants'
import type { UsageInsightsReport } from '../conversation/conversationController'

export interface TraceLogDeps {
  readonly homeDir: string
}

export interface InsightsReaderDeps extends TraceLogDeps {
  readonly now: () => number
}

export interface InsightsReader {
  /** The day and week windows; undefined when there are no logs at all. */
  read(): Promise<UsageInsightsReport | undefined>
}

export function traceLogDirectory(deps: TraceLogDeps): string {
  return path.join(deps.homeDir, ...MUSE_TRACE_LOG_SEGMENTS)
}

async function readOne(file: string): Promise<TraceLogFacts | undefined> {
  try {
    const info = await stat(file)
    return info.size > TRACE_LOG_MAX_BYTES ? undefined : parseTraceLog(await readFile(file, 'utf8'))
  } catch {
    // Locked by a running host, or gone between the listing and the read.
    return undefined
  }
}

/**
 * Reads and summarises the logs on demand, at most once per TTL: the usage
 * modal asks on every open and on every `usage/changed`.
 */
export function createInsightsReader(deps: InsightsReaderDeps): InsightsReader {
  let cached:
    { readonly atMs: number; readonly report: UsageInsightsReport | undefined } | undefined
  return {
    async read() {
      const nowMs = deps.now()
      if (cached !== undefined && nowMs - cached.atMs < USAGE_INSIGHTS_TTL_MS) {
        return cached.report
      }
      const logs = await readTraceLogs(deps)
      const report =
        logs.length === 0
          ? undefined
          : {
              day: summarizeInsights(logs, nowMs, USAGE_WINDOW_DAY_MS),
              week: summarizeInsights(logs, nowMs, USAGE_WINDOW_WEEK_MS),
            }
      cached = { atMs: nowMs, report }
      return report
    },
  }
}

/** The readable logs, newest first, capped; an absent directory is no logs. */
export async function readTraceLogs(deps: TraceLogDeps): Promise<readonly TraceLogFacts[]> {
  const directory = traceLogDirectory(deps)
  let names: readonly string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const candidates = names.filter((name) => name.endsWith(TRACE_LOG_FILE_SUFFIX))
  const stamped = await Promise.all(
    candidates.map(async (name) => {
      const file = path.join(directory, name)
      try {
        const info = await stat(file)
        return { file, mtimeMs: info.mtimeMs }
      } catch {
        return
      }
    }),
  )
  const newestFirst = stamped
    .filter((entry) => entry !== undefined)
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, TRACE_LOG_MAX_FILES)
  const logs = await Promise.all(newestFirst.map((entry) => readOne(entry.file)))
  return logs.filter((log) => log !== undefined)
}
