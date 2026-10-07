// M109's isolated vault slice. M95/U bind this to Models & Agents on integration.
import * as z from 'zod/mini'
import { VAULT_LIMITS } from './constants'
import {
  vaultApprovalRequestSchema,
  vaultAuditRecordSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
} from './vault'
import { vaultStatusSchema, vaultBrokerEventSchema } from './vaultProtocol'

/** B supplies its validated events; C/M metadata changes use the project-owned notification. */
export const vaultPanelChangeSchema = z.union([
  vaultBrokerEventSchema,
  z.strictObject({ kind: z.literal('changed') }),
])

export const vaultPanelStateSchema = z.strictObject({
  status: vaultStatusSchema,
  // P/X supply observed platform/fence facts, never values or diagnostic exception text.
  notices: z.optional(
    z
      .array(z.enum(['nopasswd', 'fenceOff', 'seUnavailable']))
      .check(z.maxLength(VAULT_LIMITS.reasons)),
  ),
  items: z.array(vaultItemMetadataSchema).check(z.maxLength(VAULT_LIMITS.items)),
  grants: z.array(vaultGrantSchema).check(z.maxLength(VAULT_LIMITS.grants)),
  audit: z.array(vaultAuditRecordSchema).check(z.maxLength(VAULT_LIMITS.items)),
  pending: z.array(vaultApprovalRequestSchema).check(z.maxLength(VAULT_LIMITS.items)),
  ambientFiles: z
    .array(
      z.strictObject({
        path: z.string().check(z.maxLength(VAULT_LIMITS.text)),
        kind: z.enum(['ssh', 'git', 'netrc', 'npm', 'aws', 'docker', 'csv']),
      }),
    )
    .check(z.maxLength(VAULT_LIMITS.items)),
})
export type VaultPanelState = z.infer<typeof vaultPanelStateSchema>
