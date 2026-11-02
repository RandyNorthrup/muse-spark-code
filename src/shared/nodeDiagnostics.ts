// The Diagnostics page's payload schema (M111 lane OB), in its own
// module so the node bundles load it from dist/nodeDiagnostics.js on
// first use instead of carrying it in dist/node.js (D6; split at the
// CC-INT10 join, where the schema alone overran that bundle's budget).
import * as z from 'zod/mini'
import {
  NODE_MAX_PAGE_ITEMS,
  NODE_MAX_PATH_CHARS,
  O11Y_DIAGNOSTICS_MAX_CRASHES,
  O11Y_DIAGNOSTICS_MAX_LOGS,
  O11Y_DIAGNOSTICS_MAX_POINTS,
  O11Y_DIAGNOSTICS_MAX_SERIES,
  O11Y_DIAGNOSTICS_MAX_TRACES,
  O11Y_LOG_MESSAGE_MAX_CHARS,
  O11Y_METRIC_NAME_MAX_CHARS,
  O11Y_SPAN_NAME_MAX_CHARS,
} from './constants'
import { nodeTimeSchema } from './nodeAuth'

/** A telemetry word the Diagnostics page shows: a component, a name, a short detail. */
const diagnosticsWordSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(O11Y_METRIC_NAME_MAX_CHARS))

/** A non-negative whole count on the Diagnostics page. */
const diagnosticsCountSchema = z.int().check(z.gte(0))

const nodeDiagnosticsHealthSchema = z.strictObject({
  component: diagnosticsWordSchema,
  ready: z.boolean(),
  detail: diagnosticsWordSchema,
})

const nodeDiagnosticsBucketSchema = z.strictObject({
  minute: diagnosticsCountSchema,
  count: z.int().check(z.positive()),
  avg: z.number(),
  min: z.number(),
  max: z.number(),
})

const nodeDiagnosticsSeriesSchema = z.strictObject({
  component: diagnosticsWordSchema,
  name: diagnosticsWordSchema,
  unit: z.optional(diagnosticsWordSchema),
  buckets: z.array(nodeDiagnosticsBucketSchema).check(z.maxLength(O11Y_DIAGNOSTICS_MAX_POINTS)),
})

const nodeDiagnosticsLogSchema = z.strictObject({
  at: nodeTimeSchema,
  component: diagnosticsWordSchema,
  severity: diagnosticsCountSchema,
  message: z.string().check(z.maxLength(O11Y_LOG_MESSAGE_MAX_CHARS)),
})

const nodeDiagnosticsSpanSchema = z.strictObject({
  spanId: diagnosticsWordSchema,
  parentSpanId: z.optional(diagnosticsWordSchema),
  name: z.string().check(z.minLength(1), z.maxLength(O11Y_SPAN_NAME_MAX_CHARS)),
  startMs: nodeTimeSchema,
  endMs: nodeTimeSchema,
  error: z.boolean(),
})

const nodeDiagnosticsTraceSchema = z.strictObject({
  traceId: diagnosticsWordSchema,
  spans: z.array(nodeDiagnosticsSpanSchema).check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
})

const nodeDiagnosticsCrashSchema = z.strictObject({
  at: nodeTimeSchema,
  component: diagnosticsWordSchema,
  kind: diagnosticsWordSchema,
  code: diagnosticsWordSchema,
})

/**
The Diagnostics page's payload: health rows (the node first, then the
desktop's components when the desktop profile is present), the export
state (the endpoint as origin only, never userinfo), the records dropped
or skipped, and one page of each signal, newest first.
*/
export const nodeDiagnosticsSchema = z.strictObject({
  health: z.array(nodeDiagnosticsHealthSchema).check(z.maxLength(NODE_MAX_PAGE_ITEMS)),
  export: z.strictObject({
    on: z.boolean(),
    endpoint: z.optional(z.string().check(z.minLength(1), z.maxLength(NODE_MAX_PATH_CHARS))),
  }),
  dropped: diagnosticsCountSchema,
  unreadable: diagnosticsCountSchema,
  metrics: z.array(nodeDiagnosticsSeriesSchema).check(z.maxLength(O11Y_DIAGNOSTICS_MAX_SERIES)),
  logs: z.array(nodeDiagnosticsLogSchema).check(z.maxLength(O11Y_DIAGNOSTICS_MAX_LOGS)),
  traces: z.array(nodeDiagnosticsTraceSchema).check(z.maxLength(O11Y_DIAGNOSTICS_MAX_TRACES)),
  crashes: z.array(nodeDiagnosticsCrashSchema).check(z.maxLength(O11Y_DIAGNOSTICS_MAX_CRASHES)),
})
export type NodeDiagnostics = z.infer<typeof nodeDiagnosticsSchema>
