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
  return `${CONTEXT_PREFIX}${JSON.stringify(estimateLimitContextSchema.parse(context))}`
}
export function resolveLimitContext(
  fleet: FleetSnapshot,
  supplied?: EstimateLimitContext,
): EstimateLimitContext {
  if (supplied !== undefined) return estimateLimitContextSchema.parse(supplied)
  const records = new Set(
    fleet.accounts
      .flatMap((account) => account.statedLimits ?? [])
      .filter((value) => isLimitContextEvidence(value)),
  )
  if (records.size === 0) return { facts: [], labels: [] }
  let value: unknown
  try {
    if (records.size !== 1) throw new Error('conflicting-context')
    const encoded = records.values().next().value
    if (encoded === undefined) throw new Error('missing-context')
    value = JSON.parse(encoded.slice(CONTEXT_PREFIX.length))
  } catch {
    throw new EstimateDiagnosticError({
      code: 'engine-refused',
      parameters: { reason: 'invalid-limit-context' },
    })
  }
  const parsed = estimateLimitContextSchema.safeParse(value)
  if (!parsed.success)
    throw new EstimateDiagnosticError({
      code: 'engine-refused',
      parameters: { reason: 'invalid-limit-context' },
    })
  return parsed.data
}
