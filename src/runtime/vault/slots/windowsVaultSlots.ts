import {
  freshSlotEntry,
  hardwareSlotIfAvailable,
  presenceGate,
  slotEntryFromRecord,
} from './slotEntries'
import { VaultError } from '../../../core/vault/crypto'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import type { VaultSlotRecord } from '../../../shared/vault'
import {
  WindowsVaultSlot,
  windowsVaultProtectionFacts,
  windowsVaultScreenLock,
} from './windowsVaultSlot'
import type { WindowsVaultExecutable } from './windowsVaultTransport'
import { windowsVaultTransport } from './windowsVaultTransport'
import type { PresenceRecords } from './slotIdentity'

/**
 * Windows slots: DPAPI for the current user (the OS store), a non-exportable
 * RSA-2048 decrypt key on the TPM through CNG's Platform Crypto Provider for
 * hardware, and the same key with a fresh Windows Hello signature over the
 * broker's challenge as the presence gate. Every tier runs through the
 * trusted helper executable the host builds and hands to the broker.
 */
export class WindowsVaultSlots implements VaultSlotProvider {
  private readonly transport: ReturnType<typeof windowsVaultTransport>
  /**
   * A fresh Windows Hello signature over a new challenge: the helper prompts
   * (naming this exact use) and the signature is verified against the
   * presence slot's key before the operation proceeds.
   */
  readonly presence: VaultSlotProvider['presence'] = presenceGate(
    () => this.deps.presenceRecords,
    'windowsTpm',
    (record) => new WindowsVaultSlot('presence', slotEntryFromRecord(record), this.transport),
  )
  constructor(
    private readonly helper: WindowsVaultExecutable,
    private readonly deps: {
      readonly presenceRecords?: PresenceRecords
      readonly platform?: NodeJS.Platform
    } = {},
  ) {
    if ((deps.platform ?? process.platform) !== 'win32') throw new VaultError('invalid')
    // Slot exchanges carry their own approval TTL; only the screen-lock wait below is cancellable.
    this.transport = windowsVaultTransport(helper)
  }
  slotFor(record: VaultSlotRecord): WindowsVaultSlot | null {
    return (record.tier === 'osStore' && record.provider === 'windowsDpapi') ||
      ((record.tier === 'hardware' || record.tier === 'presence') &&
        record.provider === 'windowsTpm')
      ? new WindowsVaultSlot(record.tier, slotEntryFromRecord(record), this.transport)
      : null
  }
  osStore(vaultId: string, slotId: string): WindowsVaultSlot {
    return new WindowsVaultSlot('osStore', freshSlotEntry(vaultId, slotId), this.transport)
  }
  /** The CNG TPM slot where the helper reports it, else null. */
  async hardwareIfAvailable(vaultId: string, slotId: string): Promise<WindowsVaultSlot | null> {
    return await hardwareSlotIfAvailable(
      (this.deps.platform ?? process.platform) === 'win32',
      () => windowsVaultProtectionFacts(this.transport),
      () => new WindowsVaultSlot('hardware', freshSlotEntry(vaultId, slotId), this.transport),
    )
  }
  onScreenLock(listener: () => void): () => void {
    // Abort during the wait rejects the exchange (return above); after it
    // resolves the lines below run synchronously, so no check can interleave.
    // One wait per lock: the helper returns after each lock, then waits again.
    const controller = new AbortController()
    let isActive = true
    const wait = async (): Promise<void> => {
      for (;;) {
        try {
          await windowsVaultScreenLock(windowsVaultTransport(this.helper, controller.signal))
        } catch {
          // Disposal aborts the wait and a broken wait ends it; either way the watch stops.
          return
        }
        if (!isActive) return
        listener()
      }
    }
    void wait()
    return () => {
      isActive = false
      controller.abort()
    }
  }
}
