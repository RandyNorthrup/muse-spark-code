import { type VaultSlotProvider } from '../../../core/vault/broker/repository'
import { VaultError } from '../../../core/vault/crypto'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type VaultSlotRecord } from '../../../shared/vault'
import { OsStoreVaultSlot } from './osStoreVaultSlot'

/** Linux Secret Service or macOS login Keychain. Presence is explicitly denied. */
export class PosixVaultSlots implements VaultSlotProvider {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {
    if (platform !== 'linux' && platform !== 'darwin') throw new VaultError('invalid')
  }
  slotFor(record: VaultSlotRecord): OsStoreVaultSlot | null {
    const provider = this.platform === 'linux' ? 'secretService' : 'loginKeychain'
    return record.tier === 'osStore' && record.provider === provider
      ? new OsStoreVaultSlot(record, this.platform)
      : null
  }
  osStore(vaultId: string, slotId: string): OsStoreVaultSlot {
    return new OsStoreVaultSlot(
      {
        id: slotId,
        vaultId,
        lastGeneration: 0,
        auditGeneration: 0,
        auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
        createdAt: Date.now(),
      },
      this.platform,
    )
  }
  presence(): Promise<boolean> {
    // No biometry entitlement on macOS; Linux presence belongs to C-M109-2.
    return Promise.resolve(false)
  }
  onScreenLock(): () => void {
    // No screen-lock capture in this lane: callers must supply that binding before enabling it.
    throw new VaultError('invalid')
  }
}
