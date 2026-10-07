// M108 U's account slice. M95/M104 supply the authenticated panel envelope.
// This local projection carries metadata and policy evidence, never credentials.
import * as z from 'zod/mini'
import {
  accountIdSchema,
  accountPoolSchema,
  accountConfirmationChoiceSchema,
  accountEventSchema,
} from './accounts'

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
  // The panel's record stamp is separate from the provider's decision fields.
  recordVersion: z.string().check(z.minLength(1)),
  checkedAt: z.iso.date(),
  isStale: z.boolean(),
  pooling: z.enum(['on', 'confirm', 'notOffered']),
  multipleAccounts: z.enum(['yes', 'conditions', 'onePerPerson', 'unclear']),
  isCredentialHeld: z.boolean(),
  recovery: z.enum(['none', 'chatgptPlan', 'museCodeSubscription']),
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

/** Correlation survives delayed bridge/provider lookups and replacement dialogs. */
export const accountsPolicyQuestionSchema = z.strictObject({
  questionId: z.uuid(),
  providerGeneration: z.int().check(z.positive()),
  policy: accountsPolicyViewSchema,
})
export type AccountsPolicyQuestion = z.infer<typeof accountsPolicyQuestionSchema>

/** P's stop error supplies recovery; an event trigger alone cannot predict it. */
export const accountsNoticeSchema = z
  .strictObject({ event: accountEventSchema, resetAt: z.nullable(z.iso.datetime()) })
  .check(z.refine((notice) => notice.event.type === 'stop' || notice.resetAt === null))

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
