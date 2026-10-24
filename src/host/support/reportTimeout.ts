// Bounded reads for the problem report (M93, lane REPORTFLOW R2). Every
// fact behind a report has its own bound: a source that throws or does not
// answer in time becomes the word `unknown` for that fact with a fixed
// reason code, and the report still opens. This module holds the bound and
// the reason mapping both lazy bundles (the dialog's and the fallback's)
// share; it reaches no `vscode`, reads no secret and starts nothing.

import { REPORT_ERROR_CODES, REPORT_UNKNOWN_ERROR_CODE } from '../../shared/constants'
import type { Logger } from '../logger'

/** A bounded read that did not answer in time: the fixed word is its name. */
export class ReportTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`a report source did not answer in ${String(timeoutMs)} ms`)
    this.name = 'TimeoutError'
  }
}

/**
Races one source read against its bound. A hanging source rejects with a
`TimeoutError` (a fixed word in the recorder's vocabulary); a throw passes
through unchanged. The timer is always cleared, so a settled read leaves
nothing behind.
*/
export async function withReportTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ReportTimeoutError(timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([task, bound])
  } finally {
    clearTimeout(timer)
  }
}

/**
The fixed reason code for a fact its read could not answer (lane
REPORTFLOW R2): a throw reads its class when the vocabulary names it (a
timeout reads `TimeoutError`, like every other mapped error), and anything
else reads `unknown`. Never a message, which can hold anything.
*/
export function reportReasonOf(error: unknown): string {
  const code = error instanceof Error ? error.name : typeof error
  return REPORT_ERROR_CODES.has(code) ? code : REPORT_UNKNOWN_ERROR_CODE
}

/**
Records one failed report read in the log under its fixed reason code
(never the message, which can hold a path or a name). The report's own
record of the same failure, a fact's reason or the draft's recording note,
is made by the caller.
*/
export function reportError(log: Logger, what: string, error: unknown): void {
  log.error(`problem report ${what} (${reportReasonOf(error)})`)
}

/**
Records one fact's failed read under its fixed reason code, for the draft's
`unknown` note. A best-effort read with no fact of its own (the status read,
the command list) is left out of the draft by design, like an unanswered one.
*/
export function recordError(
  reasons: Record<string, string>,
  fact: string | undefined,
  error: unknown,
): void {
  if (fact !== undefined) {
    reasons[fact] = reportReasonOf(error)
  }
}

/**
One bounded read that never fails the report (lane REPORTFLOW R2): the
read answers within its bound, or its fallback stands in and the log keeps
the fixed reason. Both lazy bundles read their snapshots through it, so the
dialog and the editor's fallback cannot drift apart.
*/
export async function readBounded<T>(
  log: Logger,
  what: string,
  read: () => Promise<T> | T,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  try {
    return await withReportTimeout((async (): Promise<T> => await read())(), timeoutMs)
  } catch (error: unknown) {
    reportError(log, `${what} unavailable`, error)
    return fallback
  }
}
