import type { UiText } from '../../../shared/l10n/en'
import { createHash } from 'node:crypto'
import {
  ACP_WORKSPACE_HASH_CHARS,
  REPORT_SOURCE_SETTLE_MS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_SOURCE_FRESH_MS,
} from '../../../shared/constants'
import { pathModule } from '../../workspaceRoot'
import { reportSourceSchema } from '../../../shared/reportSchema'
import type { ReportSourceRecord } from '../../../shared/reportSchema'
import type {
  ReportSourceKind,
  ReportSourcePayloads,
  ReportSourcePort,
  SourceReadContext,
  SourceResult,
} from './types'

export type SourceScrub = (text: string) => string
export type LocalFailure =
  | 'missing'
  | 'invalid'
  | 'limit'
  | 'cancelled'
  | 'failed'
  | 'refused'
  | 'disabled'
  | 'unbound'
  | 'history'
  | 'busy'
const LOCAL_FAILURES: Record<string, LocalFailure | undefined> = {
  missing: 'missing',
  invalid: 'invalid',
  limit: 'limit',
  cancelled: 'cancelled',
  failed: 'failed',
  refused: 'refused',
  disabled: 'disabled',
  unbound: 'unbound',
  history: 'history',
  busy: 'busy',
}
export class LocalSourceError extends Error {
  /**
  Minification-safe brand: lazy bundles (report inputs, network) carry
  their own copy of this class, so `instanceof` alone cannot recognize a
  failure thrown across the bundle boundary (C-M113-2).
  */
  readonly isLocalSourceError = true
  constructor(
    readonly code: LocalFailure,
    /**
    A pre-scrubbed free-text reason for the record. The source that
    throws it owns the wording (and its scrubbing), so the record can
    name the failure instead of repeating the fixed table sentence.
    Absent or unusable detail falls back to the table sentence.
    */
    readonly detail?: string,
  ) {
    super(detail ?? code)
  }
}
/** A branded free-text reason from any bundle copy, or undefined when the
failure carries none. Length-checked so the record stays schema-valid. */
export function localDetailOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const branded = error as { isLocalSourceError?: unknown; code?: unknown; detail?: unknown }
  return branded.isLocalSourceError !== true ||
    typeof branded.code !== 'string' ||
    !Object.hasOwn(LOCAL_FAILURES, branded.code) ||
    typeof branded.detail !== 'string' ||
    branded.detail.length === 0 ||
    branded.detail.length > REPORT_MAX_TEXT_CHARS
    ? undefined
    : branded.detail
}

/** A failure code from any bundle copy, or undefined when it is not one. */
export function localFailureOf(error: unknown): LocalFailure | undefined {
  try {
    if (error instanceof LocalSourceError && Object.hasOwn(LOCAL_FAILURES, error.code))
      return LOCAL_FAILURES[error.code]
    if (
      typeof error === 'object' &&
      error !== null &&
      'isLocalSourceError' in error &&
      error.isLocalSourceError === true &&
      'code' in error &&
      typeof error.code === 'string' &&
      Object.hasOwn(LOCAL_FAILURES, error.code)
    )
      return LOCAL_FAILURES[error.code]
  } catch {
    // A caught value is untrusted too: prototype/brand/code getters may throw.
    return undefined
  }
  return undefined
}
export interface LocalFileIo {
  read(file: string, signal: AbortSignal): Promise<string>
  list(
    directory: string,
    signal: AbortSignal,
  ): Promise<readonly { name: string; directory: boolean }[]>
}
export function sourceReason(code: LocalFailure, reportText: UiText): string {
  // A held resource names its holder state, never a generic read failure.
  return code === 'busy' ? reportText.teamHostBusy : reportText.reportSourceReasons[code]
}

/** A late settlement the bounded wait has moved past stays silent. */
function ignoreSettlement(): void {
  // The outcome below is owned by the bounded settle wait; a rejection that
  // lands after it moved on must never surface as unhandled.
}

/**
Partial reasons are a set of sentences: a reason already present is never
appended again (RVCM1132C finding 5). Entries may themselves be joined
sentences (a damaged journal plus a thrown budget read arrives as one
string), so the check is per sentence, not per element: an existing entry
containing the sentence skips it, and entries contained in the new reason
fold into it (RVCM1132D finding 2).
*/
export function pushPartialReason(partials: string[], reason: string): void {
  if (partials.some((existing) => existing.includes(reason))) return
  for (let index = partials.length - 1; index >= 0; index -= 1) {
    if (reason.includes(partials[index] ?? '')) partials.splice(index, 1)
  }
  partials.push(reason)
}
/**
Whether a throw is the content failing to parse: malformed JSON or a schema
mismatch. Sources map both to their invalid-data outcome; anything else is
not a content failure.

Read by shape, never by `instanceof` on zod's error class: `zod/mini`
exports no error class, so `z.core.$ZodError` would read `core` off the
shared validation bundle, which does not export it (the split gate fails,
and the packed bundle throws `TypeError` where the source maps a code).
The pinned zod names every schema failure `$ZodError` explicitly
(`inst.name = "$ZodError"` in its core), so the name survives minification;
the `issues` array keeps a same-named foreign error out.
*/
export function isParseFailure(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      error.name === '$ZodError' &&
      'issues' in error &&
      Array.isArray(error.issues))
  )
}

export function codeUnitCompare(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
Millisecond stamps render as ISO dates. A schema-valid stamp outside the
Date range stays a number at the call site, never a guessed date.
*/
export function isoDateMs(value: number): string | undefined {
  if (!Number.isSafeInteger(value)) return undefined
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** A stable storage key; the path itself never enters a report or a filename. */
export function reportWorkspaceKey(root: string, platform: NodeJS.Platform): string {
  const p = pathModule(platform)
  if (!p.isAbsolute(root)) throw new LocalSourceError('refused')
  const normalized = p.resolve(root).replaceAll('\\', '/')
  return createHash('sha256')
    .update(platform === 'win32' ? normalized.toLowerCase() : normalized)
    .digest('hex')
    .slice(0, ACP_WORKSPACE_HASH_CHARS)
}
export function sourceFreshness(
  asOf: string,
  observedAt: string | null,
): ReportSourceRecord['freshness'] {
  if (observedAt === null) return { state: 'unknown', ageMs: null }
  const ageMs = Date.parse(asOf) - Date.parse(observedAt)
  if (!Number.isFinite(ageMs) || ageMs < 0) return { state: 'unknown', ageMs: null }
  return { state: ageMs <= REPORT_SOURCE_FRESH_MS ? 'fresh' : 'stale', ageMs }
}
export interface LocalObservation<T> {
  readonly data: T
  readonly observedAt?: string
  readonly partial?: string
}

/**
A read raced against the deadline its caller handed in. The race is against
that deadline only, never the abort: a cancelled cooperative read still
settles through its own shutdown instead of being abandoned mid-flight.
When the deadline fires the abort is already on the read's signal, so its
settlement is awaited, bounded by the settle grace, before the cancellation
returns (RVREPORTJOIN P2-3).
*/
async function readBeforeDeadline<T>(pending: Promise<T>, timeout: AbortSignal): Promise<T> {
  // A settlement that lands after the bounded wait below has moved on
  // must never surface as an unhandled rejection.
  void pending.then(ignoreSettlement).catch(ignoreSettlement)
  let stopTimeout: (() => void) | undefined
  let stopGrace: (() => void) | undefined
  try {
    const expired = new Promise<never>((_resolve, reject) => {
      const fire = () => {
        reject(new LocalSourceError('cancelled'))
      }
      if (timeout.aborted) fire()
      else {
        timeout.addEventListener('abort', fire, { once: true })
        stopTimeout = () => {
          timeout.removeEventListener('abort', fire)
        }
      }
    })
    try {
      return await Promise.race([pending, expired])
    } catch (error) {
      if (!timeout.aborted) throw error
      // The handed deadline fired while the read was in flight: the
      // abort is already on the read's signal, so a cooperative reader
      // settles promptly. Wait for that settlement, bounded by the
      // settle grace, instead of returning while it still runs.
      const grace = AbortSignal.timeout(REPORT_SOURCE_SETTLE_MS)
      const settled = new Promise<void>((resolve, reject) => {
        const fire = (): void => {
          reject(new LocalSourceError('cancelled'))
        }
        if (grace.aborted) fire()
        else {
          grace.addEventListener('abort', fire, { once: true })
          stopGrace = () => {
            grace.removeEventListener('abort', fire)
          }
        }
        void pending
          .then(function readSettled(): void {
            resolve()
          })
          .catch(function readFailed(): void {
            resolve()
          })
      })
      try {
        await settled
      } catch {
        // The grace expired while a wedged reader still runs: the outcome
        // stays cancellation, and the late settlement stays silent above.
      }
      throw error
    }
  } finally {
    stopTimeout?.()
    stopGrace?.()
  }
}

export function localSource<K extends ReportSourceKind>(
  kind: K,
  read: (context: SourceReadContext) => Promise<LocalObservation<ReportSourcePayloads[K]>>,
): ReportSourcePort<K> {
  return {
    kind,
    id: kind,
    async read(context): Promise<SourceResult<ReportSourcePayloads[K]>> {
      // The engine hands every source the caller's abort signal (the
      // person's cancel). No deadline of ours ends a read (D121/D208): it
      // runs until it settles or that signal aborts, and a deadline binds
      // only when the caller hands one in. The read's own settlement is
      // awaited, so an abort settles the read instead of abandoning it
      // mid-flight: after an abort the signal stays aborted and no further
      // read, write or publish the source starts can succeed.
      const startedAt = Date.now()
      const deadlineMs =
        context.deadline !== undefined && Number.isFinite(context.deadline)
          ? context.deadline
          : undefined
      let signal: AbortSignal = context.signal
      try {
        // An already-expired deadline starts nothing: this check is
        // synchronous, never reliant on a zero-millisecond timeout aborting
        // in time (RVREPORTJOIN P2-3).
        context.signal.throwIfAborted()
        if (deadlineMs !== undefined && deadlineMs <= startedAt)
          throw new LocalSourceError('cancelled')
        const timeout =
          deadlineMs === undefined
            ? undefined
            : AbortSignal.timeout(Math.max(0, deadlineMs - Date.now()))
        if (timeout !== undefined) signal = AbortSignal.any([context.signal, timeout])
        signal.throwIfAborted()
        const pending = read({ ...context, signal })
        const result =
          timeout === undefined ? await pending : await readBeforeDeadline(pending, timeout)
        signal.throwIfAborted()
        const observedAt = result.observedAt ?? context.asOf
        const freshness = sourceFreshness(context.asOf, observedAt)
        reportSourceSchema.parse({ id: kind, status: 'ok', reason: null, observedAt, freshness })
        return {
          record:
            result.partial === undefined
              ? { id: kind, status: 'ok', reason: null, observedAt, freshness }
              : {
                  id: kind,
                  status: 'partial',
                  reason: result.partial,
                  observedAt,
                  freshness,
                },
          data: result.data,
        }
      } catch (error) {
        let code: LocalFailure = 'failed'
        let detail: string | undefined
        if (signal.aborted) code = 'cancelled'
        else {
          const failure = localFailureOf(error)
          if (failure !== undefined) {
            code = failure
            detail = localDetailOf(error)
          }
        }
        return {
          record: {
            id: kind,
            status: code === 'disabled' ? 'notApplicable' : 'unavailable',
            reason: detail ?? sourceReason(code, context.reportText),
            observedAt: null,
            freshness: { state: 'unknown', ageMs: null },
          },
          data: null,
        }
      }
    },
  }
}
export function scrubSourceValue(value: unknown, scrub: SourceScrub): unknown {
  if (typeof value === 'string') return scrub(value)
  if (Array.isArray(value)) return value.map((entry: unknown) => scrubSourceValue(entry, scrub))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]: [string, unknown]) => [
      scrub(key),
      scrubSourceValue(entry, scrub),
    ]),
  )
}
