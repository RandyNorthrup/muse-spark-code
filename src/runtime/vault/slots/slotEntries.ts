import * as z from 'zod/mini'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import type { VaultSlotRecord } from '../../../shared/vault'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import { VaultError } from '../../../core/vault/crypto'
import { OsStoreVaultSlot } from './osStoreVaultSlot'
import type { PresenceRecords } from './slotIdentity'

const slotId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const slotGeneration = z.number().check(z.int(), z.nonnegative())

/** The stored identity and generation fields every slot constructor validates. */
export const slotContextSchema = z.strictObject({
  id: slotId,
  vaultId: slotId,
  lastGeneration: slotGeneration,
  auditGeneration: slotGeneration,
  auditHead: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  createdAt: slotGeneration,
})

export type SlotContext = z.infer<typeof slotContextSchema>

export type OpenOsStoreEntry = ConstructorParameters<typeof OsStoreVaultSlot>[2]

/** The stored entry fields a slot constructor takes from an existing record. */
export function slotEntryFromRecord(
  record: Pick<
    VaultSlotRecord,
    'id' | 'vaultId' | 'lastGeneration' | 'auditGeneration' | 'auditHead' | 'createdAt'
  >,
): SlotContext {
  return {
    id: record.id,
    vaultId: record.vaultId,
    lastGeneration: record.lastGeneration,
    auditGeneration: record.auditGeneration,
    auditHead: record.auditHead,
    createdAt: record.createdAt,
  }
}

/** Fresh entry fields for a slot created now. */
export function freshSlotEntry(vaultId: string, id: string): SlotContext {
  return {
    id,
    vaultId,
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
    createdAt: Date.now(),
  }
}

/** An OS-store slot opened from an existing record. */
export function openOsStoreSlot(
  record: VaultSlotRecord,
  platform: NodeJS.Platform,
  open: OpenOsStoreEntry | undefined,
  scope: string,
): OsStoreVaultSlot {
  return new OsStoreVaultSlot(slotEntryFromRecord(record), platform, open, scope)
}

/** A fresh OS-store slot created now. */
export function freshOsStoreSlot(
  vaultId: string,
  id: string,
  platform: NodeJS.Platform,
  open: OpenOsStoreEntry | undefined,
  scope: string,
): OsStoreVaultSlot {
  return new OsStoreVaultSlot(freshSlotEntry(vaultId, id), platform, open, scope)
}

/**
Guards an OS-store slot provider's construction: its own platform, and the
vault root its references scope to. Without a root no key can be named, so
construction refuses.
*/
export function checkOsStoreProviderDeps(
  deps: { readonly dataDir: string; readonly platform?: NodeJS.Platform },
  platform: NodeJS.Platform,
): void {
  if ((deps.platform ?? process.platform) !== platform) throw new VaultError('invalid')
  if (deps.dataDir === '') throw new VaultError('invalid')
}

/** An OS-store slot of this platform's provider opened from its record, else null. */
export function openPlatformOsStoreSlot(
  record: VaultSlotRecord,
  platform: NodeJS.Platform,
  provider: VaultSlotRecord['provider'],
  open: OpenOsStoreEntry | undefined,
  scope: string,
): OsStoreVaultSlot | null {
  return record.tier !== 'osStore' || record.provider !== provider
    ? null
    : openOsStoreSlot(record, platform, open, scope)
}

/**
Open the hardware slot where the helper reports it, else null. The
capability probe runs for real on every call; any failure (no device,
failing probe, refused build) reads as absent, never as an error.
*/
export async function hardwareSlotIfAvailable<Slot>(
  isPlatform: boolean,
  readFacts: () => Promise<{ hardwareAvailable: boolean }>,
  open: () => Slot,
): Promise<Slot | null> {
  if (!isPlatform) return null
  try {
    const facts = await readFacts()
    return facts.hardwareAvailable ? open() : null
  } catch {
    // Unreadable slot facts open no slot: no slot.
    return null
  }
}

/**
Prove presence through the platform's presence-tier slot: find this
platform's presence record, run one fresh unwrap over it (the helper
prompts, naming the exact use), and fail closed without it. The broker's
nonce scopes the operation; the prompt's freshness is what proves
presence.
*/
/**
The provider's presence gate bound to one platform's slot: the returned
check finds that platform's presence record and runs one fresh unwrap
over it. The helper prompts, naming the exact use; the broker's nonce
scopes the operation.
*/
export function presenceGate(
  loadRecords: () => PresenceRecords | undefined,
  provider: VaultSlotRecord['provider'],
  openSlot: (record: VaultSlotRecord) => {
    unwrap(record: VaultSlotRecord, use: string): Promise<Uint8Array>
  },
): VaultSlotProvider['presence'] {
  return async () => await isPresenceProven({ presenceRecords: loadRecords(), provider, openSlot })
}

async function isPresenceProven(options: {
  readonly presenceRecords?: PresenceRecords | undefined
  readonly provider: VaultSlotRecord['provider']
  readonly openSlot: (record: VaultSlotRecord) => {
    unwrap(record: VaultSlotRecord, use: string): Promise<Uint8Array>
  }
}): Promise<boolean> {
  try {
    const records = (await options.presenceRecords?.()) ?? []
    const record = records.find(
      (candidate) => candidate.tier === 'presence' && candidate.provider === options.provider,
    )
    if (!record) return false
    await options.openSlot(record).unwrap(record, UI_TEXT.vault.presenceWarning)
    return true
  } catch {
    return false
  }
}
