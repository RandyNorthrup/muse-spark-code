// Payloads for M104's authenticated accounts bridge. M104 owns the envelope,
// origin, permission and dispatch; credentials have no route through this API.
import * as z from 'zod/mini'
import {
  accountSchema,
  accountIdSchema,
  accountThresholdsSchema,
  accountConfirmationChoiceSchema,
} from '../accounts'
import { ACCOUNT_MAX_PER_PROVIDER } from '../constants'

const identity = { provider: accountIdSchema, account: accountIdSchema }
export const accountsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('accounts/list'), provider: accountIdSchema }),
  z.strictObject({
    type: z.literal('accounts/add'),
    provider: accountIdSchema,
    account: accountSchema,
  }),
  z.strictObject({ type: z.literal('accounts/remove'), ...identity }),
  z.strictObject({ type: z.literal('accounts/use'), ...identity }),
  z.strictObject({
    type: z.literal('accounts/update'),
    provider: accountIdSchema,
    account: accountSchema,
  }),
  z.strictObject({
    type: z.literal('accounts/order'),
    provider: accountIdSchema,
    accounts: z.array(accountIdSchema).check(
      z.maxLength(ACCOUNT_MAX_PER_PROVIDER),
      z.refine((ids) => new Set(ids).size === ids.length),
    ),
  }),
  z.strictObject({
    type: z.literal('accounts/thresholds'),
    ...identity,
    thresholds: accountThresholdsSchema,
  }),
  // The host supplies machine, record version and dates, never the page.
  z.strictObject({
    type: z.literal('accounts/confirm'),
    provider: accountIdSchema,
    product: accountIdSchema,
    choice: accountConfirmationChoiceSchema,
  }),
  z.strictObject({
    type: z.literal('accounts/revoke'),
    provider: accountIdSchema,
    product: accountIdSchema,
  }),
])
export type AccountsRequest = z.infer<typeof accountsRequestSchema>
