// A worker's report: one fenced `muse-team-report` block holding JSON,
// parsed with zod as M70's `muse-review` is (M96 lane W, PLAN.md D75 and
// acceptance 18). Every boundary rule applies: a missing or invalid block
// becomes `unstructured` with the summary clipped, never an empty success,
// and `blocked` carries the questions that need the user.

import * as z from 'zod/mini'
import { parseReviewFindings, type ReviewFinding } from '../../../shared/reviewFindings'
import { WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS } from '../../../shared/constants'
import { WORKER_REPORT_FENCE, WORKER_REVIEW_FENCE } from './workerTypes'

/** The terminal states D75's report shape names. */
export const WORKER_REPORT_STATUSES = ['done', 'partial', 'blocked', 'failed', 'capped'] as const

const reportSchema = z
  .object({
    status: z.enum(WORKER_REPORT_STATUSES),
    summary: z.string().check(z.refine(hasVisibleText)),
    files: z.optional(z.array(z.string())),
    checks: z.optional(z.array(z.string())),
    sources: z.optional(z.array(z.string())),
    questions: z.optional(z.array(z.string().check(z.refine(hasVisibleText)))),
    next: z.optional(z.string()),
  })
  .check(z.refine((report) => report.status !== 'blocked' || (report.questions?.length ?? 0) > 0))

/** A parsed `muse-team-report` block, exactly D75's shape. */
export type WorkerReport = z.infer<typeof reportSchema>

/**
 * What a worker handed back: its parsed report, or `unstructured` with the
 * clipped summary when its last message holds no valid block.
 */
export type WorkerReportOutcome =
  | { readonly ok: true; readonly report: WorkerReport }
  | {
      readonly ok: false
      readonly status: 'unstructured' | 'capped' | 'refused' | 'cancelled' | 'failed'
      readonly summary: string
      /** Preserve the backend's original stop, including future values (D36). */
      readonly stopReason?: string
    }

function hasVisibleText(text: string): boolean {
  return text.replaceAll(/[\s\p{Cf}]/gu, '').length > 0
}

const STOP_OUTCOMES: ReadonlyMap<string, 'capped' | 'refused' | 'cancelled'> = new Map([
  ['max_turn_requests', 'capped'],
  ['max_tokens', 'capped'],
  ['refusal', 'refused'],
  ['cancelled', 'cancelled'],
])

/** Only a completed turn may substantiate a structured report. Unknown stops fail closed. */
export function reportForStop(text: string, stopReason: string): WorkerReportOutcome {
  if (stopReason === 'end_turn') return extractTeamReport(text)
  const status = STOP_OUTCOMES.get(stopReason) ?? 'failed'
  return { ok: false, status, stopReason, summary: clipReportSummary(text) }
}

/** The summary an `unstructured` outcome keeps. */
export function clipReportSummary(text: string): string {
  const trimmed = text.trim()
  const characters = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed),
    (entry) => entry.segment,
  )
  return characters.length > WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS
    ? `${characters.slice(0, WORKER_UNSTRUCTURED_SUMMARY_MAX_CHARS).join('')}…`
    : trimmed
}

const FENCE_OPEN = '```'

/**
 * The last fenced block with the tag, or undefined. The worker ends its last
 * message with the block, so an earlier block is a draft, not the report.
 */
export function lastFencedBlock(text: string, tag: string): string | undefined {
  const lines = text.split('\n')
  let current: string[] | undefined
  let found: string | undefined
  for (const line of lines) {
    if (current === undefined) {
      if (line.trim() === `${FENCE_OPEN}${tag}`) {
        current = []
      }
      continue
    }
    if (line.trim() === FENCE_OPEN) {
      found = current.join('\n')
      current = undefined
      continue
    }
    current.push(line)
  }
  return found
}

/** Parses report JSON (the `report` tool's argument, or a block's body). */
export function parseReportJson(json: string): WorkerReport | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // Malformed report JSON is an explicit unstructured outcome.
    return undefined
  }
  const result = reportSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/**
 * Parses the worker's last message. A block that is not JSON of the report's
 * shape is malformed, not a narrower report: the outcome is `unstructured`
 * with the message clipped.
 */
export function extractTeamReport(text: string): WorkerReportOutcome {
  const block = lastFencedBlock(text, WORKER_REPORT_FENCE)
  const report = block === undefined ? undefined : parseReportJson(block)
  return report === undefined
    ? { ok: false, status: 'unstructured', summary: clipReportSummary(text) }
    : { ok: true, report }
}

/**
 * A `code-review` task's findings in M70's `muse-review` shape (acceptance
 * 18): the last `muse-review` block's findings, or undefined when the
 * message holds no valid one.
 */
export function extractReviewFindings(text: string): readonly ReviewFinding[] | undefined {
  const block = lastFencedBlock(text, WORKER_REVIEW_FENCE)
  return block === undefined ? undefined : parseReviewFindings(block)
}
