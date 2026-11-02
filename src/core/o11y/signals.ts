// Desktop observability (M111 lane OB, PLAN.md D91.22): the telemetry
// signals the local OTLP receiver parses. The wire shapes are
// opentelemetry-proto's OTLP/HTTP JSON (Stable): Resource → Scope →
// records under `resourceMetrics`, `resourceLogs` and `resourceSpans`.
// The envelopes below strip what they do not read (a real SDK sends many
// fields the local store never keeps); what they keep is scrubbed and
// bounded before it lands, like M93's journal.

import * as z from 'zod/mini'
import {
  NANOSECONDS_PER_MILLISECOND,
  O11Y_ATTRIBUTES_MAX,
  O11Y_ATTRIBUTE_KEY_MAX_CHARS,
  O11Y_ATTRIBUTE_VALUE_MAX_CHARS,
  O11Y_LOG_MESSAGE_MAX_CHARS,
  O11Y_METRIC_NAME_MAX_CHARS,
  O11Y_SPAN_NAME_MAX_CHARS,
} from '../../shared/constants'
import { redactSecrets } from '../../shared/redact'

/** The OTLP/HTTP routes the local receiver answers. */
export const O11Y_SIGNAL_ROUTES = {
  metrics: '/v1/metrics',
  logs: '/v1/logs',
  traces: '/v1/traces',
} as const
export type O11ySignal = keyof typeof O11Y_SIGNAL_ROUTES

/** Every component that may send telemetry: anything else is refused. */
export const O11Y_COMPONENTS = [
  'compositor',
  'shell',
  'sysd',
  'app-main',
  'app-renderer',
  'node',
  'tool-host',
  'installer',
  'admin-helper',
  'companion',
  'tui',
] as const
export type O11yComponent = (typeof O11Y_COMPONENTS)[number]

/** A metric or attribute name: dotted words, never a sentence. */
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u
/** A hex id: 32 chars for traces, 16 for spans. */
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/u
/**
OTLP's JSON mapping sends enums as their string names; like protobuf's
own JSON parsers, the receiver also takes the numeric form.
*/
const OTLP_STATUS_ERROR = 'STATUS_CODE_ERROR'

const otlpAnyValueSchema = z.object({
  stringValue: z.optional(z.string()),
  intValue: z.optional(z.union([z.string(), z.number()])),
  doubleValue: z.optional(z.number()),
  boolValue: z.optional(z.boolean()),
})

const otlpAttributeSchema = z.object({
  key: z.string(),
  value: z.optional(otlpAnyValueSchema),
})

const otlpResourceSchema = z.object({
  attributes: z.optional(z.array(otlpAttributeSchema)),
})

const otlpDataPointSchema = z.object({
  timeUnixNano: z.optional(z.union([z.string(), z.number()])),
  asDouble: z.optional(z.union([z.string(), z.number()])),
  asInt: z.optional(z.union([z.string(), z.number()])),
  attributes: z.optional(z.array(otlpAttributeSchema)),
})

const otlpMetricSchema = z.object({
  name: z.string(),
  description: z.optional(z.string()),
  unit: z.optional(z.string()),
  sum: z.optional(z.object({ dataPoints: z.optional(z.array(otlpDataPointSchema)) })),
  gauge: z.optional(z.object({ dataPoints: z.optional(z.array(otlpDataPointSchema)) })),
})

const otlpMetricsRequestSchema = z
  .object({
    resourceMetrics: z.optional(
      z.array(
        z.object({
          resource: z.optional(otlpResourceSchema),
          scopeMetrics: z.optional(
            z.array(
              z.object({
                metrics: z.optional(z.array(otlpMetricSchema)),
              }),
            ),
          ),
        }),
      ),
    ),
  })
  .check(z.refine((body) => body.resourceMetrics !== undefined))

const otlpLogRecordSchema = z.object({
  timeUnixNano: z.optional(z.union([z.string(), z.number()])),
  severityNumber: z.optional(z.number()),
  severityText: z.optional(z.string()),
  body: z.optional(otlpAnyValueSchema),
  attributes: z.optional(z.array(otlpAttributeSchema)),
  traceId: z.optional(z.string()),
  spanId: z.optional(z.string()),
})

const otlpLogsRequestSchema = z
  .object({
    resourceLogs: z.optional(
      z.array(
        z.object({
          resource: z.optional(otlpResourceSchema),
          scopeLogs: z.optional(
            z.array(
              z.object({
                logRecords: z.optional(z.array(otlpLogRecordSchema)),
              }),
            ),
          ),
        }),
      ),
    ),
  })
  .check(z.refine((body) => body.resourceLogs !== undefined))

const otlpSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.optional(z.string()),
  name: z.string(),
  startTimeUnixNano: z.optional(z.union([z.string(), z.number()])),
  endTimeUnixNano: z.optional(z.union([z.string(), z.number()])),
  status: z.optional(z.object({ code: z.optional(z.union([z.number(), z.string()])) })),
  attributes: z.optional(z.array(otlpAttributeSchema)),
})

const otlpTracesRequestSchema = z
  .object({
    resourceSpans: z.optional(
      z.array(
        z.object({
          resource: z.optional(otlpResourceSchema),
          scopeSpans: z.optional(
            z.array(
              z.object({
                spans: z.optional(z.array(otlpSpanSchema)),
              }),
            ),
          ),
        }),
      ),
    ),
  })
  .check(z.refine((body) => body.resourceSpans !== undefined))

/** One scrubbed attribute the store keeps. */
export const o11yAttributeSchema = z.strictObject({
  key: z.string().check(z.minLength(1), z.maxLength(O11Y_ATTRIBUTE_KEY_MAX_CHARS)),
  value: z.string().check(z.maxLength(O11Y_ATTRIBUTE_VALUE_MAX_CHARS)),
})
export type O11yAttribute = z.infer<typeof o11yAttributeSchema>

/** One metric point as the ring store keeps it. */
export const o11yMetricPointSchema = z.strictObject({
  at: z.int().check(z.gte(0)),
  component: z.enum(O11Y_COMPONENTS),
  name: z.string().check(z.minLength(1), z.maxLength(O11Y_METRIC_NAME_MAX_CHARS)),
  value: z.number(),
  unit: z.optional(z.string().check(z.minLength(1), z.maxLength(O11Y_ATTRIBUTE_KEY_MAX_CHARS))),
  attributes: z.array(o11yAttributeSchema).check(z.maxLength(O11Y_ATTRIBUTES_MAX)),
})
export type O11yMetricPoint = z.infer<typeof o11yMetricPointSchema>

/** One log record as the ring store keeps it. */
export const o11yLogRecordSchema = z.strictObject({
  at: z.int().check(z.gte(0)),
  component: z.enum(O11Y_COMPONENTS),
  severity: z.int().check(z.gte(0)),
  message: z.string().check(z.maxLength(O11Y_LOG_MESSAGE_MAX_CHARS)),
  traceId: z.optional(z.string()),
  spanId: z.optional(z.string()),
  attributes: z.array(o11yAttributeSchema).check(z.maxLength(O11Y_ATTRIBUTES_MAX)),
})
export type O11yLogRecord = z.infer<typeof o11yLogRecordSchema>

/** One span as the ring store keeps it. */
export const o11ySpanSchema = z.strictObject({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.optional(z.string()),
  component: z.enum(O11Y_COMPONENTS),
  name: z.string().check(z.minLength(1), z.maxLength(O11Y_SPAN_NAME_MAX_CHARS)),
  startMs: z.int().check(z.gte(0)),
  endMs: z.int().check(z.gte(0)),
  error: z.boolean(),
  attributes: z.array(o11yAttributeSchema).check(z.maxLength(O11Y_ATTRIBUTES_MAX)),
})
export type O11ySpan = z.infer<typeof o11ySpanSchema>

/** Why a request or record was refused: fixed words, never the payload. */
export type O11yRefusal =
  'notOtlp' | 'unknownComponent' | 'badName' | 'badValue' | 'badTime' | 'badId'

export type O11yIngest<T> =
  | { readonly ok: true; readonly records: readonly T[] }
  | { readonly ok: false; readonly reason: O11yRefusal }

const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(O11Y_COMPONENTS)

function attributeText(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const parsed = otlpAnyValueSchema.safeParse(value)
  if (!parsed.success) return undefined
  const { stringValue, intValue, doubleValue, boolValue } = parsed.data
  if (stringValue !== undefined) return stringValue
  if (intValue !== undefined) return String(intValue)
  if (doubleValue !== undefined)
    return Number.isFinite(doubleValue) ? String(doubleValue) : undefined
  return boolValue === undefined ? undefined : String(boolValue)
}

function componentOf(attributes: readonly { key: string; value?: unknown }[] | undefined): string {
  const items = attributes ?? []
  for (const attribute of items) {
    if (attribute.key === 'service.name') return attributeText(attribute.value) ?? ''
  }
  return ''
}

function isComponent(component: string): component is O11yComponent {
  return KNOWN_COMPONENTS.has(component)
}

/**
Nanoseconds since the epoch (a string or number on the wire) as whole
milliseconds. Real nano stamps exceed `Number.MAX_SAFE_INTEGER`, so a
string is read as digits — never through `Number` — and the last six
digits fall off for whole milliseconds.
*/
/** The nano stamp's sub-millisecond digits, read off the divisor rather than counted. */
const NANO_FRACTION_DIGITS = String(NANOSECONDS_PER_MILLISECOND).length - 1

function nanosToMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    return !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER
      ? undefined
      : Math.floor(value / NANOSECONDS_PER_MILLISECOND)
  }
  if (!/^\d{1,24}$/u.test(value)) return undefined
  const ms =
    value.length <= NANO_FRACTION_DIGITS ? 0 : Number(value.slice(0, -NANO_FRACTION_DIGITS))
  return Number.isSafeInteger(ms) ? ms : undefined
}

/**
A message the store may keep: secret-shaped stretches are replaced with
the mark (M93's second scrub does the same to the report draft), so the
record still diagnoses without the secret. Only an over-long message is
refused.
*/
function scrubMessage(value: string, maxChars: number): string | undefined {
  if (value.length > maxChars) return undefined
  const scrubbed = redactSecrets(value)
  return scrubbed.length > maxChars ? undefined : scrubbed
}

/** A dotted name the store may keep: on-pattern and within its bound. */
function scrubName(value: string, maxChars: number): string | undefined {
  return NAME_PATTERN.test(value) && value.length <= maxChars ? value : undefined
}

function scrubAttributes(
  attributes: readonly { key: string; value?: unknown }[] | undefined,
): O11yAttribute[] {
  const kept: O11yAttribute[] = []
  const items = attributes ?? []
  for (const attribute of items) {
    if (kept.length >= O11Y_ATTRIBUTES_MAX) break
    if (scrubName(attribute.key, O11Y_ATTRIBUTE_KEY_MAX_CHARS) === undefined) continue
    const text = attributeText(attribute.value)
    if (text === undefined) continue
    const value = scrubMessage(text, O11Y_ATTRIBUTE_VALUE_MAX_CHARS)
    if (value === undefined) continue
    kept.push({ key: attribute.key, value })
  }
  return kept
}

function pointValue(point: {
  asDouble?: string | number | undefined
  asInt?: string | number | undefined
}): number | undefined {
  const raw = point.asDouble ?? point.asInt
  if (raw === undefined) return undefined
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Parse an OTLP/HTTP metrics request body into scrubbed points. */
export function ingestOtlpMetrics(body: unknown): O11yIngest<O11yMetricPoint> {
  const parsed = otlpMetricsRequestSchema.safeParse(body)
  if (!parsed.success) return { ok: false, reason: 'notOtlp' }
  const records: O11yMetricPoint[] = []
  const resources = parsed.data.resourceMetrics ?? []
  for (const resource of resources) {
    const component = componentOf(resource.resource?.attributes)
    if (!isComponent(component)) return { ok: false, reason: 'unknownComponent' }
    const scopes = resource.scopeMetrics ?? []
    for (const scope of scopes) {
      const metrics = scope.metrics ?? []
      for (const metric of metrics) {
        if (scrubName(metric.name, O11Y_METRIC_NAME_MAX_CHARS) === undefined) {
          return { ok: false, reason: 'badName' }
        }
        const points = [...(metric.sum?.dataPoints ?? []), ...(metric.gauge?.dataPoints ?? [])]
        for (const point of points) {
          const at = nanosToMs(point.timeUnixNano)
          if (at === undefined) return { ok: false, reason: 'badTime' }
          const value = pointValue(point)
          if (value === undefined) return { ok: false, reason: 'badValue' }
          // Exporters send an empty unit when none was set; it reads
          // absent, never refused.
          const rawUnit = metric.unit === '' ? undefined : metric.unit
          const unit =
            rawUnit === undefined ? undefined : scrubName(rawUnit, O11Y_ATTRIBUTE_KEY_MAX_CHARS)
          if (unit === undefined && rawUnit !== undefined) {
            return { ok: false, reason: 'badName' }
          }
          const attributes = scrubAttributes(point.attributes)
          records.push({
            at,
            component,
            name: metric.name,
            value,
            ...(unit !== undefined && { unit }),
            attributes,
          })
        }
      }
    }
  }
  return { ok: true, records }
}

/** Parse an OTLP/HTTP logs request body into scrubbed records. */
export function ingestOtlpLogs(body: unknown): O11yIngest<O11yLogRecord> {
  const parsed = otlpLogsRequestSchema.safeParse(body)
  if (!parsed.success) return { ok: false, reason: 'notOtlp' }
  const records: O11yLogRecord[] = []
  const resources = parsed.data.resourceLogs ?? []
  for (const resource of resources) {
    const component = componentOf(resource.resource?.attributes)
    if (!isComponent(component)) return { ok: false, reason: 'unknownComponent' }
    const scopes = resource.scopeLogs ?? []
    for (const scope of scopes) {
      const logRecords = scope.logRecords ?? []
      for (const record of logRecords) {
        const at = nanosToMs(record.timeUnixNano)
        if (at === undefined) return { ok: false, reason: 'badTime' }
        const raw = attributeText(record.body) ?? ''
        const message = scrubMessage(raw, O11Y_LOG_MESSAGE_MAX_CHARS)
        if (message === undefined) return { ok: false, reason: 'badValue' }
        const severity =
          record.severityNumber !== undefined &&
          Number.isSafeInteger(record.severityNumber) &&
          record.severityNumber >= 0
            ? record.severityNumber
            : 0
        // Exporters send empty link ids when the record links nowhere;
        // they read absent, never refused.
        const rawTraceId = record.traceId === '' ? undefined : record.traceId
        const traceId =
          rawTraceId !== undefined && TRACE_ID_PATTERN.test(rawTraceId) ? rawTraceId : undefined
        if (traceId === undefined && rawTraceId !== undefined) {
          return { ok: false, reason: 'badId' }
        }
        const rawSpanId = record.spanId === '' ? undefined : record.spanId
        const spanId =
          rawSpanId !== undefined && SPAN_ID_PATTERN.test(rawSpanId) ? rawSpanId : undefined
        if (spanId === undefined && rawSpanId !== undefined) {
          return { ok: false, reason: 'badId' }
        }
        const attributes = scrubAttributes(record.attributes)
        records.push({
          at,
          component,
          severity,
          message,
          ...(traceId !== undefined && { traceId }),
          ...(spanId !== undefined && { spanId }),
          attributes,
        })
      }
    }
  }
  return { ok: true, records }
}

/** Parse an OTLP/HTTP traces request body into scrubbed spans. */
export function ingestOtlpTraces(body: unknown): O11yIngest<O11ySpan> {
  const parsed = otlpTracesRequestSchema.safeParse(body)
  if (!parsed.success) return { ok: false, reason: 'notOtlp' }
  const records: O11ySpan[] = []
  const resources = parsed.data.resourceSpans ?? []
  for (const resource of resources) {
    const component = componentOf(resource.resource?.attributes)
    if (!isComponent(component)) return { ok: false, reason: 'unknownComponent' }
    const scopes = resource.scopeSpans ?? []
    for (const scope of scopes) {
      const spans = scope.spans ?? []
      for (const span of spans) {
        if (!TRACE_ID_PATTERN.test(span.traceId) || !SPAN_ID_PATTERN.test(span.spanId)) {
          return { ok: false, reason: 'badId' }
        }
        // A root span's parent arrives as an empty id; it reads
        // absent, never refused.
        const parentSpanId = span.parentSpanId === '' ? undefined : span.parentSpanId
        if (parentSpanId !== undefined && !SPAN_ID_PATTERN.test(parentSpanId)) {
          return { ok: false, reason: 'badId' }
        }
        const name = scrubMessage(span.name, O11Y_SPAN_NAME_MAX_CHARS)
        if (name === undefined || name.length === 0) return { ok: false, reason: 'badName' }
        const startMs = nanosToMs(span.startTimeUnixNano)
        const endMs = nanosToMs(span.endTimeUnixNano)
        if (startMs === undefined || endMs === undefined || endMs < startMs) {
          return { ok: false, reason: 'badTime' }
        }
        const attributes = scrubAttributes(span.attributes)
        records.push({
          traceId: span.traceId,
          spanId: span.spanId,
          ...(parentSpanId !== undefined && { parentSpanId }),
          component,
          name,
          startMs,
          endMs,
          error: span.status?.code === 2 || span.status?.code === OTLP_STATUS_ERROR,
          attributes,
        })
      }
    }
  }
  return { ok: true, records }
}
