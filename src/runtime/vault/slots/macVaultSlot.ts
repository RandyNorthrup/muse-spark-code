import * as z from 'zod/mini'
import { UI_TEXT, VAULT_FORMAT_VERSION, VAULT_LIMITS } from '../../../shared/constants'
import {
  vaultSlotRecordSchema,
  type VaultSlotPort,
  type VaultSlotRecord,
} from '../../../shared/vault'
import {
  invokeMacVault,
  macVaultContainerSchema,
  type MacVaultContainer,
  type MacVaultIdentity,
  type MacVaultTransport,
} from './macVaultProtocol'
import { wrapSlotKey } from './slotWrap'

/** C supplies authenticated slot identity and generation metadata; P owns wrapping only. */
interface MacSlotContext {
  readonly id: string
  readonly vaultId: string
  readonly lastGeneration: number
  readonly auditGeneration: number
  readonly auditHead: string
  readonly createdAt: number
}

const slotId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const generation = z.number().check(z.int(), z.nonnegative())
const contextSchema = z.strictObject({
  id: slotId,
  vaultId: slotId,
  lastGeneration: generation,
  auditGeneration: generation,
  auditHead: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  createdAt: generation,
})

function hasSameIdentity(container: MacVaultContainer, identity: MacVaultIdentity): boolean {
  return (
    container.identity.slotId === identity.slotId &&
    container.identity.vaultId === identity.vaultId &&
    container.identity.tier === identity.tier
  )
}

/** Shared by every editor: inject the trusted packaged helper transport at binding. */
export class MacVaultSlot implements VaultSlotPort {
  private readonly context: MacSlotContext
  constructor(
    readonly tier: 'osStore' | 'hardware' | 'presence',
    context: MacSlotContext,
    private readonly transport: MacVaultTransport,
  ) {
    const parsed = contextSchema.safeParse(context)
    if (!parsed.success) throw new Error(UI_TEXT.vault.useChanged)
    this.context = parsed.data
  }

  private get identity(): MacVaultIdentity {
    return { slotId: this.context.id, vaultId: this.context.vaultId, tier: this.tier }
  }

  private record(wrappedKey: string): VaultSlotRecord {
    return vaultSlotRecordSchema.parse({
      ...this.context,
      v: VAULT_FORMAT_VERSION,
      tier: this.tier,
      provider: this.tier === 'osStore' ? 'loginKeychain' : 'secureEnclave',
      keyReference: this.context.id,
      wrappedKey,
      nonce: null,
      tag: null,
      kdf: null,
      backend: null,
    })
  }

  private async requireCapability(): Promise<void> {
    if (this.tier === 'osStore') return
    const { probe } = await invokeMacVault(this.transport, {
      v: VAULT_FORMAT_VERSION,
      operation: 'probe',
    })
    if (probe?.secureEnclave !== true || !probe.certified)
      throw new Error(UI_TEXT.vault.seUnavailable)
  }

  async wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    return await wrapSlotKey({
      key,
      checkCapability: () => this.requireCapability(),
      invoke: (owned) =>
        invokeMacVault(
          this.transport,
          {
            v: VAULT_FORMAT_VERSION,
            operation: 'wrap',
            identity: this.identity,
          },
          owned,
        ),
      accept: (container) => hasSameIdentity(container, this.identity),
      record: (raw) => this.record(raw),
    })
  }

  async unwrap(input: VaultSlotRecord, use: string): Promise<Uint8Array> {
    const slot = vaultSlotRecordSchema.parse(input)
    if (
      slot.id !== this.context.id ||
      slot.vaultId !== this.context.vaultId ||
      slot.tier !== this.tier ||
      slot.provider !== (this.tier === 'osStore' ? 'loginKeychain' : 'secureEnclave') ||
      slot.keyReference !== this.context.id ||
      slot.nonce !== null ||
      slot.tag !== null ||
      slot.backend !== null ||
      slot.wrappedKey.length > VAULT_LIMITS.text
    ) {
      throw new Error(UI_TEXT.vault.useChanged)
    }
    const encoded = Buffer.from(slot.wrappedKey, 'base64')
    if (encoded.toString('base64') !== slot.wrappedKey) throw new Error(UI_TEXT.vault.useChanged)
    const raw: unknown = JSON.parse(encoded.toString('utf8'))
    const container = macVaultContainerSchema.parse(raw)
    if (!hasSameIdentity(container, this.identity)) throw new Error(UI_TEXT.vault.useChanged)
    await this.requireCapability()
    const result = await invokeMacVault(this.transport, {
      v: VAULT_FORMAT_VERSION,
      operation: 'unwrap',
      identity: this.identity,
      container,
      use,
    })
    return result.key
  }

  /** Roll back a failed slot creation, or remove a retired login-Keychain slot. */
  async remove(): Promise<void> {
    if (this.tier !== 'osStore') return // SE blobs disappear with C's slot record.
    await invokeMacVault(this.transport, {
      v: VAULT_FORMAT_VERSION,
      operation: 'delete',
      identity: this.identity,
    })
  }
}

/** Banner facts are public and translated at use time; no hardware claim without certification. */
export async function macVaultProtectionFacts(transport: MacVaultTransport) {
  const { probe } = await invokeMacVault(transport, { v: VAULT_FORMAT_VERSION, operation: 'probe' })
  const isAvailable = probe?.secureEnclave === true && probe.certified
  return {
    secureEnclaveAvailable: probe?.secureEnclave === true,
    secureEnclaveCertified: probe?.certified === true,
    hardwareAvailable: isAvailable,
    presenceAvailable: isAvailable,
    osStoreWarning: UI_TEXT.vault.osStoreWarning,
    hardwareWarning: isAvailable ? UI_TEXT.vault.hardwareWarning : UI_TEXT.vault.seUnavailable,
    presenceWarning: isAvailable ? UI_TEXT.vault.presenceTierWarning : UI_TEXT.vault.seUnavailable,
  }
}
