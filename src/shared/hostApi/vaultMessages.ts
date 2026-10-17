// M104 binds these value-free messages to its authenticated host bridge.
import * as z from 'zod/mini'
import { vaultApprovalAnswerSchema, vaultGrantSchema } from '../vault'
import { vaultPanelStateSchema } from '../vaultPanel'

export const vaultHostMessageSchema = z.strictObject({
  type: z.literal('vaultState'),
  state: vaultPanelStateSchema,
})
export const vaultClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('vaultReady') }),
  z.strictObject({ type: z.literal('vaultLock') }),
  z.strictObject({ type: z.literal('vaultUnlock') }),
  z.strictObject({ type: z.literal('vaultAnswer'), answer: vaultApprovalAnswerSchema }),
  z.strictObject({ type: z.literal('vaultGrant'), grant: vaultGrantSchema }),
  z.strictObject({
    type: z.literal('vaultRevoke'),
    grantId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  }),
  // Add/edit opens the host's password box or a terminal. A value never crosses this surface.
  z.strictObject({ type: z.literal('vaultAdd') }),
  z.strictObject({
    type: z.literal('vaultEdit'),
    itemId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  }),
  z.strictObject({
    type: z.literal('vaultRemove'),
    itemId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  }),
  z.strictObject({ type: z.literal('vaultImport'), path: z.string() }),
  z.strictObject({
    type: z.literal('vaultPublicKey'),
    itemId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  }),
])
