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
import { WindowsVaultSlot } from '../../../src/runtime/vault/slots/windowsVaultSlot'
import { OsStoreVaultSlot } from '../../../src/runtime/vault/slots/osStoreVaultSlot'
import { macVaultTransport } from '../../../src/runtime/vault/slots/macVaultTransport'
import {
  windowsVaultTransport,
  type WindowsVaultExecutable,
} from '../../../src/runtime/vault/slots/windowsVaultTransport'
import { invokeMacVault, MacVaultError } from '../../../src/runtime/vault/slots/macVaultProtocol'
import { invokeWindowsVault } from '../../../src/runtime/vault/slots/windowsVaultProtocol'
import { UI_TEXT, VAULT_FORMAT_VERSION, VAULT_KEY_BYTES } from '../../../src/shared/constants'

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

// The real transports, pointed at helpers that are not there: construction
// is pure (a path check), and every exchange fails the way a missing native
// helper fails, so fail-closed assertions drive real code on every OS.
function macTransport() {
  return macVaultTransport('/opt/muse-spark-test/muse-vault-missing')
}

function windowsHelper(): WindowsVaultExecutable {
  return {
    file: '/opt/muse-spark-test/MuseSparkVault-1.exe',
    sha256: '0'.repeat(64),
    powershell: '/opt/muse-spark-test/powershell-missing.exe',
    guardSource: 'test',
    rebuild: () => Promise.reject(new Error('missing helper')),
    report: () => undefined,
  }
}

describe('platform slot providers', () => {
  it("the broker entry selects this platform's slots", () => {
    if (process.platform === 'win32') {
      // The Windows provider needs its built helper; without one the entry refuses.
      expect(() =>
        defaultBrokerSlots({ installRoot: '/opt/test' }, () => Promise.resolve([])),
      ).toThrow()
      return
    }
    const slots = defaultBrokerSlots({ installRoot: '/opt/test' }, () => Promise.resolve([]))
    if (process.platform === 'linux') expect(slots).toBeInstanceOf(LinuxVaultSlots)
    else expect(slots).toBeInstanceOf(MacVaultSlots)
  })

  it('Linux resolves the OS-store and TPM2 records, nothing else', () => {
    const { vaultId, slotId } = ids()
    const slots = new LinuxVaultSlots({ platform: 'linux' })
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
    // The probe's contract, on any machine: sealing implies a device.
    expect(!capabilities.canSeal || capabilities.hasDevice).toBe(true)
    expect(await new LinuxVaultSlots({ platform: 'linux' }).presence()).toBe(false)
  })

  it('the TPM2 slot seals where the machine seals and refuses where it cannot', async () => {
    const { vaultId, slotId } = ids()
    const slot = new LinuxVaultSlots({ platform: 'linux' }).hardware(vaultId, slotId)
    const capabilities = await linuxTpm2Capabilities()
    if (!capabilities.canSeal) {
      await expect(slot.wrap(randomBytes(VAULT_KEY_BYTES))).rejects.toBeInstanceOf(
        VaultStoreUnavailableError,
      )
      await expect(slot.unwrap(sealedRecord(vaultId, slotId), 'use')).rejects.toBeInstanceOf(
        VaultStoreUnavailableError,
      )
      return
    }
    // A sealing machine round-trips for real through systemd-creds; sealing
    // writes nothing anywhere, so this proves the slot without side effects.
    const key = randomBytes(VAULT_KEY_BYTES)
    const record = await slot.wrap(key)
    expect(record.provider).toBe('linuxTpm2')
    const unwrapped = await slot.unwrap(record, 'use')
    try {
      expect(unwrapped.byteLength).toBe(VAULT_KEY_BYTES)
    } finally {
      unwrapped.fill(0)
    }
  })

  it('Linux offers its hardware slot exactly where the machine seals', async () => {
    const { vaultId, slotId } = ids()
    const capabilities = await linuxTpm2Capabilities()
    const slot = await new LinuxVaultSlots({ platform: 'linux' }).hardwareIfAvailable(
      vaultId,
      slotId,
    )
    if (capabilities.canSeal) {
      expect(slot?.tier).toBe('hardware')
      expect(slot).toBeInstanceOf(LinuxTpm2Slot)
    } else expect(slot).toBeNull()
  })

  it('macOS offers its hardware slot exactly where the helper reports it', async () => {
    const { vaultId, slotId } = ids()
    // The helper is absent, so the probe fails and no slot is offered.
    // (Off-OS construction refuses before any probe; covered separately.)
    expect(
      await new MacVaultSlots(macTransport(), { platform: 'darwin' }).hardwareIfAvailable(
        vaultId,
        slotId,
      ),
    ).toBeNull()
  })

  it('Windows offers its hardware slot exactly where the helper reports it', async () => {
    const { vaultId, slotId } = ids()
    // The helper is absent, so the probe fails and no slot is offered.
    // (Off-OS construction refuses before any probe; covered separately.)
    expect(
      await new WindowsVaultSlots(windowsHelper(), { platform: 'win32' }).hardwareIfAvailable(
        vaultId,
        slotId,
      ),
    ).toBeNull()
  })

  it('the TPM2 slot rejects records that are not its own sealed object', async () => {
    const { vaultId, slotId } = ids()
    const slot = new LinuxVaultSlots({ platform: 'linux' }).hardware(vaultId, slotId)
    const other = ids()
    await expect(slot.unwrap(sealedRecord(other.vaultId, other.slotId), 'use')).rejects.toThrow(
      VaultError,
    )
    const tampered = { ...sealedRecord(vaultId, slotId), wrappedKey: '!!!not-base64!!!' }
    await expect(slot.unwrap(tampered, 'use')).rejects.toThrow(VaultError)
  })

  it('every provider refuses construction off its OS', () => {
    expect(() => new LinuxVaultSlots({ platform: 'darwin' })).toThrow(VaultError)
    expect(() => new MacVaultSlots(macTransport(), { platform: 'linux' })).toThrow(VaultError)
    expect(() => new WindowsVaultSlots(windowsHelper(), { platform: 'linux' })).toThrow(VaultError)
  })

  it('macOS resolves Keychain and Secure Enclave records, nothing else', () => {
    const slots = new MacVaultSlots(macTransport(), { platform: 'darwin' })
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
    const { vaultId, slotId } = ids()
    const presenceRecord = {
      ...sealedRecord(vaultId, slotId),
      tier: 'presence',
      provider: 'secureEnclave',
    } as const
    const slots = new MacVaultSlots(macTransport(), {
      platform: 'darwin',
      presenceRecords: () => Promise.resolve([presenceRecord]),
    })
    const use: VaultUse = {
      kind: 'sudo',
      command: { executable: '/usr/bin/apt', argv: [], cwd: '/' },
      sudoPath: '/usr/bin/sudo',
    }
    // The helper is absent, so the fresh unwrap fails and presence refuses.
    expect(await slots.presence('item', 'challenge', use)).toBe(false)
    const none = new MacVaultSlots(macTransport(), {
      platform: 'darwin',
      presenceRecords: () => Promise.resolve([]),
    })
    expect(await none.presence('item', 'challenge', use)).toBe(false)
  })

  it('Windows resolves DPAPI and CNG records, nothing else', () => {
    const slots = new WindowsVaultSlots(windowsHelper(), { platform: 'win32' })
    const { vaultId, slotId } = ids()
    const dpapi = slots.slotFor({
      ...osStoreRecord(vaultId, slotId),
      provider: 'windowsDpapi',
    })
    expect(dpapi).toBeInstanceOf(WindowsVaultSlot)
    const hardware = slots.slotFor({
      ...sealedRecord(vaultId, slotId),
      provider: 'windowsTpm',
    })
    expect(hardware).toBeInstanceOf(WindowsVaultSlot)
    const presence = slots.slotFor({
      ...sealedRecord(vaultId, slotId),
      tier: 'presence',
      provider: 'windowsTpm',
    })
    expect(presence).toBeInstanceOf(WindowsVaultSlot)
    expect(
      slots.slotFor({ ...osStoreRecord(vaultId, slotId), provider: 'secretService' }),
    ).toBeNull()
  })

  it('Windows presence fails closed without a presence record or a helper', async () => {
    const { vaultId, slotId } = ids()
    const use: VaultUse = {
      kind: 'sudo',
      command: {
        executable: String.raw`C:\Windows\System32\cmd.exe`,
        argv: [],
        cwd: String.raw`C:\Windows`,
      },
      sudoPath: String.raw`C:\Windows\System32\sudo.exe`,
    }
    const none = new WindowsVaultSlots(windowsHelper(), { platform: 'win32' })
    expect(await none.presence('item', 'challenge', use)).toBe(false)
    const presenceRecord = {
      ...sealedRecord(vaultId, slotId),
      tier: 'presence',
      provider: 'windowsTpm',
    } as const
    const slots = new WindowsVaultSlots(windowsHelper(), {
      platform: 'win32',
      presenceRecords: () => Promise.resolve([presenceRecord]),
    })
    // The helper is absent, so the fresh Hello signature fails and presence refuses.
    expect(await slots.presence('item', 'challenge', use)).toBe(false)
  })

  it('a dead Secure Enclave helper fails with the fixed sentence and its cause', async () => {
    // The helper binary is really absent, so the governed spawn really fails:
    // no native diagnostic reaches the caller, only the fixed sentence.
    let failure: unknown
    try {
      await invokeMacVault(macTransport(), { v: VAULT_FORMAT_VERSION, operation: 'probe' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(MacVaultError)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })

  it('a dead pipe helper fails with the fixed sentence and its cause', async () => {
    // PowerShell is really absent, so the governed spawn really fails: the
    // fixed sentence crosses with the launch failure as its cause.
    let failure: unknown
    try {
      await invokeWindowsVault(windowsVaultTransport(windowsHelper()), {
        v: VAULT_FORMAT_VERSION,
        operation: 'probe',
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBeInstanceOf(Error)
  })
})
