import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { VaultError } from '../../../core/vault/crypto'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import type { VaultSlotRecord, VaultUse } from '../../../shared/vault'
import { type vaultPrivateReadSchema } from '../../../shared/vaultProtocol'
import { WindowsVaultSlot, windowsVaultScreenLock } from './windowsVaultSlot'
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
    if (
      (record.tier === 'osStore' && record.provider === 'windowsDpapi') ||
      ((record.tier === 'hardware' || record.tier === 'presence') &&
        record.provider === 'windowsTpm')
    )
      return new WindowsVaultSlot(
        record.tier,
        {
          id: record.id,
          vaultId: record.vaultId,
          lastGeneration: record.lastGeneration,
          auditGeneration: record.auditGeneration,
          auditHead: record.auditHead,
          createdAt: record.createdAt,
        },
        this.transport,
      )
    return null
  }
  osStore(vaultId: string, slotId: string): WindowsVaultSlot {
    return new WindowsVaultSlot(
      'osStore',
      {
        id: slotId,
        vaultId,
        lastGeneration: 0,
        auditGeneration: 0,
        auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
        createdAt: Date.now(),
      },
      this.transport,
    )
  }
  /**
   * A fresh Windows Hello signature over a new challenge: the helper prompts
   * (naming this exact use) and the signature is verified against the
   * presence slot's key before the operation proceeds.
   */
  async presence(
    _itemId: string,
    _challenge: string,
    _use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): Promise<boolean> {
    try {
      const records = (await this.deps.presenceRecords?.()) ?? []
      const record = records.find(
        (candidate) => candidate.tier === 'presence' && candidate.provider === 'windowsTpm',
      )
      if (!record) return false
      const slot = new WindowsVaultSlot(
        'presence',
        {
          id: record.id,
          vaultId: record.vaultId,
          lastGeneration: record.lastGeneration,
          auditGeneration: record.auditGeneration,
          auditHead: record.auditHead,
          createdAt: record.createdAt,
        },
        this.transport,
      )
      await slot.unwrap(record, UI_TEXT.vault.presenceWarning)
      return true
    } catch {
      return false
    }
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
