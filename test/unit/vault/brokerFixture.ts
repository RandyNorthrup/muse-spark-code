import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import * as z from 'zod/mini'
import { type VaultSocketDescriptorPort } from '../../../src/core/vault/broker/peer'
import { VaultBroker } from '../../../src/core/vault/broker/broker'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { type VaultBrokerDeps, type VaultAuditPort } from '../../../src/core/vault/broker/ports'
import {
  type VaultGrant,
  type VaultItem,
  type VaultAuditRecord,
  type VaultItemMetadata,
} from '../../../src/shared/vault'
import { type VaultAuthenticatedPeer } from '../../../src/shared/vaultProtocol'
import { FakeVaultClock, FakeVaultSlot, InMemoryVault } from '../helpers/vault/core'
import { grant, item, requester, use } from '../helpers/vault/fixtures'

export async function brokerFixture(options: Partial<VaultBrokerDeps> = {}) {
  const clock = new FakeVaultClock()
  const stored = item()
  stored.metadata.bindings = [
    { kind: 'environment', commandDigest: vaultCommandDigest(use().command), names: use().names },
  ]
  const items = new Map<string, VaultItem>([[stored.metadata.id, stored]])
  let store = new InMemoryVault()
  await store.write(stored)
  const grants = new Map<string, VaultGrant>()
  const slot = await new FakeVaultSlot('osStore').wrap(randomBytes(32))
  let epoch = 0
  const listeners = new Set<(value: number) => void>()
  const changes = new Set<(change: { kind: 'item' | 'grant'; id: string }) => void>()
  const records: Parameters<VaultAuditPort['append']>[0][] = []
  const releasedKeys: Uint8Array[] = []
  const heldKeys: Uint8Array[] = []
  const screen = new Set<() => void>()
  const peer: VaultAuthenticatedPeer = {
    hostId: requester().hostId,
    userId: 'test-user',
    processId: requester().peerProcessId,
    ui: true,
  }
  const deps: VaultBrokerDeps = {
    clock,
    repository: {
      open: async (key) => {
        heldKeys.push(key)
        store = new InMemoryVault()
        for (const item of items.values()) await store.write(item)
        return store
      },
      grants: () => Promise.resolve(Array.from(grants.values(), (entry) => structuredClone(entry))),
      saveGrant: (entry) => {
        grants.set(entry.id, structuredClone(entry))
        return Promise.resolve()
      },
      removeGrant: (id) => {
        grants.delete(id)
        return Promise.resolve()
      },
      subscribe: (listener) => {
        changes.add(listener)
        return () => {
          changes.delete(listener)
        }
      },
      consumeGrant: (id) => {
        const entry = grants.get(id)
        if (!entry || (entry.maxUses !== null && entry.uses >= entry.maxUses))
          return Promise.resolve(false)
        entry.uses += 1
        return Promise.resolve(true)
      },
    },
    unlock: {
      unlock: () => {
        const key = randomBytes(32)
        releasedKeys.push(key)
        return Promise.resolve({ key, slot })
      },
      presence: vi.fn(() => Promise.resolve(true)),
      onScreenLock: (listener) => {
        screen.add(listener)
        return () => {
          screen.delete(listener)
        }
      },
    },
    epoch: {
      current: () => Promise.resolve(epoch),
      bump: () => Promise.resolve(++epoch),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    audit: {
      open: vi.fn(() => Promise.resolve()),
      append: vi.fn((record: Parameters<VaultAuditPort['append']>[0]) => {
        records.push(structuredClone(record))
        return Promise.resolve()
      }),
      read: () =>
        Promise.resolve(
          records.map((record, index): VaultAuditRecord => ({
            v: 1,
            ...record,
            id: 'f'.repeat(32),
            generation: index + 1,
            previousHash: '0'.repeat(64),
            hash: '1'.repeat(64),
            mac: '2'.repeat(64),
          })),
        ),
      close: vi.fn(),
    },
    identity: {
      verifyHost: (candidate) =>
        Promise.resolve(
          candidate.hostId === peer.hostId &&
            candidate.processId === peer.processId &&
            candidate.userId === peer.userId,
        ),
      verifyLaunched: (_peer, entry) => Promise.resolve(entry.requester.hostId === peer.hostId),
    },
    idleMs: 240 * 60_000,
    lockOnScreenLock: true,
    firstPartyOnly: false,
    onApproval: vi.fn(),
    onLocked: vi.fn(),
    onRevoked: vi.fn(),
    scrub: (text) => Promise.resolve(text),
    ...options,
  }
  const broker = new VaultBroker(deps)
  const identity = requester()
  await broker.register(peer, identity, 'ask')
  await broker.unlock()
  function standing(): VaultGrant {
    const entry = grant()
    entry.target = structuredClone(stored.metadata.bindings[0]!)
    grants.set(entry.id, entry)
    return entry
  }
  async function change(metadata: Partial<VaultItemMetadata>): Promise<void> {
    Object.assign(stored.metadata, metadata)
    items.set(stored.metadata.id, stored)
    await store.write(stored)
  }
  async function firstParty(isPresenceRequired = false, bytes = randomBytes(32)) {
    const metadata: VaultItemMetadata = {
      ...stored.metadata,
      kind: 'apiKey',
      firstParty: true,
      hidden: true,
      requirePresence: isPresenceRequired,
      policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
      bindings: [{ kind: 'origin', origin: 'https://example.test' }],
    }
    const value: VaultItem = {
      metadata,
      material: { kind: 'apiKey', value: bytes, auth: 'bearer', origin: 'https://example.test' },
    }
    items.set(metadata.id, value)
    await store.write(value)
    return {
      bytes,
      request: {
        v: 1,
        kind: 'firstPartyRead',
        itemId: metadata.id,
        origin: 'https://example.test',
        client: 'model',
      } as const,
    }
  }
  return {
    broker,
    deps,
    clock,
    stored,
    items,
    records,
    grants,
    peer,
    identity,
    heldKeys,
    releasedKeys,
    standing,
    change,
    firstParty,
    notify: (kind: 'item' | 'grant', id: string) => {
      for (const listener of changes) listener({ kind, id })
    },
    screenLock: () => {
      for (const listener of screen) listener()
    },
    externalLock: () => {
      epoch += 1
      for (const listener of listeners) listener(epoch)
    },
  }
}
export const cleanTaint = { tainted: false, reasons: [] }
/** Hold a snapshot across an await to exercise lock/invalidation races at the store boundary. */
export async function delayListing(fixture: Awaited<ReturnType<typeof brokerFixture>>) {
  const waiting = Promise.withResolvers<undefined>(),
    entered = Promise.withResolvers<undefined>(),
    open = fixture.deps.repository.open
  let isHolding = false
  fixture.deps.repository.open = async (key) => {
    const store = await open(key),
      list = store.list.bind(store)
    store.list = async () => {
      const metadata = await list()
      if (isHolding) {
        entered.resolve(undefined)
        await waiting.promise
      }
      return metadata
    }
    return store
  }
  await fixture.broker.lock()
  await fixture.broker.unlock()
  return {
    entered: entered.promise,
    begin: () => {
      isHolding = true
    },
    release: () => {
      isHolding = false
      waiting.resolve(undefined)
    },
  }
}
/** Test-only Node reflection; the production native listener supplies its owned descriptor. */
export const socketDescriptors: VaultSocketDescriptorPort = {
  descriptor: (socket) =>
    z.object({ fd: z.number().check(z.int(), z.positive()) }).parse(Reflect.get(socket, '_handle'))
      .fd,
}
