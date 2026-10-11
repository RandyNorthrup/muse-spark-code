import * as crypto from 'node:crypto'
import { expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  VaultStore,
  type VaultFilePort,
  type VaultGenerationPort,
  type VaultGenerationState,
  type VaultSnapshot,
} from '../../../src/core/vault/store'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import {
  encodeVaultJson,
  hkdfSha256,
  vaultHmacSha256,
  ownedBytes,
  randomVaultBytes,
  VaultError,
} from '../../../src/core/vault/crypto'
import { FakeVaultClock } from '../helpers/vault/core'

export class MemoryVaultFiles implements VaultFilePort {
  private writing = false
  readonly maxBytes = 16 * 1024 * 1024
  readonly data = new Map<'vault.v1' | 'slots.v1' | 'pending.v1', Buffer>()
  readonly quarantined: Buffer[] = []
  fail: 'vault.v1' | 'slots.v1' | 'pending.v1' | null = null
  read(name: 'vault.v1' | 'slots.v1' | 'pending.v1'): Promise<Buffer | null> {
    const bytes = this.data.get(name)
    return Promise.resolve(bytes ? ownedBytes(bytes) : null)
  }
  writeAtomic(name: 'vault.v1' | 'slots.v1' | 'pending.v1', bytes: Uint8Array): Promise<void> {
    if (this.fail === name) return Promise.reject(new VaultError('io'))
    this.data.set(name, ownedBytes(bytes))
    return Promise.resolve()
  }
  remove(name: 'vault.v1' | 'slots.v1' | 'pending.v1'): Promise<void> {
    this.data.delete(name)
    return Promise.resolve()
  }
  quarantine(name: 'vault.v1'): Promise<void> {
    const bytes = this.data.get(name)
    if (bytes) this.quarantined.push(ownedBytes(bytes))
    return Promise.resolve()
  }
  async withWriter<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writing) throw new VaultError('busy')
    this.writing = true
    try {
      return await operation()
    } finally {
      this.writing = false
    }
  }
}
export class MemoryVaultAnchor implements VaultGenerationPort {
  readonly states = new Map<string, VaultGenerationState>()
  minimum(vaultId: string): Promise<VaultGenerationState | null> {
    const state = this.states.get(vaultId)
    return Promise.resolve(state ? { ...state } : null)
  }
  advance(
    vaultId: string,
    state: VaultGenerationState,
    prior: VaultGenerationState | null,
  ): Promise<void> {
    const previous = this.states.get(vaultId) ?? null
    if (!encodeVaultJson({ state: previous }).equals(encodeVaultJson({ state: prior })))
      return Promise.reject(new VaultError('rollback'))
    if (
      previous &&
      (state.generation <= previous.generation || state.auditGeneration < previous.auditGeneration)
    )
      return Promise.reject(new VaultError('rollback'))
    this.states.set(vaultId, { ...state })
    return Promise.resolve()
  }
}
export async function freshVault(
  files: VaultFilePort = new MemoryVaultFiles(),
  anchor = new MemoryVaultAnchor(),
) {
  const vaultId = randomVaultBytes(16).toString('hex')
  const key = randomVaultBytes()
  const recovery = createRecoverySlot(key, vaultId, new FakeVaultClock())
  const options = { files, anchor, key }
  const store = await VaultStore.create(options, vaultId, [recovery.slot])
  return { files, anchor, key, vaultId, recovery, options, store }
}

export function jsonRecord(bytes: Buffer): Record<string, unknown> {
  const value: unknown = JSON.parse(bytes.toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('test document')
  return Object.fromEntries(Object.entries(value))
}

/** Deliberately author malformed authenticated states so inner semantic guards still fire. */
export function signSnapshot(key: Uint8Array, snapshot: VaultSnapshot): void {
  snapshot.slots.documentDigest = createHash('sha256')
    .update(encodeVaultJson(snapshot.document))
    .digest('hex')
  const derived = hkdfSha256(
    key,
    Buffer.from(snapshot.slots.vaultId),
    Buffer.from('vault-slots-v1'),
  )
  const { mac: _mac, ...body } = snapshot.slots
  const mac = vaultHmacSha256(derived, encodeVaultJson(body))
  try {
    snapshot.slots.mac = mac.toString('base64')
  } finally {
    derived.fill(0)
    mac.fill(0)
  }
}
export function installSnapshot(
  options: { files: MemoryVaultFiles; anchor: MemoryVaultAnchor; key: Uint8Array },
  snapshot: VaultSnapshot,
): void {
  signSnapshot(options.key, snapshot)
  options.files.data.set('vault.v1', encodeVaultJson(snapshot.document))
  options.files.data.set('slots.v1', encodeVaultJson(snapshot.slots))
  options.anchor.states.set(snapshot.document.vaultId, {
    generation: snapshot.slots.generation,
    auditGeneration: snapshot.slots.auditGeneration,
    auditHead: snapshot.slots.auditHead,
    stateDigest: Buffer.from(snapshot.slots.mac, 'base64').toString('hex'),
  })
}

/** Generated-only probe: retain owned allocations through the assertion, then erase even a failed drill. */
export async function withRngFailure(
  key: Buffer,
  randomLength: number,
  assertion: () => void | Promise<void>,
): Promise<void> {
  const allocations: Buffer[] = []
  const allocate = Buffer.alloc
  const allocation = vi.spyOn(Buffer, 'alloc').mockImplementation((length) => {
    const bytes = allocate(length)
    allocations.push(bytes)
    return bytes
  })
  const rng = vi.spyOn(crypto, 'randomFillSync').mockImplementation((bytes) => {
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(100)
    throw new Error('generated RNG failure')
  })
  try {
    await assertion()
    for (const length of [key.length, randomLength]) {
      const owned = allocations.filter((bytes) => bytes.length === length)
      expect(owned.length).toBe(1)
      expect(owned.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true)
    }
    expect(key.some((byte) => byte !== 0)).toBe(true)
  } finally {
    rng.mockRestore()
    allocation.mockRestore()
    for (const bytes of allocations) bytes.fill(0)
    key.fill(0)
  }
}
