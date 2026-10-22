// The node's own numbers (M110f lane O, D90.19): a Prometheus text page
// the server (lane N) answers with, and the OpenTelemetry switch, which
// stays off until the person names their collector. Both read live
// values; neither invents any.
import * as z from 'zod/mini'

export const nodeMetricsSchema = z.strictObject({
  version: z.string().check(z.minLength(1)),
  uptimeSeconds: z.int().check(z.gte(0)),
  sealed: z.boolean(),
  workers: z.int().check(z.gte(0)),
})
export type NodeMetrics = z.infer<typeof nodeMetricsSchema>

const BACKSLASH_CODE = 92

function escapeLabel(value: string): string {
  const backslash = String.fromCodePoint(BACKSLASH_CODE)
  return value
    .replaceAll(backslash, () => `${backslash}${backslash}`)
    .replaceAll('"', () => `${backslash}"`)
    .replaceAll('\n', () => `${backslash}n`)
}

/** The Prometheus exposition text for this instant's readings. */
export function formatNodeMetrics(metrics: NodeMetrics): string {
  const parsed = nodeMetricsSchema.parse(metrics)
  const info = `muse_node_info{version="${escapeLabel(parsed.version)}"} 1`
  const uptime = `muse_node_uptime_seconds ${String(parsed.uptimeSeconds)}`
  const sealed = `muse_node_sealed ${parsed.sealed ? '1' : '0'}`
  const workers = `muse_node_workers ${String(parsed.workers)}`
  return `${info}\n${uptime}\n${sealed}\n${workers}\n`
}

export const otelSettingsSchema = z.strictObject({
  endpoint: z.optional(z.string()),
})
export type OtelSettings = z.infer<typeof otelSettingsSchema>

/** The collector endpoint, or undefined while export stays off. */
export function otelExportTarget(settings: OtelSettings): string | undefined {
  const parsed = otelSettingsSchema.parse(settings)
  return parsed.endpoint === undefined || parsed.endpoint === '' ? undefined : parsed.endpoint
}
