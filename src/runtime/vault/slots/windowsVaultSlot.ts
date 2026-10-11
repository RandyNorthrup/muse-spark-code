import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_FORMAT_VERSION,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import {
  vaultSlotRecordSchema,
  type VaultSlotPort,
  type VaultSlotRecord,
} from '../../../shared/vault'
import {
  invokeWindowsVault,
  windowsVaultContainerSchema,
  type WindowsVaultIdentity,
  type WindowsVaultTransport,
} from './windowsVaultProtocol'
import { wrapSlotKey } from './slotWrap'

/** C owns authenticated identity/generation metadata; no store dependency in P. */
interface WindowsSlotContext {
  readonly id: string
  readonly vaultId: string
  readonly lastGeneration: number
  readonly auditGeneration: number
  readonly auditHead: string
  readonly createdAt: number
}
const id = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
const generation = z.number().check(z.int(), z.nonnegative())
const contextSchema = z.strictObject({
  id,
  vaultId: id,
  lastGeneration: generation,
  auditGeneration: generation,
  auditHead: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  createdAt: generation,
})

/** Shared by VS Code, native editors and ACP; B/W inject the trusted helper. */
export class WindowsVaultSlot implements VaultSlotPort {
  private readonly context: WindowsSlotContext
  constructor(
    readonly tier: 'osStore' | 'hardware' | 'presence',
    context: WindowsSlotContext,
    private readonly transport: WindowsVaultTransport,
  ) {
    const parsed = contextSchema.safeParse(context)
    if (!parsed.success) throw new Error(UI_TEXT.vault.useChanged)
    this.context = parsed.data
  }
  private get identity(): WindowsVaultIdentity {
    return { slotId: this.context.id, vaultId: this.context.vaultId, tier: this.tier }
  }
  private get provider() {
    return this.tier === 'osStore' ? 'windowsDpapi' : 'windowsTpm'
  }
  private async requireCapability(): Promise<void> {
    if (this.tier === 'osStore') return
    const { probe } = await invokeWindowsVault(this.transport, {
      v: VAULT_FORMAT_VERSION,
      operation: 'probe',
    })
    if (probe?.rsa !== true || (this.tier === 'presence' && !probe.hello))
      throw new Error(UI_TEXT.vault.noAccess)
  }
  async wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    return await wrapSlotKey({
      key,
      checkCapability: () => this.requireCapability(),
      invoke: (owned) =>
        invokeWindowsVault(
          this.transport,
          {
            v: VAULT_FORMAT_VERSION,
            operation: 'wrap',
            identity: this.identity,
            title: UI_TEXT.vault.title,
            use: UI_TEXT.vault.presenceWarning,
          },
          owned,
        ),
      accept: (container) => JSON.stringify(container.identity) === JSON.stringify(this.identity),
      record: (wrappedKey) =>
        vaultSlotRecordSchema.parse({
          ...this.context,
          v: VAULT_FORMAT_VERSION,
          tier: this.tier,
          provider: this.provider,
          keyReference: this.context.id,
          wrappedKey,
          nonce: null,
          tag: null,
          kdf: null,
          backend: this.tier === 'osStore' ? 'dpapi' : null,
        }),
    })
  }
  async unwrap(input: VaultSlotRecord, use: string): Promise<Uint8Array> {
    try {
      const slot = vaultSlotRecordSchema.parse(input)
      if (
        slot.id !== this.context.id ||
        slot.vaultId !== this.context.vaultId ||
        slot.tier !== this.tier ||
        slot.provider !== this.provider ||
        slot.keyReference !== this.context.id ||
        slot.nonce !== null ||
        slot.tag !== null ||
        slot.kdf !== null ||
        slot.backend !== (this.tier === 'osStore' ? 'dpapi' : null) ||
        slot.wrappedKey.length > VAULT_LIMITS.text
      )
        throw new Error(UI_TEXT.vault.useChanged)
      const encoded = Buffer.from(slot.wrappedKey, 'base64')
      if (encoded.toString('base64') !== slot.wrappedKey) throw new Error(UI_TEXT.vault.useChanged)
      const raw: unknown = JSON.parse(encoded.toString('utf8'))
      const container = windowsVaultContainerSchema.parse(raw)
      if (JSON.stringify(container.identity) !== JSON.stringify(this.identity))
        throw new Error(UI_TEXT.vault.useChanged)
      await this.requireCapability()
      const result = await invokeWindowsVault(this.transport, {
        v: VAULT_FORMAT_VERSION,
        operation: 'unwrap',
        identity: this.identity,
        container,
        title: UI_TEXT.vault.title,
        use,
        challenge: randomBytes(VAULT_KEY_BYTES).toString('base64'),
      })
      return result.key
    } catch {
      throw new Error(UI_TEXT.vault.noAccess)
    }
  }
  /** Deletes only this adapter's own persisted keys; DPAPI has no store entry. */
  async remove(): Promise<void> {
    await invokeWindowsVault(this.transport, {
      v: VAULT_FORMAT_VERSION,
      operation: 'delete',
      identity: this.identity,
    })
  }
}

export async function windowsVaultProtectionFacts(transport: WindowsVaultTransport) {
  const { probe } = await invokeWindowsVault(transport, {
    v: VAULT_FORMAT_VERSION,
    operation: 'probe',
  })
  return {
    hardwareAvailable: probe?.rsa === true,
    eccAvailable: probe?.ecc === true,
    helloAvailable: probe?.hello === true,
    presenceAvailable: probe?.rsa === true && probe.hello,
    osStoreAvailable: probe?.dpapi === true,
    osStoreWarning: UI_TEXT.vault.osStoreWarning,
    hardwareWarning: UI_TEXT.vault.hardwareWarning,
    presenceWarning: UI_TEXT.vault.presenceTierWarning,
  }
}

/** B locks on this notification, and aborts the wait at broker shutdown. */
export async function windowsVaultScreenLock(transport: WindowsVaultTransport): Promise<void> {
  await invokeWindowsVault(transport, { v: VAULT_FORMAT_VERSION, operation: 'screenLock' })
}
