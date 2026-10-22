import type { FleetSnapshot } from '../../shared/estimate'
import { EstimateDiagnosticError } from './diagnostic'
import * as z from 'zod/mini'
import { ESTIMATE_MAX_ITEMS } from '../../shared/constants'
import { estimateLimitFactSchema } from '../../shared/estimateFacts'
import { accountIdSchema } from '../../shared/accountId'
export const estimateLimitContextSchema = z.strictObject({
  facts: z.array(estimateLimitFactSchema).check(z.maxLength(ESTIMATE_MAX_ITEMS * 2)),
  labels: z.array(
    z.strictObject({
      accountId: accountIdSchema,
      providerId: accountIdSchema,
      label: z.string().check(z.minLength(1)),
    }),
  ),
})
export type EstimateLimitContext = z.infer<typeof estimateLimitContextSchema>

// The existing evidence string carries canonical JSON on the application boundary.
// Node consumers decode the entire strict context before use; the panel renders
// this evidence as text and acquires no new validation or presentation dependency.
const CONTEXT_PREFIX = 'estimate-limit-context:'
export function isLimitContextEvidence(value: string): boolean {
  return value.startsWith(CONTEXT_PREFIX)
}
export function encodeLimitContext(context: EstimateLimitContext): string {
  const parsed = estimateLimitContextSchema.safeParse(context)
  if (!parsed.success)
    throw new EstimateDiagnosticError('invalid-input: invalid-limit-context', undefined, {
      cause: parsed.error,
    })
  return `${CONTEXT_PREFIX}${JSON.stringify(parsed.data)}`
}
export function resolveLimitContext(
  fleet: FleetSnapshot,
  supplied?: EstimateLimitContext,
): EstimateLimitContext {
  if (supplied !== undefined) {
    const parsed = estimateLimitContextSchema.safeParse(supplied)
    if (!parsed.success)
      throw new EstimateDiagnosticError('invalid-input: invalid-limit-context', undefined, {
        cause: parsed.error,
      })
    return parsed.data
  }
  const records = new Set(
    fleet.accounts
      .flatMap((account) => account.statedLimits ?? [])
      .filter((value) => isLimitContextEvidence(value)),
  )
  if (records.size === 0) return { facts: [], labels: [] }
  let value: unknown
  try {
    if (records.size !== 1)
      throw new EstimateDiagnosticError('invalid-input: invalid-limit-context')
    const encoded = records.values().next().value
    if (encoded === undefined)
      throw new EstimateDiagnosticError('invalid-input: invalid-limit-context')
    value = JSON.parse(encoded.slice(CONTEXT_PREFIX.length))
  } catch (error) {
    throw new EstimateDiagnosticError('invalid-input: invalid-limit-context', undefined, {
      cause: error,
    })
  }
  const parsed = estimateLimitContextSchema.safeParse(value)
  if (!parsed.success) throw new EstimateDiagnosticError('invalid-input: invalid-limit-context')
  return parsed.data
}
