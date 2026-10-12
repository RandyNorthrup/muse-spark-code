// Plain code/parameters contract for the M117 snapshot-branch diagnostic join.
import * as z from 'zod/mini'
export const estimateDiagnosticSchema = /* @__PURE__ */ (() =>
  z.strictObject({
    code: z.enum([
      'fleet-account-blocked',
      'fleet-caps-invalid',
      'fleet-account-invalid',
      'fleet-ci-invalid',
      'fleet-binding-invalid',
      'missing-machine',
      'schedule-refused',
      'engine-refused',
    ]),
    parameters: z.strictObject({
      reason: z.optional(z.string().check(z.regex(/^[\w.:-]+(?: [\w.-]+)*$/))),
      label: z.optional(z.string().check(z.minLength(1))),
      reset: z.optional(z.nullable(z.iso.datetime())),
    }),
  }))()
export type EstimateDiagnostic = z.infer<typeof estimateDiagnosticSchema>
export class EstimateDiagnosticError extends Error {
  constructor(readonly estimateDiagnostic: EstimateDiagnostic) {
    super(estimateDiagnostic.parameters.reason ?? estimateDiagnostic.code)
    this.name = 'EstimateDiagnosticError'
  }
}
