// M108 U's account slice. M95/M104 supply the authenticated panel envelope.
// This local projection carries metadata and policy evidence, never credentials.
import * as z from 'zod/mini'
import { accountIdSchema, accountPoolSchema, accountConfirmationChoiceSchema } from './accounts'

const safeUrl = z.url().check(
  z.refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.username === '' && url.password === ''
    } catch {
      return false
    }
  }),
)
export const accountsPolicyViewSchema = z.strictObject({
  provider: accountIdSchema,
  product: accountIdSchema,
  pooling: z.enum(['on', 'confirm', 'notOffered']),
  multipleAccounts: z.enum(['yes', 'conditions', 'onePerPerson', 'unclear']),
  isCredentialHeld: z.boolean(),
  recovery: z.enum(['none', 'chatgptPlan', 'museCodeSubscription']),
  recordVersion: z.string().check(z.minLength(1)),
  checkedAt: z.iso.date(),
  isStale: z.boolean(),
  sources: z
    .array(
      z.strictObject({
        quote: z.string().check(z.minLength(1)),
        url: safeUrl,
        pageDate: z.nullable(z.string()),
      }),
    )
    .check(z.minLength(1)),
})
export type AccountsPolicyView = z.infer<typeof accountsPolicyViewSchema>

export const modelsAccountsSliceSchema = z
  .strictObject({
    provider: accountIdSchema,
    providerLabel: z.string().check(z.minLength(1)),
    accounts: accountPoolSchema,
    currentAccount: z.nullable(accountIdSchema),
    isSwapOn: z.boolean(),
    isParallelOn: z.boolean(),
    policy: z.nullable(accountsPolicyViewSchema),
    confirmation: z.nullable(accountConfirmationChoiceSchema),
    usageUrl: z.nullable(safeUrl),
    // Only captured, capability-supported windows are editable.
    planWindows: z.array(accountIdSchema),
    hasRateHeadroom: z.boolean(),
  })
  .check(
    z.refine(
      (slice) =>
        slice.currentAccount === null ||
        slice.accounts.some((account) => account.id === slice.currentAccount),
    ),
  )
export type ModelsAccountsSlice = z.infer<typeof modelsAccountsSliceSchema>
