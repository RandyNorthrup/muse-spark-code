// M108 U's account slice. M95/M104 supply the authenticated panel envelope.
// This local projection carries metadata and policy evidence, never credentials.
// The wire schemas (the policy view and question the confirmations quote)
// live on the accounts bridge and are re-exported here for panel readers.
import * as z from 'zod/mini'
import {
  accountIdSchema,
  accountPoolSchema,
  accountConfirmationChoiceSchema,
  accountEventSchema,
} from './accounts'
import { safePolicyUrl, accountsPolicyViewSchema } from './hostApi/accounts'

export {
  accountsPolicyViewSchema,
  accountsPolicyQuestionSchema,
  type AccountsPolicyView,
  type AccountsPolicyQuestion,
} from './hostApi/accounts'

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
    usageUrl: z.nullable(safePolicyUrl),
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
