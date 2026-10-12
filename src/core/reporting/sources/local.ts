import type { UiText } from '../../../shared/l10n/en'
import { createHash } from 'node:crypto'
import { ACP_WORKSPACE_HASH_CHARS, REPORT_SOURCE_TIMEOUT_MS } from '../../../shared/constants'
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
   * Minification-safe brand: lazy bundles (report inputs, network) carry
   * their own copy of this class, so `instanceof` alone cannot recognize a
   * failure thrown across the bundle boundary (C-M113-2).
   */
  readonly isLocalSourceError = true
  constructor(readonly code: LocalFailure) {
    super(code)
  }
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

/**
 * Partial reasons are a set of sentences: a reason already present is never
 * appended again (RVCM1132C finding 5). Entries may themselves be joined
 * sentences (a damaged journal plus a thrown budget read arrives as one
 * string), so the check is per sentence, not per element: an existing entry
 * containing the sentence skips it, and entries contained in the new reason
 * fold into it (RVCM1132D finding 2).
 */
export function pushPartialReason(partials: string[], reason: string): void {
  if (partials.some((existing) => existing.includes(reason))) return
  for (let index = partials.length - 1; index >= 0; index -= 1) {
    if (reason.includes(partials[index] ?? '')) partials.splice(index, 1)
  }
  partials.push(reason)
}
export function codeUnitCompare(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
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
  return { state: ageMs <= REPORT_SOURCE_TIMEOUT_MS ? 'fresh' : 'stale', ageMs }
}
export interface LocalObservation<T> {
  readonly data: T
  readonly observedAt?: string
  readonly partial?: string
}
export function localSource<K extends ReportSourceKind>(
  kind: K,
  read: (context: SourceReadContext) => Promise<LocalObservation<ReportSourcePayloads[K]>>,
): ReportSourcePort<K> {
  return {
    kind,
    id: kind,
    async read(context): Promise<SourceResult<ReportSourcePayloads[K]>> {
      // The engine hands every source its abort signal and its deadline; the
      // timeout enforces the handed deadline, defaulting to the source
      // timeout for older callers. The read's own settlement is awaited, so
      // an abort settles the read instead of abandoning it mid-flight: after
      // an abort the signal stays aborted and no further read, write or
      // publish the source starts can succeed.
      const budget = Math.max(
        0,
        (context.deadline ?? Date.now() + REPORT_SOURCE_TIMEOUT_MS) - Date.now(),
      )
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(budget)])
      try {
        signal.throwIfAborted()
        const result = await read({ ...context, signal })
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
        if (signal.aborted) code = 'cancelled'
        else {
          const failure = localFailureOf(error)
          if (failure !== undefined) code = failure
        }
        return {
          record: {
            id: kind,
            status: code === 'disabled' ? 'notApplicable' : 'unavailable',
            reason: sourceReason(code, context.reportText),
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
