// M104 binds these value-free messages to its authenticated host bridge.
import * as z from 'zod/mini'
import { VAULT_LIMITS } from '../constants'
import { vaultApprovalAnswerSchema, vaultGrantSchema } from '../vault'
import { vaultPanelStateSchema } from '../vaultPanel'

export const vaultHostMessageSchema = z.strictObject({
  type: z.literal('vaultState'),
  state: vaultPanelStateSchema,
})
export const vaultClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('vaultReady') }),
  // RVCM1091F: the person's own Retry after a transient failure spent the
  // bounded auto-retries. It reloads with a restored budget.
  z.strictObject({ type: z.literal('vaultRetry') }),
  z.strictObject({ type: z.literal('vaultLock') }),
  z.strictObject({ type: z.literal('vaultUnlock') }),
  // Set Up Vault: the host generates and shows the one-time recovery code natively.
  z.strictObject({ type: z.literal('vaultSetup') }),
  // Reset Vault: offered only for a lost vault; the host asks twice natively.
  z.strictObject({ type: z.literal('vaultReset') }),
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
  // A kept or orphaned receipt's two real actions: finish the delete, or
  // keep the file (RVAPP-CM1091D5 P2-2).
  z.strictObject({
    type: z.literal('vaultKeepReceipt'),
    receipt: z.string().check(z.regex(/^[a-f0-9-]{36}$/u)),
  }),
  z.strictObject({
    type: z.literal('vaultDeleteReceipt'),
    receipt: z.string().check(z.regex(/^[a-f0-9-]{36}$/u)),
  }),
  z.strictObject({
    type: z.literal('vaultPublicKey'),
    itemId: z.string().check(z.regex(/^[a-f0-9]{32}$/u)),
  }),
  // D217: undo one retired migration slot, restoring its value as current.
  z.strictObject({
    type: z.literal('vaultUndoRetired'),
    key: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  }),
])
/** What the vault section posts to the host (C-M109-1 P1 mount). */
export type VaultClientMessage = z.infer<typeof vaultClientMessageSchema>
/** What the host publishes to the vault section. */
export type VaultHostMessage = z.infer<typeof vaultHostMessageSchema>
