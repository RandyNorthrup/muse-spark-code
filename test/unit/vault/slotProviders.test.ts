import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { VaultError } from '../../../src/core/vault/crypto'
import { VaultStoreUnavailableError } from '../../../src/core/vault/broker/ports'
import {
  vaultSlotRecordSchema,
  type VaultSlotRecord,
  type VaultUse,
} from '../../../src/shared/vault'
import { defaultBrokerSlots } from '../../../src/runtime/vault/vaultBrokerEntry'
import { LinuxVaultSlots } from '../../../src/runtime/vault/slots/linuxVaultSlots'
import { MacVaultSlots } from '../../../src/runtime/vault/slots/macVaultSlots'
import { WindowsVaultSlots } from '../../../src/runtime/vault/slots/windowsVaultSlots'
import {
  LinuxTpm2Slot,
  linuxTpm2Capabilities,
} from '../../../src/runtime/vault/slots/linuxTpm2Slot'
import { MacVaultSlot } from '../../../src/runtime/vault/slots/macVaultSlot'
import { OsStoreVaultSlot } from '../../../src/runtime/vault/slots/osStoreVaultSlot'
import { VAULT_FORMAT_VERSION } from '../../../src/shared/constants'

function ids() {
  return { vaultId: randomBytes(16).toString('hex'), slotId: randomBytes(16).toString('hex') }
}

function baseRecord(vaultId: string, slotId: string) {
  return {
    v: VAULT_FORMAT_VERSION,
    id: slotId,
    vaultId,
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(64),
    createdAt: 0,
  }
}

function osStoreRecord(vaultId: string, slotId: string): VaultSlotRecord {
  const reference = `vault.${vaultId}.${slotId}`
  return vaultSlotRecordSchema.parse({
    ...baseRecord(vaultId, slotId),
    tier: 'osStore',
    provider: 'secretService',
    keyReference: reference,
    wrappedKey: Buffer.from(reference, 'ascii').toString('base64'),
    nonce: null,
    tag: null,
    kdf: null,
    backend: null,
  })
}

function sealedRecord(vaultId: string, slotId: string): VaultSlotRecord {
  return vaultSlotRecordSchema.parse({
    ...baseRecord(vaultId, slotId),
    tier: 'hardware',
    provider: 'linuxTpm2',
    keyReference: slotId,
    wrappedKey: Buffer.from(
      JSON.stringify({
        v: VAULT_FORMAT_VERSION,
        slotId,
        vaultId,
        tool: 'systemd-creds',
        sealed: Buffer.from('sealed-blob').toString('base64'),
      }),
      'utf8',
    ).toString('base64'),
    nonce: null,
    tag: null,
    kdf: null,
    backend: null,
  })
}

describe('platform slot providers', () => {
  it('the broker entry selects Secret Service plus TPM2 on Linux', () => {
    const slots = defaultBrokerSlots({ installRoot: '/opt/test' }, () => Promise.resolve([]))
    expect(slots).toBeInstanceOf(LinuxVaultSlots)
  })

  it('Linux resolves the OS-store and TPM2 records, nothing else', () => {
    const { vaultId, slotId } = ids()
    const slots = new LinuxVaultSlots()
    const osStore = slots.slotFor(osStoreRecord(vaultId, slotId))
    expect(osStore).toBeInstanceOf(OsStoreVaultSlot)
    const sealed = slots.slotFor(sealedRecord(vaultId, slotId))
    expect(sealed).toBeInstanceOf(LinuxTpm2Slot)
    expect(
      slots.slotFor({ ...sealedRecord(vaultId, slotId), tier: 'presence', provider: 'linuxTpm2' }),
    ).toBeNull()
    expect(
      slots.slotFor({ ...osStoreRecord(vaultId, slotId), provider: 'loginKeychain' }),
    ).toBeNull()
  })

  it('Linux presence stays refused after a real capability probe', async () => {
    const capabilities = await linuxTpm2Capabilities()
    expect(capabilities.hasDevice).toBe(false)
    expect(await new LinuxVaultSlots().presence()).toBe(false)
  })

  it('the TPM2 slot refuses to seal where the machine has no TPM', async () => {
    const { vaultId, slotId } = ids()
    const slot = new LinuxVaultSlots().hardware(vaultId, slotId)
    await expect(slot.wrap(randomBytes(32))).rejects.toBeInstanceOf(VaultStoreUnavailableError)
    await expect(slot.unwrap(sealedRecord(vaultId, slotId), 'use')).rejects.toBeInstanceOf(
      VaultStoreUnavailableError,
    )
  })

  it('the TPM2 slot rejects records that are not its own sealed object', async () => {
    const { vaultId, slotId } = ids()
    const slot = new LinuxVaultSlots().hardware(vaultId, slotId)
    const other = ids()
    await expect(slot.unwrap(sealedRecord(other.vaultId, other.slotId), 'use')).rejects.toThrow(
      VaultError,
    )
    const tampered = { ...sealedRecord(vaultId, slotId), wrappedKey: '!!!not-base64!!!' }
    await expect(slot.unwrap(tampered, 'use')).rejects.toThrow(VaultError)
  })

  it('Secure Enclave and Windows slots refuse construction off their OS', () => {
    const transport = { exchange: () => Promise.resolve(new Uint8Array()) }
    expect(
      () =>
        new MacVaultSlots(transport, {
          presenceRecords: () => Promise.resolve([]),
        }),
    ).toThrow(VaultError)
    // The platform guard throws before the helper is touched.
    const helper = {
      file: '',
      sha256: '',
      powershell: '',
      guardSource: '',
      rebuild: () => Promise.resolve(),
      report: () => undefined,
    }
    expect(() => new WindowsVaultSlots(helper)).toThrow(VaultError)
  })

  it('macOS resolves Keychain and Secure Enclave records, nothing else', () => {
    const transport = {
      exchange: (): Promise<Uint8Array> =>
        Promise.reject(new Error('routing must not invoke the helper')),
    }
    const slots = new MacVaultSlots(transport, { platform: 'darwin' })
    const { vaultId, slotId } = ids()
    const keychain = slots.slotFor({
      ...osStoreRecord(vaultId, slotId),
      provider: 'loginKeychain',
    })
    expect(keychain).toBeInstanceOf(OsStoreVaultSlot)
    const hardware = slots.slotFor({
      ...sealedRecord(vaultId, slotId),
      provider: 'secureEnclave',
    })
    expect(hardware).toBeInstanceOf(MacVaultSlot)
    expect(
      slots.slotFor({ ...osStoreRecord(vaultId, slotId), provider: 'secretService' }),
    ).toBeNull()
  })

  it('macOS presence fails closed where the helper cannot prove it', async () => {
    const transport = {
      exchange: (): Promise<Uint8Array> =>
        Promise.reject(new Error('no Secure Enclave on this machine')),
    }
    const { vaultId, slotId } = ids()
    const presenceRecord = {
      ...sealedRecord(vaultId, slotId),
      tier: 'presence',
      provider: 'secureEnclave',
    } as const
    const slots = new MacVaultSlots(transport, {
      platform: 'darwin',
      presenceRecords: () => Promise.resolve([presenceRecord]),
    })
    const use: VaultUse = {
      kind: 'sudo',
      command: { executable: '/usr/bin/apt', argv: [], cwd: '/' },
      sudoPath: '/usr/bin/sudo',
    }
    expect(await slots.presence('item', 'challenge', use)).toBe(false)
    const none = new MacVaultSlots(transport, {
      platform: 'darwin',
      presenceRecords: () => Promise.resolve([]),
    })
    expect(await none.presence('item', 'challenge', use)).toBe(false)
  })

  it('Linux slots refuse construction off Linux', () => {
    expect(() => new LinuxVaultSlots({ platform: 'darwin' })).toThrow(VaultError)
  })
})
