import { fakeHostChannelPorts } from '../helpers/vault/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import {
  createVaultBrokerProcess,
  type VaultBrokerBindings,
} from '../../../src/runtime/vault/vaultBrokerEntry'
import { OsStoreVaultSlot } from '../../../src/runtime/vault/slots/osStoreVaultSlot'
import {
  vaultProcessIdentity,
  vaultSocketDescriptors,
  vaultPeerExecutable,
} from '../../../src/runtime/vault/posixNative'
import { VaultStoreRepository } from '../../../src/core/vault/broker/repository'
import { VaultManagement } from '../../../src/core/vault/broker/management'
import { VaultBrokerClient } from '../../../src/core/vault/broker/client'
import { UnixVaultPeerVerifier } from '../../../src/core/vault/broker/peer'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { type VaultSlotRecord } from '../../../src/shared/vault'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { brokerFixture } from './brokerFixture'
import { managementFixture, stateOf } from './managementFixture'
import { grant, metadata } from '../helpers/vault/fixtures'

vi.mock(
  '../../../src/core/resources/launcher',
  async () => await import('../helpers/vault/brokerChildLauncher'),
)
const native = { root: '', helper: '' }
beforeAll(async () => {
  if (process.platform === 'win32') return
  native.root = await mkdtemp(path.join(os.tmpdir(), 'vc-'))
  native.helper = vaultPeerExecutable(native.root)
  await mkdir(path.dirname(native.helper), { recursive: true })
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'native/posix/vaultPeer.c',
    '-o',
    native.helper,
  ])
})
afterAll(async () => {
  if (native.root) await rm(native.root, { recursive: true, force: true })
})

function withoutScreenLock(): void {
  /* Fake platform has no screen-lock source. */
}

/** A generated home for the composed management side's importer. */
async function homeDir(): Promise<string> {
  const home = path.join(native.root, 'home')
  await mkdir(home, { recursive: true })
  return home
}

async function bindings() {
  const f = await brokerFixture()
  await f.broker.dispose()
  const anchors = new Map<string, string>(),
    secrets = new Map<string, Uint8Array>()
  const open = (_service: string, account: string) => ({
    getSecret: () => Promise.resolve(secrets.get(account)?.slice() ?? null),
    setSecret: (bytes: Uint8Array) => {
      secrets.set(account, Uint8Array.from(bytes))
      return Promise.resolve()
    },
    deleteCredential: () => {
      secrets.get(account)?.fill(0)
      return Promise.resolve(secrets.delete(account))
    },
  })
  const slot = (record: VaultSlotRecord) => new OsStoreVaultSlot(record, process.platform, open)
  const ports: VaultBrokerBindings = {
    keyring: (_service, account) => ({
      getPassword: () => Promise.resolve(anchors.get(account) ?? null),
      setPassword: (value) => {
        anchors.set(account, value)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(anchors.delete(account)),
    }),
    slots: {
      slotFor: (record) => (record.tier === 'osStore' ? slot(record) : null),
      osStore: (vaultId, id) =>
        new OsStoreVaultSlot(
          {
            vaultId,
            id,
            lastGeneration: 0,
            auditGeneration: 0,
            auditHead: '0'.repeat(VAULT_LIMITS.sha256Hex),
            createdAt: Date.now(),
          },
          process.platform,
          open,
        ),
      presence: () => Promise.resolve(false),
      onScreenLock: () => withoutScreenLock,
    },
    peers: new UnixVaultPeerVerifier(
      native.helper,
      async (pid) => {
        const identity = await vaultProcessIdentity(native.helper, pid)
        if (!identity) throw new Error('test process disappeared')
        return identity
      },
      vaultSocketDescriptors,
    ),
    audit: vi.fn(() => f.deps.audit),
    onAuditFailure: vi.fn(),
    ...fakeHostChannelPorts(),
    // Round-3 contracts: the importer runs inside management over this home.
    home: await homeDir(),
    lockOnScreenLock: false,
    idleMs: 1000,
  }
  return { ports, secrets, hostId: f.peer.hostId }
}

describe.skipIf(process.platform === 'win32')('broker composition over part A blocks', () => {
  it('confirms setup, encrypts a private add, forwards change/lock callbacks and reopens through the same OS anchor', async () => {
    const f = await bindings()
    const context = {
      dataDir: path.join(native.root, 'data'),
      runDirectory: path.join(native.root, 'run'),
      installRoot: native.root,
      userSession: 't',
    }
    const changed = vi.spyOn(VaultManagement.prototype, 'noteChanged')
    const locked = vi.spyOn(VaultManagement.prototype, 'noteLocked')
    const material = { kind: 'secret' as const, value: randomBytes(32) }
    let handle = await createVaultBrokerProcess(context, f.ports)
    const peers = f.ports.peers
    if (!peers) throw new Error('missing test peers')
    let client = await VaultBrokerClient.open(handle.location, f.hostId, 'c'.repeat(32), peers)
    try {
      const snapshot = await client.send({ kind: 'snapshot' })
      if (snapshot.kind !== 'snapshot') throw new Error('missing snapshot')
      expect(snapshot.snapshot.status.state).toBe('uncreated')
      const shown = await client.send({ kind: 'setup', protection: 'auto' })
      if (shown.kind !== 'recoveryCode') throw new Error('missing private setup response')
      const confirmation = await client.send({ kind: 'confirmSetup', setupId: shown.setupId })
      expect(confirmation.kind).toBe('ok')
      const encoded = encodeVaultMaterial(material)
      try {
        const added = await client.send({
          v: 2,
          kind: 'add',
          metadata: metadata(),
          encoding: 'base64',
          material: encoded.toString('base64'),
        })
        expect(added.kind).toBe('ok')
      } finally {
        encoded.fill(0)
      }
      await expect(createVaultBrokerProcess(context, f.ports)).rejects.toThrow()
      const stillOpen = await client.send({ kind: 'status' })
      if (stillOpen.kind !== 'status') throw new Error('missing live status')
      expect(stillOpen.status.state).toBe('unlocked')
      // A saved grant reaches watchers through subscribeCommitted, not the
      // revocation channel (RVCM1091A F3); the management add has no such event.
      // The composition adds no subscriber of its own (RVCM1091B2 P3: that
      // second subscriber emitted a duplicate changed event), so noteChanged
      // stays silent here; the constructor's own forwarding carries the one
      // event, pinned exactly-once by the socket-free case below.
      const repoCall = vi.mocked(f.ports.audit).mock.calls[0]
      const repository = repoCall?.[0]
      expect(repository).toBeInstanceOf(VaultStoreRepository)
      changed.mockClear()
      await repository?.saveGrant(grant(), () => undefined)
      expect(changed).not.toHaveBeenCalled()
      const ciphertext = await readFile(path.join(context.dataDir, 'vault.v1'))
      expect(ciphertext.includes(material.value)).toBe(false)
      const response = await client.send({ kind: 'lock' })
      expect(response.kind).toBe('ok')
      expect(locked).toHaveBeenCalled()
      client.close()
      await handle.close()
      handle = await createVaultBrokerProcess(context, f.ports)
      client = await VaultBrokerClient.open(handle.location, f.hostId, 'c'.repeat(32), peers)
      const unlocked = await client.send({ kind: 'unlock', slotId: null })
      expect(unlocked.kind).toBe('ok')
      const reopened = await client.send({ kind: 'snapshot' })
      if (reopened.kind !== 'snapshot') throw new Error('missing reopened snapshot')
      expect(reopened.snapshot.items.map((item) => item.id)).toContain(metadata().id)
    } finally {
      client.close()
      await handle.close()
      material.value.fill(0)
      for (const value of f.secrets.values()) value.fill(0)
      changed.mockRestore()
      locked.mockRestore()
    }
  })
  it('a committed grant save reaches watchers through subscribeCommitted', async () => {
    const m = managementFixture()
    const events: string[] = []
    const stopWatch = m.management.subscribe((event) => {
      events.push(event.kind)
    })
    // The broker composition adds no forwarding of its own: VaultManagement's
    // constructor already wires repository commits to watchers, and a saved
    // grant must not need the revocation channel.
    const value = randomBytes(32)
    try {
      const shown = await m.management.setup()
      shown.code.fill(0)
      await m.management.confirmSetup(shown.setupId)
      // A grant saves only for a present item; the fixture names metadata()'s.
      await m.repository
        .current()
        .write({ metadata: metadata(), material: { kind: 'secret' as const, value } })
      // Confirming already emits changed; the save must emit exactly one of
      // its own (RVCM1091B2 P3: a second subscriber would emit two).
      events.length = 0
      await m.repository.saveGrant(grant(), () => undefined)
      expect(events).toEqual(['changed'])
    } finally {
      value.fill(0)
      stopWatch()
    }
  })
  it('a broker lock erases a pending setup through onLocked', async () => {
    const m = managementFixture()
    const f = await brokerFixture({
      onLocked: (epoch: number) => {
        m.management.noteLocked(epoch)
      },
    })
    try {
      const shown = await m.management.setup()
      await f.broker.lock()
      await expect(m.management.confirmSetup(shown.setupId)).rejects.toMatchObject({
        reason: 'invalid',
      })
      expect(await stateOf(m.management)).toBe('uncreated')
      shown.code.fill(0)
    } finally {
      await f.broker.dispose()
    }
  })
})
