import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { VaultError } from '../../../core/vault/crypto'
import type { VaultSlotProvider } from '../../../core/vault/broker/repository'
import type { VaultSlotRecord, VaultUse } from '../../../shared/vault'
import { type vaultPrivateReadSchema } from '../../../shared/vaultProtocol'
import { OsStoreVaultSlot } from './osStoreVaultSlot'
import { MacVaultSlot, macVaultProtectionFacts } from './macVaultSlot'
import type { MacVaultTransport } from './macVaultProtocol'
import {
  freshSlotContext,
  isPresenceUnwrapped,
  slotContextFromRecord,
  type PresenceRecords,
} from './slotIdentity'

type OpenEntry = ConstructorParameters<typeof OsStoreVaultSlot>[2]

/**
 * macOS slots: the login Keychain for the OS store (as D61 and VS Code use
 * today) and the Secure Enclave where `SecureEnclave.isAvailable` (Touch ID
 * or Apple silicon), after Q-M109's capture. Presence is a fresh Secure
 * Enclave `userPresence` unwrap — Touch ID or the password at each unwrap,
 * with a new context and process per use — so every presence call prompts.
 */
export class MacVaultSlots implements VaultSlotProvider {
  constructor(
    private readonly transport: MacVaultTransport,
    private readonly deps: {
      readonly open?: OpenEntry
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
      return new OsStoreVaultSlot(slotContextFromRecord(record), this.platform, this.deps.open)
    return (record.tier === 'hardware' || record.tier === 'presence') &&
      record.provider === 'secureEnclave'
      ? new MacVaultSlot(record.tier, slotContextFromRecord(record), this.transport)
      : null
  }
  osStore(vaultId: string, slotId: string): OsStoreVaultSlot {
    return new OsStoreVaultSlot(freshSlotContext(vaultId, slotId), this.platform, this.deps.open)
  }
  /** The Secure Enclave slot where the helper reports it, else null. */
  async hardwareIfAvailable(vaultId: string, slotId: string): Promise<MacVaultSlot | null> {
    if (this.platform !== 'darwin') return null
    try {
      const facts = await macVaultProtectionFacts(this.transport)
      if (!facts.hardwareAvailable) return null
      return new MacVaultSlot(
        'hardware',
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
    } catch {
      return null
    }
  }
  /**
   * A fresh Secure Enclave presence unwrap: the helper prompts (Touch ID or
   * password, naming this exact use) and the operation fails closed without
   * it. The broker's nonce scopes the operation; the prompt's freshness is
   * what proves presence.
   */
  async presence(
    _itemId: string,
    _challenge: string,
    _use: VaultUse | ReturnType<typeof vaultPrivateReadSchema.parse>,
  ): Promise<boolean> {
    return await isPresenceUnwrapped(this.deps.presenceRecords, 'secureEnclave', async (record) => {
      const slot = new MacVaultSlot('presence', slotContextFromRecord(record), this.transport)
      await slot.unwrap(record, UI_TEXT.vault.presenceWarning)
    })
  }
  onScreenLock(): () => void {
    // No screen-lock capture in this lane: callers must supply that binding before enabling it.
    throw new VaultError('invalid')
  }
}
