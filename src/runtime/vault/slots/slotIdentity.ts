import * as z from 'zod/mini'
import type { VaultSlotRecord } from '../../../shared/vault'
import { VAULT_LIMITS } from '../../../shared/constants'

// The slot's authenticated identity, shared by every platform slot (C
// supplies it; P binds the wrap/unwrap to it). One schema, so macOS and
// Windows cannot drift on what an identity is.

const slotId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))

export const slotIdentitySchema = z.strictObject({
  slotId,
  vaultId: slotId,
  tier: z.enum(['osStore', 'hardware', 'presence']),
})
export type SlotIdentity = z.infer<typeof slotIdentitySchema>

const generation = z.number().check(z.int(), z.nonnegative())

/** Generation metadata every platform slot carries and validates the same way. */
export const slotContextSchema = z.strictObject({
  id: slotId,
  vaultId: slotId,
  lastGeneration: generation,
  auditGeneration: generation,
  auditHead: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  createdAt: generation,
})
export type SlotContext = z.infer<typeof slotContextSchema>

/** A stored record's generation metadata as a slot context. */
export function slotContextFromRecord(record: VaultSlotRecord): SlotContext {
  return {
    id: record.id,
    vaultId: record.vaultId,
    lastGeneration: record.lastGeneration,
    auditGeneration: record.auditGeneration,
    auditHead: record.auditHead,
    createdAt: record.createdAt,
  }
}

/** A fresh slot context for a new vault item. */
export function freshSlotContext(vaultId: string, slotId: string): SlotContext {
  return {
    id: slotId,
    vaultId,
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
    createdAt: Date.now(),
  }
}

/** This vault's stored slot records, for a provider's fresh presence proof. */
export type PresenceRecords = () => Promise<readonly VaultSlotRecord[]>

/**
 * A fresh presence unwrap through the platform slot: the helper prompts
 * (naming the exact use) and the operation fails closed without it.
 */
export async function isPresenceUnwrapped(
  presenceRecords: PresenceRecords | undefined,
  provider: string,
  open: (record: VaultSlotRecord) => Promise<unknown>,
): Promise<boolean> {
  try {
    const records = (await presenceRecords?.()) ?? []
    const record = records.find(
      (candidate) => candidate.tier === 'presence' && candidate.provider === provider,
    )
    if (!record) return false
    await open(record)
    return true
  } catch {
    return false
  }
}
