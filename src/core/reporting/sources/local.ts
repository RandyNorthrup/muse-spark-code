import { createHash } from 'node:crypto'
import {
  ACP_WORKSPACE_HASH_CHARS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_SOURCE_TIMEOUT_MS,
  UI_TEXT,
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
}
export class LocalSourceError extends Error {
  /**
   * Minification-safe brand: lazy bundles (report inputs, network) carry
   * their own copy of this class, so `instanceof` alone cannot recognize a
   * failure thrown across the bundle boundary (C-M113-2).
   */
  readonly isLocalSourceError = true
  constructor(
    readonly code: LocalFailure,
    /**
     * A pre-scrubbed free-text reason for the record. The source that
     * throws it owns the wording (and its scrubbing), so the record can
     * name the failure instead of repeating the fixed table sentence.
     * Absent or unusable detail falls back to the table sentence.
     */
    readonly detail?: string,
  ) {
    super(detail ?? code)
  }
}
/** A branded free-text reason from any bundle copy, or undefined when the
 * failure carries none. Length-checked so the record stays schema-valid. */
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
  if (error instanceof LocalSourceError && Object.hasOwn(LOCAL_FAILURES, error.code))
    return LOCAL_FAILURES[error.code]
  if (typeof error === 'object' && error !== null) {
    const branded = error as { isLocalSourceError?: unknown; code?: unknown }
    if (
      branded.isLocalSourceError === true &&
      typeof branded.code === 'string' &&
      Object.hasOwn(LOCAL_FAILURES, branded.code)
    )
      return LOCAL_FAILURES[branded.code]
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
export function sourceReason(code: LocalFailure): string {
  return UI_TEXT.reportSourceReasons[code]
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
      const signal = AbortSignal.any([
        context.signal,
        AbortSignal.timeout(REPORT_SOURCE_TIMEOUT_MS),
      ])
      let detach: (() => void) | undefined
      try {
        signal.throwIfAborted()
        const cancelled = new Promise<never>((_resolve, reject) => {
          const abort = () => {
            reject(new LocalSourceError('cancelled'))
          }
          signal.addEventListener('abort', abort, { once: true })
          detach = () => {
            signal.removeEventListener('abort', abort)
          }
        })
        const result = await Promise.race([read({ ...context, signal }), cancelled])
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
            reason: detail ?? sourceReason(code),
            observedAt: null,
            freshness: { state: 'unknown', ageMs: null },
          },
          data: null,
        }
      } finally {
        detach?.()
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
