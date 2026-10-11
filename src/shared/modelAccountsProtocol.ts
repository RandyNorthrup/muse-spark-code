// Models panel's account transport. Passwords remain in the native host prompt.
import * as z from 'zod/mini'
import { accountsRequestSchema, accountsReplySchema } from './hostApi/accounts'
import { modelsAccountsSliceSchema } from './accountsPanel'

const requestId = z.int().check(z.positive())
export const modelAccountsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('modelAccounts/ready') }),
  z.strictObject({
    type: z.literal('modelAccounts/request'),
    requestId,
    request: accountsRequestSchema,
  }),
])
export const modelAccountsMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('modelAccounts/available') }),
  z.strictObject({
    type: z.literal('modelAccounts/reply'),
    requestId,
    value: z.union([modelsAccountsSliceSchema, accountsReplySchema]),
  }),
])
export type ModelAccountsRequest = z.infer<typeof modelAccountsRequestSchema>
