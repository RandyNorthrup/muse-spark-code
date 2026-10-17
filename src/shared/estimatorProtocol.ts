// Estimator boundaries load on first use (D6). These are application messages,
// validated before the host dispatches or the browser stores any payload.
import * as z from 'zod/mini'
import type { EstimateDiagnostic } from './estimateView'
import { estimateRequestSchema, estimateSectionSchema } from './estimate'

const requestIdSchema = z.optional(z.string().check(z.minLength(1)))

const estimatorToHostSchema = z.discriminatedUnion('type', [
  // The capacity estimator (M117, PLAN.md D97): run an estimate from the
  // parsed request; the host answers with `estimatorSection`. Strict: the
  // request is validated before anything runs.
  z.strictObject({
    type: z.literal('estimateRun'),
    requestId: requestIdSchema,
    request: estimateRequestSchema,
  }),
  z.strictObject({
    type: z.literal('estimateCommand'),
    requestId: requestIdSchema,
    command: z.string().check(z.minLength(1)),
    context: z.strictObject({
      asOf: estimateRequestSchema.shape.asOf,
      optimize: estimateRequestSchema.shape.optimize,
    }),
  }),
  // Start the audited first contract wave from the last estimate's inputs;
  // the host answers with a notice naming what started or the refusal.
  z.strictObject({
    type: z.literal('estimateSpinUp'),
    requestId: requestIdSchema,
    setup: z.optional(estimateSectionSchema.shape.setups.def.element.shape.kind),
  }),
])
const hostToEstimatorSchema = (estimateDiagnosticSchema: z.ZodMiniType<EstimateDiagnostic>) => {
  return z.discriminatedUnion('type', [
    // The capacity estimator's latest section (M117, PLAN.md D97): the panel
    // renders it, and a new section reveals the panel.
    z.object({
      type: z.literal('estimatorSection'),
      requestId: requestIdSchema,
      section: estimateSectionSchema.check(
        z.refine(
          (section) =>
            section.currentRefusal === undefined ||
            estimateDiagnosticSchema.safeParse({ estimateDiagnostic: section.currentRefusal })
              .success,
        ),
      ),
    }),
    z.strictObject({
      type: z.literal('estimatorFailure'),
      requestId: requestIdSchema,
      diagnostic: estimateDiagnosticSchema,
    }),
    z.strictObject({
      type: z.literal('estimatorStarted'),
      requestId: requestIdSchema,
      diagnostic: z.optional(estimateDiagnosticSchema),
    }),
  ])
}
export type EstimatorToHostMessage = z.infer<typeof estimatorToHostSchema>
export type HostToEstimatorMessage = z.infer<ReturnType<typeof hostToEstimatorSchema>>
function parse<T>(schema: z.ZodMiniType<T>, input: unknown) {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true as const, message: result.data }
    : { ok: false as const, error: z.prettifyError(result.error) }
}
export function parseEstimatorToHostMessage(input: unknown) {
  return parse(estimatorToHostSchema, input)
}
export async function parseHostToEstimatorMessage(input: unknown) {
  const { estimateDiagnosticSchema } = await import('./estimateDiagnostic')
  return parse(hostToEstimatorSchema(estimateDiagnosticSchema), input)
}
