import {
  VaultStore,
  type VaultFilePort,
  type VaultGenerationPort,
  type VaultGenerationState,
} from '../../../src/core/vault/store'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import { ownedBytes, randomVaultBytes, VaultError } from '../../../src/core/vault/crypto'
import { FakeVaultClock } from '../helpers/vault/core'

export class MemoryVaultFiles implements VaultFilePort {
  private writing = false
  readonly maxBytes = 16 * 1024 * 1024
  readonly data = new Map<'vault.v1' | 'slots.v1' | 'pending.v1', Buffer>()
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
  advance(vaultId: string, state: VaultGenerationState): Promise<void> {
    const previous = this.states.get(vaultId)
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
