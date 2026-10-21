import { VaultError } from '../../../core/vault/crypto'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import type { VaultSlotRecord } from '../../../shared/vault'
import { type OsStoreVaultSlot } from './osStoreVaultSlot'
import { MacVaultSlot, macVaultProtectionFacts } from './macVaultSlot'
import type { MacVaultTransport } from './macVaultProtocol'
import type { PresenceRecords } from './slotIdentity'
import {
  freshOsStoreSlot,
  freshSlotEntry,
  hardwareSlotIfAvailable,
  openOsStoreSlot,
  presenceGate,
  slotEntryFromRecord,
  type OpenOsStoreEntry,
} from './slotEntries'

/**
macOS slots: the login Keychain for the OS store (as D61 and VS Code use
today) and the Secure Enclave where `SecureEnclave.isAvailable` (Touch ID
or Apple silicon), after Q-M109's capture. Presence is a fresh Secure
Enclave `userPresence` unwrap — Touch ID or the password at each unwrap,
with a new context and process per use — so every presence call prompts.
*/
export class MacVaultSlots implements VaultSlotProvider {
  /**
  A fresh Secure Enclave presence unwrap: the helper prompts (Touch ID or
  password, naming this exact use) and the operation fails closed without
  it. The broker's nonce scopes the operation; the prompt's freshness is
  what proves presence.
  */
  readonly presence: VaultSlotProvider['presence'] = presenceGate(
    () => this.deps.presenceRecords,
    'secureEnclave',
    (record) => new MacVaultSlot('presence', slotEntryFromRecord(record), this.transport),
  )
  constructor(
    private readonly transport: MacVaultTransport,
    private readonly deps: {
      readonly open?: OpenOsStoreEntry
      readonly presenceRecords?: PresenceRecords
      readonly platform?: NodeJS.Platform
    } = {},
  ) {
    if ((deps.platform ?? process.platform) !== 'darwin') throw new VaultError('invalid')
  }
  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
  }
  slotFor(record: VaultSlotRecord): OsStoreVaultSlot | MacVaultSlot | null {
    if (record.tier === 'osStore' && record.provider === 'loginKeychain')
      return openOsStoreSlot(record, this.platform, this.deps.open)
    return (record.tier === 'hardware' || record.tier === 'presence') &&
      record.provider === 'secureEnclave'
      ? new MacVaultSlot(record.tier, slotEntryFromRecord(record), this.transport)
      : null
  }
  osStore(vaultId: string, slotId: string): OsStoreVaultSlot {
    return freshOsStoreSlot(vaultId, slotId, this.platform, this.deps.open)
  }
  /** The Secure Enclave slot where the helper reports it, else null. */
  async hardwareIfAvailable(vaultId: string, slotId: string): Promise<MacVaultSlot | null> {
    return await hardwareSlotIfAvailable(
      this.platform === 'darwin',
      () => macVaultProtectionFacts(this.transport),
      () => new MacVaultSlot('hardware', freshSlotEntry(vaultId, slotId), this.transport),
    )
  }
  onScreenLock(): () => void {
    // No screen-lock capture in this lane: callers must supply that binding before enabling it.
    throw new VaultError('invalid')
  }
}
