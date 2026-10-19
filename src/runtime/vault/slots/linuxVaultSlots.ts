import { VaultError } from '../../../core/vault/crypto'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import type { VaultSlotRecord } from '../../../shared/vault'
import { type OsStoreVaultSlot } from './osStoreVaultSlot'
import { LinuxTpm2Slot, linuxTpm2Capabilities, type LinuxTpm2Runner } from './linuxTpm2Slot'
import {
  freshOsStoreSlot,
  freshSlotEntry,
  openOsStoreSlot,
  slotEntryFromRecord,
  type OpenOsStoreEntry,
} from './slotEntries'

/**
 * Linux slots: the Secret Service for the OS store (D89: labelled as
 * protecting data at rest only) and the TPM2 sealed object where the machine
 * has one. Presence has no platform prompter on Linux — a sealed object
 * unseals silently — so it stays refused after a real capability probe: the
 * person's presence mechanism on Linux is the vault passphrase, prompted per
 * use by the host (a later lane owns that round-trip).
 */
export class LinuxVaultSlots implements VaultSlotProvider {
  constructor(
    private readonly deps: {
      readonly runner?: LinuxTpm2Runner
      readonly open?: OpenOsStoreEntry
      readonly platform?: NodeJS.Platform
    } = {},
  ) {
    if ((deps.platform ?? process.platform) !== 'linux') throw new VaultError('invalid')
  }
  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
  }
  slotFor(record: VaultSlotRecord): OsStoreVaultSlot | LinuxTpm2Slot | null {
    if (record.tier === 'osStore' && record.provider === 'secretService')
      return openOsStoreSlot(record, this.platform, this.deps.open)
    return record.tier === 'hardware' && record.provider === 'linuxTpm2'
      ? new LinuxTpm2Slot(slotEntryFromRecord(record), this.deps.runner, this.platform)
      : null
  }
  osStore(vaultId: string, slotId: string): OsStoreVaultSlot {
    return freshOsStoreSlot(vaultId, slotId, this.platform, this.deps.open)
  }
  hardware(vaultId: string, slotId: string): LinuxTpm2Slot {
    return new LinuxTpm2Slot(freshSlotEntry(vaultId, slotId), this.deps.runner, this.platform)
  }
  /** The TPM2 slot where the device opens and systemd seals, else null. */
  async hardwareIfAvailable(vaultId: string, slotId: string): Promise<LinuxTpm2Slot | null> {
    if (this.platform !== 'linux') return null
    try {
      const capabilities = await linuxTpm2Capabilities(this.deps.runner)
      return capabilities.canSeal ? this.hardware(vaultId, slotId) : null
    } catch {
      return null
    }
  }
  /** Refused after a real probe: nothing on Linux can prompt per-use presence. */
  async presence(): Promise<boolean> {
    try {
      await linuxTpm2Capabilities(this.deps.runner)
    } catch {
      /* The probe's outcome never changes the refusal. */
    }
    return false
  }
  onScreenLock(): () => void {
    // No screen-lock capture in this lane: callers must supply that binding before enabling it.
    throw new VaultError('invalid')
  }
}
