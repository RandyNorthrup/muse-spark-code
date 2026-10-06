import { randomBytes } from 'node:crypto'
import {
  vaultItemSchema,
  vaultSlotRecordSchema,
  type VaultClockPort,
  type VaultItem,
  type VaultItemMetadata,
  type VaultSlotPort,
  type VaultSlotRecord,
  type VaultStorePort,
  type VaultRequester,
  type VaultUse,
  type VaultTaint,
  type VaultApprovalAnswer,
} from '../../../../src/shared/vault'
import {
  type VaultAuthenticatedPeer,
  type VaultChannelPort,
  type VaultBrokerPort,
  type VaultStatus,
} from '../../../../src/shared/vaultProtocol'
import { vaultUseDigest } from '../../../../src/core/vault/useDigest'
import { VAULT_APPROVAL_TTL_MS, VAULT_FORMAT_VERSION } from '../../../../src/shared/constants'

export class FakeVaultClock implements VaultClockPort {
  constructor(private current = 1_000_000) {}
  now(): number {
    return this.current
  }
  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('fake clock: invalid advance')
    this.current += ms
  }
}

export class InMemoryVault implements VaultStorePort {
  private readonly items = new Map<string, VaultItem>()
  private locked = false
  private erase(id: string): void {
    const item = this.items.get(id)
    if (item)
      for (const field of Object.values(item.material))
        if (field instanceof Uint8Array) field.fill(0)
    this.items.delete(id)
  }
  private checkUnlocked(): void {
    if (this.locked) throw new Error('fake vault: locked')
  }
  list(): Promise<readonly VaultItemMetadata[]> {
    this.checkUnlocked()
    return Promise.resolve(
      Array.from(this.items.values(), (item) => structuredClone(item.metadata)),
    )
  }
  read(id: string): Promise<VaultItem> {
    this.checkUnlocked()
    const item = this.items.get(id)
    return item
      ? Promise.resolve(structuredClone(item))
      : Promise.reject(new Error('fake vault: missing item'))
  }
  write(item: VaultItem): Promise<void> {
    this.checkUnlocked()
    const parsed = vaultItemSchema.parse(item)
    this.erase(parsed.metadata.id)
    this.items.set(parsed.metadata.id, structuredClone(parsed))
    return Promise.resolve()
  }
  remove(id: string): Promise<void> {
    this.checkUnlocked()
    this.erase(id)
    return Promise.resolve()
  }
  lock(): void {
    for (const id of this.items.keys()) this.erase(id)
    this.locked = true
  }
}

/** Token-backed slot fake: it deliberately makes no encryption or OS protection claim. */
export class FakeVaultSlot implements VaultSlotPort {
  private readonly keys = new Map<string, Uint8Array>()
  lost = false
  prompts: string[] = []
  constructor(
    readonly tier: VaultSlotRecord['tier'],
    private readonly canUnwrap: (use: string) => boolean = () => true,
  ) {}
  wrap(key: Uint8Array): Promise<VaultSlotRecord> {
    const token = randomBytes(32).toString('base64')
    this.keys.set(token, Uint8Array.from(key))
    const provider = {
      hardware: 'windowsTpm',
      presence: 'linuxTpm2',
      osStore: 'secretService',
      secretStorage: 'secretStorage',
      passphrase: 'passphrase',
      recovery: 'recovery',
    }[this.tier]
    return Promise.resolve(
      vaultSlotRecordSchema.parse({
        v: VAULT_FORMAT_VERSION,
        id: randomBytes(16).toString('hex'),
        vaultId: 'a'.repeat(32),
        lastGeneration: 0,
        auditGeneration: 0,
        auditHead: '0'.repeat(64),
        createdAt: 0,
        tier: this.tier,
        provider,
        keyReference: 'test-only',
        wrappedKey: token,
        nonce: randomBytes(12).toString('base64'),
        tag: randomBytes(16).toString('base64'),
        kdf:
          this.tier === 'passphrase'
            ? { kind: 'scrypt', salt: randomBytes(16).toString('base64'), N: 131_072, r: 8, p: 1 }
            : null,
        backend: this.tier === 'secretStorage' ? 'gnome_libsecret' : null,
      }),
    )
  }
  unwrap(slot: VaultSlotRecord, use: string): Promise<Uint8Array> {
    const parsed = vaultSlotRecordSchema.parse(slot)
    if (this.lost || parsed.tier !== this.tier)
      return Promise.reject(new Error('fake slot: unavailable'))
    if (this.tier === 'presence' || this.tier === 'passphrase') {
      this.prompts.push(use)
      if (!this.canUnwrap(use)) return Promise.reject(new Error('fake slot: presence denied'))
    }
    const key = this.keys.get(parsed.wrappedKey)
    return key
      ? Promise.resolve(Uint8Array.from(key))
      : Promise.reject(new Error('fake slot: unknown token'))
  }
}

/** Always asks. Script policy outcomes in B's own tests rather than hiding a policy engine here. */
export class FakeVaultBroker implements VaultBrokerPort {
  private epoch = 0
  private locked = false
  private readonly pending = new Map<string, Awaited<ReturnType<VaultBrokerPort['request']>>>()
  readonly accepted: string[] = []
  constructor(
    private readonly store: VaultStorePort,
    readonly clock: VaultClockPort,
  ) {}
  status(): Promise<VaultStatus> {
    return Promise.resolve({
      state: this.locked ? 'locked' : 'unlocked',
      lockEpoch: this.epoch,
      tier: 'osStore',
      provider: 'test-only',
      silentUnlock: true,
      itemCount: 0,
      reason: this.locked ? 'locked' : null,
    })
  }
  async list(_requester: VaultRequester): Promise<readonly VaultItemMetadata[]> {
    const items = await this.store.list()
    return items.filter((item) => !item.hidden && !item.firstParty)
  }
  async request(
    requester: VaultRequester,
    handle: string,
    use: VaultUse,
    taint: VaultTaint,
  ): ReturnType<VaultBrokerPort['request']> {
    if (this.locked) throw new Error('fake broker: locked')
    const items = await this.list(requester)
    const item = items.find((item) => item.handle === handle)
    if (!item) throw new Error('fake broker: item unavailable')
    const request = {
      id: randomBytes(16).toString('hex'),
      requester,
      item,
      use: structuredClone(use),
      digest: vaultUseDigest(use),
      nonce: randomBytes(16).toString('hex'),
      createdAt: this.clock.now(),
      expiresAt: this.clock.now() + VAULT_APPROVAL_TTL_MS,
      lockEpoch: this.epoch,
      taint,
    }
    this.pending.set(request.id, request)
    return structuredClone(request)
  }
  answer(peer: VaultAuthenticatedPeer, answer: VaultApprovalAnswer): Promise<boolean> {
    const request = this.pending.get(answer.requestId)
    if (
      !request ||
      !peer.ui ||
      peer.hostId !== request.requester.hostId ||
      this.locked ||
      request.lockEpoch !== this.epoch ||
      request.digest !== answer.digest ||
      this.clock.now() >= request.expiresAt
    )
      return Promise.resolve(false)
    this.pending.delete(request.id)
    if (answer.decision !== 'deny') this.accepted.push(request.id)
    return Promise.resolve(true)
  }
  lock(): Promise<void> {
    this.epoch += 1
    this.locked = true
    this.pending.clear()
    this.store.lock()
    return Promise.resolve()
  }
}

/** Scripted authenticated transport; it does not replace native peer verification. */
export class FakeVaultChannel implements VaultChannelPort {
  private isClosed = false
  constructor(private readonly peer: VaultAuthenticatedPeer) {}
  authenticate(): Promise<VaultAuthenticatedPeer> {
    return this.isClosed
      ? Promise.reject(new Error('fake channel: closed'))
      : Promise.resolve(structuredClone(this.peer))
  }
  close(): void {
    this.isClosed = true
  }
}
