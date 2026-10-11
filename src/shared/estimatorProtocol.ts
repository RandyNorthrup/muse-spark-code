// Estimator boundaries load on first use (D6). These are application messages,
// validated before the host dispatches or the browser stores any payload.
import * as z from 'zod/mini'
import { estimateRequestSchema, estimateSectionSchema } from './estimate'

const estimatorToHostSchema = z.discriminatedUnion('type', [
  // The capacity estimator (M117, PLAN.md D97): run an estimate from the
  // parsed request; the host answers with `estimatorSection`. Strict: the
  // request is validated before anything runs.
  z.strictObject({
    type: z.literal('estimateRun'),
    requestId: z.optional(z.string().check(z.minLength(1))),
    request: estimateRequestSchema,
  }),
  // Start the audited first contract wave from the last estimate's inputs;
  // the host answers with a notice naming what started or the refusal.
  z.strictObject({
    type: z.literal('estimateSpinUp'),
    requestId: z.optional(z.string().check(z.minLength(1))),
    setup: z.optional(estimateSectionSchema.shape.setups.def.element.shape.kind),
  }),
])
const hostToEstimatorSchema = z.discriminatedUnion('type', [
  // The capacity estimator's latest section (M117, PLAN.md D97): the panel
  // renders it, and a new section reveals the panel.
  z.object({
    type: z.literal('estimatorSection'),
    requestId: z.optional(z.string().check(z.minLength(1))),
    section: estimateSectionSchema,
  }),
  z.strictObject({
    type: z.literal('estimatorFailure'),
    requestId: z.optional(z.string().check(z.minLength(1))),
    reason: z.string(),
  }),
  z.strictObject({
    type: z.literal('estimatorStarted'),
    requestId: z.optional(z.string().check(z.minLength(1))),
    error: z.optional(z.string()),
  }),
])
export type EstimatorToHostMessage = z.infer<typeof estimatorToHostSchema>
export type HostToEstimatorMessage = z.infer<typeof hostToEstimatorSchema>
function parse<T>(schema: z.ZodMiniType<T>, input: unknown) {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true as const, message: result.data }
    : { ok: false as const, error: z.prettifyError(result.error) }
}
export function parseEstimatorToHostMessage(input: unknown) {
  return parse(estimatorToHostSchema, input)
}
export function parseHostToEstimatorMessage(input: unknown) {
  return parse(hostToEstimatorSchema, input)
}
