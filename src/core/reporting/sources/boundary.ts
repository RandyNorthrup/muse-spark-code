import * as z from 'zod/mini'
import { REPORT_MAX_ROWS } from '../../../shared/constants'
import type { UiText } from '../../../shared/l10n/en'
import { reportSourceSchema, type ReportLabelKey } from '../../../shared/reportSchema'
import { localFailureOf, LocalSourceError, sourceReason, type LocalFailure } from './local'
import type {
  ReportSourceKind,
  ReportSourcePayloads,
  ReportSourcePort,
  SourceReadContext,
  SourceResult,
} from './types'

export interface ReportProblem {
  readonly facet: ReportLabelKey
  readonly key: string
  readonly code: LocalFailure
  readonly reason: string
}
export type ReportRead<T> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly problem: ReportProblem }
export interface ReportRows<T> {
  readonly rows: readonly T[]
  readonly problems: readonly ReportProblem[]
  readonly refused: number
}
export interface ReportDecoder<T> {
  safeParse(value: unknown): { readonly success: boolean; readonly data?: T }
}

/** The recovery decoder itself is inside the protection boundary. */
function problem(
  reportText: UiText,
  facet: ReportLabelKey,
  key: string,
  error: unknown,
  fallback: LocalFailure,
): ReportProblem {
  const code = localFailureOf(error) ?? fallback
  return {
    facet,
    key,
    code,
    reason: `${reportText.reportLabels[facet]} (${key}): ${sourceReason(code, reportText)}`,
  }
}

/** Each property read and decoder runs inside the same engine-owned boundary. */
export function readReportField<T>(
  reportText: UiText,
  facet: ReportLabelKey,
  key: string,
  read: () => unknown,
  schema: ReportDecoder<T>,
): ReportRead<T> {
  try {
    const value = read()
    const parsed = schema.safeParse(value)
    return parsed.success && parsed.data !== undefined
      ? { status: 'available', value: parsed.data }
      : { status: 'unavailable', problem: problem(reportText, facet, key, undefined, 'invalid') }
  } catch (error) {
    return { status: 'unavailable', problem: problem(reportText, facet, key, error, 'failed') }
  }
}

/** Await the owner's settlement; never race a live read against abandonment. */
export async function awaitReportRead<T>(
  context: SourceReadContext,
  facet: ReportLabelKey,
  key: string,
  read: (signal: AbortSignal) => Promise<unknown>,
  schema: ReportDecoder<T>,
): Promise<ReportRead<T>> {
  try {
    context.signal.throwIfAborted()
    const value = await read(context.signal)
    context.signal.throwIfAborted()
    return readReportField(context.reportText, facet, key, () => value, schema)
  } catch (error) {
    return {
      status: 'unavailable',
      problem: problem(
        context.reportText,
        facet,
        key,
        error,
        context.signal.aborted ? 'cancelled' : 'failed',
      ),
    }
  }
}

/** The same admission primitive serves decoded arrays and combined streams. */
export function isReportRowAdmitted<T>(value: T, rows: T[], capacity = REPORT_MAX_ROWS): boolean {
  if (rows.length >= Math.min(capacity, REPORT_MAX_ROWS)) return false
  rows.push(value)
  return true
}

/** No iterator, length getter or slot access can escape record isolation. */
export function readReportRows<T>(
  reportText: UiText,
  facet: ReportLabelKey,
  key: string,
  input: unknown,
  schema: ReportDecoder<T>,
  capacity = REPORT_MAX_ROWS,
): ReportRows<T> {
  const rows: T[] = []
  const problems: ReportProblem[] = []
  let refused = 0
  try {
    if (!Array.isArray(input)) throw new LocalSourceError('invalid')
    const length: unknown = Reflect.get(input, 'length')
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0)
      throw new LocalSourceError('invalid')
    const examined = Math.min(length, REPORT_MAX_ROWS + 1)
    refused = length - examined
    for (let index = 0; index < examined; index += 1) {
      const result = readReportField(
        reportText,
        facet,
        `${key}/${String(index)}`,
        () => Reflect.get(input, String(index)),
        schema,
      )
      if (result.status === 'unavailable') {
        problems.push(result.problem)
        continue
      }
      if (!isReportRowAdmitted(result.value, rows, capacity)) refused += 1
    }
    if (refused > 0)
      problems.push(
        problem(
          reportText,
          facet,
          `${key}/${String(refused)}`,
          new LocalSourceError('limit'),
          'limit',
        ),
      )
  } catch (error) {
    problems.push(problem(reportText, facet, key, error, 'failed'))
  }
  return { rows, problems, refused }
}

/**
 * Recover whole facts through the engine boundary and join the reader's
 * partial with one named problem per damaged facet. Throws invalid when
 * nothing valid remains, so kinds share one recovery shape instead of
 * cloning it per source.
 */
export function recoverSourceFacts<T>(
  reportText: UiText,
  facet: ReportLabelKey,
  key: string,
  schema: z.ZodMiniType<T>,
  read: { readonly facts: unknown; readonly partial?: string | undefined },
): { readonly data: T; readonly partial: string | undefined } {
  const recovered = readReportFacts(reportText, facet, key, schema, read.facts)
  if (recovered.data === null) throw new LocalSourceError('invalid')
  const partial = [read.partial, ...recovered.problems.map((problem) => problem.reason)]
    .filter((reason) => reason !== undefined)
    .join(' ')
  return { data: recovered.data, partial: partial === '' ? undefined : partial }
}

/** Every port read crosses this boundary before another source is awaited. */
export async function readReportSource<K extends ReportSourceKind>(
  kind: K,
  port: ReportSourcePort<K>,
  context: SourceReadContext,
): Promise<SourceResult<ReportSourcePayloads[K]>> {
  try {
    context.signal.throwIfAborted()
    const result = await port.read(context)
    context.signal.throwIfAborted()
    if (
      result.data !== null &&
      (typeof result.data !== 'object' ||
        [
          'questions',
          'checkRuns',
          'stores',
          'agentUsage',
          'fleet',
          'estimate',
          'playbook',
          'issues',
          'schedules',
          'keybindings',
        ].includes(kind) !== Array.isArray(result.data))
    )
      throw new LocalSourceError('invalid')
    reportSourceSchema.parse(result.record)
    if (
      result.data == null &&
      (result.record.status === 'ok' || result.record.status === 'partial')
    )
      throw new LocalSourceError('invalid')
    return result
  } catch (error) {
    const code = context.signal.aborted ? 'cancelled' : (localFailureOf(error) ?? 'failed')
    return {
      data: null,
      record: {
        id: kind,
        status: 'unavailable',
        reason: `${context.reportText.reportKinds[context.options.kind]} (${kind}): ${sourceReason(code, context.reportText)}`,
        observedAt: null,
        freshness: { state: 'unknown', ageMs: null },
      },
    }
  }
}

/** Decode an application schema by facet, so one invalid array/record cannot
 * veto its independently valid siblings. Essential scalar damage rejects only
 * its own record; nullable facets remain explicitly unknown with a problem. */
export function readReportFacts<T>(
  reportText: UiText,
  facet: ReportLabelKey,
  key: string,
  schema: z.ZodMiniType<T>,
  input: unknown,
): { readonly data: T | null; readonly problems: readonly ReportProblem[] } {
  const problems: ReportProblem[] = []
  const recover = (decoder: z.core.$ZodType, value: unknown, path: string): unknown => {
    try {
      try {
        const complete = z.safeParse(decoder, value)
        if (complete.success) return complete.data
      } catch {
        /* Decompose failed getters into their own protected fields below. */
      }
      if (decoder instanceof z.ZodMiniNullable) {
        if (value === null) return null
        const recovered = recover(decoder.def.innerType, value, path)
        return z.safeParse(decoder, recovered).success ? recovered : null
      }
      if (value === undefined && decoder instanceof z.ZodMiniOptional) return undefined
      if (decoder instanceof z.ZodMiniArray) {
        const result = readReportRows(reportText, facet, path, value, {
          safeParse: (entry) =>
            z.safeParse(decoder.def.element, recover(decoder.def.element, entry, `${path}/record`)),
        })
        problems.push(...result.problems)
        return result.rows
      }
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        decoder instanceof z.ZodMiniObject
      ) {
        const fields: Record<string, unknown> = {}
        for (const [name, child] of Object.entries(decoder.shape)) {
          try {
            fields[name] = recover(child, Reflect.get(value, name), `${path}/${name}`)
          } catch (error) {
            problems.push(problem(reportText, facet, `${path}/${name}`, error, 'failed'))
          }
        }
        const parsed = z.safeParse(decoder, fields)
        if (parsed.success) return parsed.data
      }
      const result = readReportField(reportText, facet, path, () => value, {
        safeParse: (entry) => z.safeParse(decoder, entry),
      })
      if (result.status === 'available') return result.value
      problems.push(result.problem)
      return undefined
    } catch (error) {
      problems.push(problem(reportText, facet, path, error, 'failed'))
      return undefined
    }
  }
  const recovered = recover(schema, input, key)
  try {
    const parsed = schema.safeParse(recovered)
    if (parsed.success) return { data: parsed.data, problems }
  } catch (error) {
    problems.push(problem(reportText, facet, key, error, 'failed'))
  }
  if (problems.length === 0) problems.push(problem(reportText, facet, key, undefined, 'invalid'))
  return { data: null, problems }
}
