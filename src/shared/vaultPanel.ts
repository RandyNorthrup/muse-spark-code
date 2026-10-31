import * as z from 'zod/mini'
// M109's isolated vault slice. M95/U bind this to Models & Agents on integration.
import { VAULT_LIMITS } from './constants'
import {
  vaultApprovalRequestSchema,
  vaultAuditRecordSchema,
  vaultGrantSchema,
  vaultItemMetadataSchema,
} from './vault'
import { vaultStatusSchema, vaultBrokerEventSchema } from './vaultStatus'

/** B supplies its validated events; C/M metadata changes use the project-owned notification. */
export const vaultPanelChangeSchema = z.union([
  vaultBrokerEventSchema,
  z.strictObject({ kind: z.literal('changed') }),
])

/** D241: one retired migration slot, value-free: its legacy key and its vault row's label. */
export const vaultRetiredEntrySchema = z.strictObject({
  key: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
  label: z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text)),
})
export type VaultRetiredEntry = z.infer<typeof vaultRetiredEntrySchema>

export const vaultPanelStateSchema = z.strictObject({
  status: vaultStatusSchema,
  // RVCM1091G P3: true while the host keeps this view with a bounded retry
  // scheduled or in flight. The section shows retry text with aria-busy, so
  // a kept view never poses as a fresh one.
  retrying: z.optional(z.boolean()),
  // P/X supply observed platform/fence facts, never values or diagnostic exception text.
  notices: z.optional(
    z
      .array(z.enum(['nopasswd', 'fenceOff', 'seUnavailable']))
      .check(z.maxLength(VAULT_LIMITS.reasons)),
  ),
  items: z.array(vaultItemMetadataSchema).check(z.maxLength(VAULT_LIMITS.items)),
  // D241: retired migration slots, each with its own Undo. Absent on
  // stripped frames and where no migration binds; locked frames list none.
  retired: z.optional(z.array(vaultRetiredEntrySchema).check(z.maxLength(VAULT_LIMITS.items))),
  grants: z.array(vaultGrantSchema).check(z.maxLength(VAULT_LIMITS.grants)),
  audit: z.array(vaultAuditRecordSchema).check(z.maxLength(VAULT_LIMITS.items)),
  pending: z.array(vaultApprovalRequestSchema).check(z.maxLength(VAULT_LIMITS.items)),
  // The finish sweep, passed through from the broker snapshot: kept or
  // orphaned receipts whose source or secret still exists. Absent on
  // stripped frames (locked, unavailable), which list nothing by name. Kept
  // inline (not imported from vaultProtocol) so the webview bundle does not
  // carry the broker's protocol; the sweep test parses a real snapshot
  // through both shapes, so drift fails there.
  pendingReceipts: z.optional(
    z
      .array(
        z.strictObject({
          receipt: z.string().check(z.regex(/^[a-f0-9-]{36}$/u)),
          path: z.string().check(z.maxLength(VAULT_LIMITS.text)),
          items: z.array(vaultItemMetadataSchema).check(z.maxLength(VAULT_LIMITS.items)),
        }),
      )
      .check(z.maxLength(VAULT_LIMITS.items)),
  ),
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
