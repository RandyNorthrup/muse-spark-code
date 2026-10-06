import { createHash } from 'node:crypto'
import {
  ACP_WORKSPACE_HASH_CHARS,
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
export class LocalSourceError extends Error {
  constructor(readonly code: LocalFailure) {
    super(code)
  }
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
        if (signal.aborted) code = 'cancelled'
        else if (error instanceof LocalSourceError) code = error.code
        return {
          record: {
            id: kind,
            status: code === 'disabled' ? 'notApplicable' : 'unavailable',
            reason: sourceReason(code),
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
