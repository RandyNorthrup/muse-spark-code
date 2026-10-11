import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import { createVaultBrokerBindings } from '../../../src/runtime/vault/brokerBindings'
import { createVaultBrokerProcess } from '../../../src/runtime/vault/vaultBrokerEntry'
import { posixVaultClientPlatform } from '../../../src/runtime/vault/posixClientPlatform'
import { vaultClientPlatform } from '../../../src/runtime/vault/clientPlatform'
import * as nativeModule from '../../../src/runtime/vault/posixNative'
import { isPosixVaultHost, registerPosixVaultHost } from '../../../src/runtime/vault/posixHost'
import { vaultPeerExecutable } from '../../../src/runtime/vault/posixNative'
import { VaultStoreUnavailableError } from '../../../src/core/vault/broker/ports'
import { VaultBrokerClient } from '../../../src/core/vault/broker/client'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import type { VaultBroker } from '../../../src/core/vault/broker/broker'
import type { VaultStoreRepository } from '../../../src/core/vault/broker/repository'
import type * as BrokerModule from '../../../src/core/vault/broker/broker'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { vaultPrivateReadSchema } from '../../../src/shared/vaultProtocol'
import { VAULT_ANCHOR_ACCOUNT } from '../../../src/runtime/vault/keyringAnchor'
import { OsStoreVaultSlot } from '../../../src/runtime/vault/slots/osStoreVaultSlot'
import { UI_TEXT, VAULT_AVAILABILITY, VAULT_RESET_WORD } from '../../../src/shared/constants'
import { memoryKeyring } from '../helpers/keyring'
import { metadata, requester, use, grant } from '../helpers/vault/fixtures'

vi.mock(
  '../../../src/core/resources/launcher',
  async () => await import('../helpers/vault/brokerChildLauncher'),
)
vi.mock('../../../src/runtime/vault/posixNative', { spy: true })
const seen: { broker?: VaultBroker } = {}
vi.mock('../../../src/core/vault/broker/broker', async (original) => {
  const module = await original<typeof BrokerModule>()
  return {
    ...module,
    VaultBroker: class extends module.VaultBroker {
      constructor(...args: ConstructorParameters<typeof VaultBroker>) {
        super(...args)
        seen.broker = this
      }
    },
  }
})
const native = { root: '' }
beforeAll(async () => {
  if (process.platform === 'win32') return
  native.root = await mkdtemp(path.join(os.tmpdir(), 'vp-'))
  const helper = vaultPeerExecutable(native.root)
  await mkdir(path.dirname(helper), { recursive: true })
  execFileSync('/usr/bin/cc', [
    '-Os',
    '-Wall',
    '-Wextra',
    '-Werror',
    'native/posix/vaultPeer.c',
    '-o',
    helper,
  ])
})
afterAll(async () => {
  if (native.root) await rm(native.root, { recursive: true, force: true })
})

function hasProtectedIntent(entries: Map<string, string>): boolean {
  for (const key of entries.keys()) if (key.startsWith('vault-audit-pending-v1:')) return true
  return false
}

async function composition(
  interruption?: 'beforeStore' | 'beforeCommit' | 'afterStore' | 'afterCheckpoint',
) {
  const dataDir = await mkdtemp(path.join(native.root, 'd-'))
  const home = path.join(dataDir, 'home')
  await mkdir(home, { mode: 0o700 })
  const hostId = randomBytes(16).toString('hex'),
    hostSession = randomBytes(16).toString('hex')
  const platform = await posixVaultClientPlatform({
    dataDir,
    distDir: path.join(native.root, 'dist'),
    hostId,
    hostSession,
  })
  const context = {
    dataDir: path.join(dataDir, 'vault'),
    runDirectory: path.join(dataDir, 'vault', 'run'),
    installRoot: native.root,
    userSession: platform.discovery.userSession,
  }
  const { openEntry, values: entries } = memoryKeyring()
  const checkpoint = { shouldInterrupt: false, didInterrupt: false }
  const keyring: typeof openEntry = (service, account) => {
    const entry = openEntry(service, account)
    return {
      getPassword: entry.getPassword,
      deletePassword: async () => {
        if (
          interruption === 'afterCheckpoint' &&
          checkpoint.shouldInterrupt &&
          !checkpoint.didInterrupt &&
          account.startsWith('vault-audit-pending-v1:')
        ) {
          checkpoint.didInterrupt = true
          throw new Error('generated checkpoint interruption')
        }
        return await entry.deletePassword()
      },
      setPassword: async (value) => {
        const isTarget =
          (interruption === 'beforeStore' && account.startsWith('vault-audit-pending-v1:')) ||
          (interruption === 'afterStore' && account.startsWith('vault-audit-v1:'))
        const shouldFail = checkpoint.shouldInterrupt && !checkpoint.didInterrupt && isTarget
        if (shouldFail && interruption === 'afterStore') {
          checkpoint.didInterrupt = true
          throw new Error('generated checkpoint interruption')
        }
        await entry.setPassword(value)
        if (!shouldFail) {
          return
        }

        checkpoint.didInterrupt = true
        throw new Error('generated checkpoint interruption')
      },
    }
  }
  const secrets = new Map<string, Uint8Array>()
  const secretEntry = (_service: string, account: string) => ({
    getSecret: () => Promise.resolve(secrets.get(account)?.slice() ?? null),
    setSecret: (value: Uint8Array) => {
      secrets.set(account, Uint8Array.from(value))
      return Promise.resolve()
    },
    deleteCredential: () => Promise.resolve(secrets.delete(account)),
  })
  const slot = (record: ConstructorParameters<typeof OsStoreVaultSlot>[0]) =>
    new OsStoreVaultSlot(record, process.platform, secretEntry)
  const base = await createVaultBrokerBindings(context, {
    keyring,
    home,
    slots: {
      slotFor: slot,
      osStore: (vaultId, id) =>
        slot({
          vaultId,
          id,
          lastGeneration: 0,
          auditGeneration: 0,
          auditHead: '0'.repeat(64),
          createdAt: Date.now(),
        }),
      presence: () => Promise.resolve(false),
      onScreenLock: () => {
        throw new Error('screen lock is unavailable in the generated fixture')
      },
    },
  })
  const owner: { repository?: VaultStoreRepository } = {}
  const handle = await createVaultBrokerProcess(context, {
    ...base,
    audit: (repository) => {
      owner.repository = repository
      return base.audit(repository)
    },
  })
  const connect = async () =>
    await VaultBrokerClient.open(
      (await platform.discovery.discover(platform.process.identity)) ?? handle.location,
      hostId,
      hostSession,
      platform.peers,
    )
  const session = new VaultManageSession(connect)
  return {
    context,
    home,
    entries,
    checkpoint,
    secrets,
    platform,
    base,
    handle,
    hostId,
    hostSession,
    connect,
    session,
    owner,
  }
}

describe.skipIf(process.platform === 'win32')('installed POSIX binding composition', () => {
  it('sets up once, unlocks, stores, reads privately, locks, imports Keep/Delete and resets the anchored lost vault', async () => {
    const f = await composition()
    const value = randomBytes(32)
    const origin = 'https://generated.example.test'
    try {
      const uncreated = await f.session.snapshot()
      expect(uncreated.status.state).toBe('uncreated')
      const shown = await f.session.setup()
      expect(shown.code.toString('ascii')).toMatch(/^[a-f0-9]{40}$/u)
      const setupPending = await f.session.snapshot()
      expect(setupPending.status.state).toBe('setupPending')
      shown.code.fill(0)
      await f.session.confirmSetup(shown.setupId)
      await f.session.lock()
      await f.session.unlock(null)
      await f.session.write(
        {
          metadata: {
            ...metadata(),
            kind: 'apiKey',
            hidden: true,
            firstParty: true,
            policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
            bindings: [{ kind: 'origin', origin }],
          },
          material: { kind: 'apiKey', value, origin, auth: 'bearer' },
        },
        false,
      )
      const client = await f.connect()
      try {
        const read = await client.firstPartyRead(
          vaultPrivateReadSchema.parse({
            v: 2,
            kind: 'firstPartyRead',
            itemId: metadata().id,
            origin,
            client: 'provider',
          }),
        )
        expect(read.equals(value)).toBe(true)
        read.fill(0)
        const scrubbed = await client.send({ kind: 'scrub', text: value.toString('base64') })
        expect(scrubbed.kind).toBe('scrubbed')
        expect(JSON.stringify(scrubbed)).not.toContain(value.toString('base64'))
      } finally {
        client.close()
      }
      const ciphertext = await readFile(path.join(f.context.dataDir, 'vault.v1'))
      expect(ciphertext.includes(value)).toBe(false)
      const file = path.join(f.home, '.git-credentials')
      const secret = randomBytes(16).toString('hex')
      await writeFile(file, `https://generated-user:${secret}@example.test\n`, { mode: 0o600 })
      const kept = await f.session.importFile(file)
      expect(JSON.stringify(kept)).not.toContain(secret)
      await f.session.keepImport(kept.receipt)
      const retained = await stat(file)
      expect(retained.isFile()).toBe(true)
      await writeFile(
        file,
        `https://generated-user:${randomBytes(16).toString('hex')}@other.example.test\n`,
        { mode: 0o600 },
      )
      const deleted = await f.session.importFile(file)
      await f.session.deleteImport(deleted.receipt)
      await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      await f.session.lock()
      await rm(path.join(f.context.dataDir, 'slots.v1'))
      const lost = await f.session.snapshot()
      expect(lost.status.reason).toBe('vaultLost')
      const reset = await f.session.resetBegin()
      expect(reset.word).toBe(VAULT_RESET_WORD)
      await f.session.resetConfirm(reset.resetId, reset.word)
      expect(f.entries.has(VAULT_ANCHOR_ACCOUNT)).toBe(false)
      const resetState = await f.session.snapshot()
      expect(resetState.status.state).toBe('uncreated')
      const replacement = await f.session.setup()
      replacement.code.fill(0)
      await f.session.confirmSetup(replacement.setupId)
      const recreated = await f.session.snapshot()
      expect(recreated.status.state).toBe('unlocked')
      const auditVaults = await readdir(path.join(f.context.dataDir, 'audit'))
      expect(auditVaults).toHaveLength(2)
    } finally {
      value.fill(0)
      for (const secret of f.secrets.values()) secret.fill(0)
      await f.handle.close()
    }
  })
  it('a trusted transport reads through a persisted bounded grant; missing transports remain denied', async () => {
    const f = await composition()
    const value = randomBytes(32)
    const broker = seen.broker
    if (!broker) throw new Error('composition did not construct the production broker')
    try {
      const shown = await f.session.setup()
      shown.code.fill(0)
      await f.session.confirmSetup(shown.setupId)
      const target = use()
      const binding = {
        kind: 'environment' as const,
        commandDigest: vaultCommandDigest(target.command),
        names: target.names,
      }
      await f.session.write(
        {
          metadata: {
            ...metadata(),
            bindings: [binding],
            policy: { ...metadata().policy, mode: 'alwaysAllow' },
          },
          material: { kind: 'secret', value },
        },
        false,
      )
      await f.session.grant({ ...grant(), target: binding })
      const req = { ...requester(), peerProcessId: process.pid, hostId: f.hostId }
      const peer = {
        hostId: f.hostId,
        processId: process.pid,
        userId: String(process.getuid?.()),
        ui: true,
      }
      // The transport's known provenance is supplied in-process; no wire claim can clear taint.
      await broker.register(peer, req, 'ask')
      const result = await broker.request(req, metadata().handle, target, {
        tainted: false,
        reasons: [],
      })
      expect(result.kind).toBe('ticket')
      if (result.kind !== 'ticket') throw new Error('grant was not admitted')
      const lease = { close: vi.fn(), terminate: () => Promise.resolve(false) }
      const redeemed = await broker.redeem(req.id, result.ticket, target, lease)
      expect(redeemed.kind).toBe('ticket')
      await broker.withApprovedMaterial(result.ticket.id, req.id, target, async (item) => {
        expect(item.material.kind).toBe('secret')
        if (item.material.kind === 'secret')
          expect(Buffer.from(item.material.value).equals(value)).toBe(true)
        await Promise.resolve()
      })
      await broker.finish(result.ticket.id, true)
      const used = await f.session.snapshot()
      expect(used.grants[0]?.uses).toBe(1)
      const audit = await f.session.audit()
      expect(audit.length).toBeGreaterThan(0)
      expect(f.base.ceiling(req)).toBe('none')
      await expect(f.base.taint(req)).rejects.toThrow(UI_TEXT.vault.noAccess)
    } finally {
      value.fill(0)
      await f.handle.close()
    }
  })
  for (const interruption of [
    'beforeStore',
    'beforeCommit',
    'afterStore',
    'afterCheckpoint',
  ] as const) {
    it(`recovers the protected audit intent after an interruption ${interruption}`, async () => {
      const f = await composition(interruption)
      const material = randomBytes(32)
      let restarted: Awaited<ReturnType<typeof createVaultBrokerProcess>> | undefined
      try {
        const setup = await f.session.setup()
        setup.code.fill(0)
        await f.session.confirmSetup(setup.setupId)
        await f.session.write(
          { metadata: metadata(), material: { kind: 'secret', value: material } },
          false,
        )
        const broker = seen.broker
        if (!broker) throw new Error('generated broker was not composed')
        const req = { ...requester(), peerProcessId: process.pid, hostId: f.hostId }
        await broker.register(
          {
            hostId: f.hostId,
            processId: process.pid,
            userId: String(process.getuid?.()),
            ui: true,
          },
          req,
          'ask',
        )
        if (interruption === 'beforeCommit') {
          const repository = f.owner.repository
          if (!repository) throw new Error('generated audit repository missing')
          vi.spyOn(repository.current(), 'commitAudit').mockImplementationOnce(() => {
            f.checkpoint.didInterrupt = true
            return Promise.reject(new VaultStoreUnavailableError())
          })
        }
        f.checkpoint.shouldInterrupt = true
        await expect(
          broker.request(req, metadata().handle, use(), {
            tainted: false,
            reasons: [],
          }),
        ).rejects.toThrow('storeUnavailable')
        expect(f.checkpoint.didInterrupt).toBe(true)
        expect(hasProtectedIntent(f.entries)).toBe(true)
        await f.handle.close()
        restarted = await createVaultBrokerProcess(f.context, f.base)
        await f.session.unlock(null)
        const audit = await f.session.audit()
        expect(audit).toHaveLength(interruption === 'beforeStore' ? 0 : 1)
        expect(hasProtectedIntent(f.entries)).toBe(false)
        expect(await f.session.audit()).toEqual(audit)
        const repository = f.owner.repository
        if (!repository) throw new Error('generated audit repository missing')
        // The new factory supplies its own repository; its persisted slot/checkpoint agree on reopen.
        const reopened = await f.session.snapshot()
        expect(reopened.status.state).toBe('unlocked')
      } finally {
        material.fill(0)
        await restarted?.close()
        await f.handle.close()
        f.platform.dispose?.()
      }
    })
  }
  it('refuses an independently advanced store audit checkpoint even when protected checkpoint and audit file still agree', async () => {
    const f = await composition()
    try {
      const shown = await f.session.setup()
      shown.code.fill(0)
      await f.session.confirmSetup(shown.setupId)
      const audit = await f.session.audit()
      expect(audit).toEqual([])
      const repository = f.owner.repository
      if (!repository) throw new Error('audit binding did not receive its real repository')
      const store = repository.current()
      const snapshot = await store.exportSnapshot()
      // An independently advanced store without a matching protected intent must refuse.
      await store.commitAudit(snapshot.slots.auditGeneration + 1, 'f'.repeat(64))
      await expect(f.session.audit()).rejects.toThrow()
    } finally {
      await f.handle.close()
    }
  })
  it('requires exact executable and user identity at the host binding', async () => {
    const f = await composition()
    try {
      const identity = await f.platform.process.identity(process.pid)
      expect(
        await isPosixVaultHost(f.context.runDirectory, identity, f.hostId, f.hostSession),
      ).toBe(true)
      expect(
        await isPosixVaultHost(
          f.context.runDirectory,
          { ...identity, executable: identity.executable + '.other' },
          f.hostId,
          f.hostSession,
        ),
      ).toBe(false)
      expect(
        await isPosixVaultHost(
          f.context.runDirectory,
          { ...identity, userId: identity.userId + '0' },
          f.hostId,
          f.hostSession,
        ),
      ).toBe(false)
      await expect(
        f.base.identify(
          { ...identity, executable: identity.executable + '.other' },
          f.hostId,
          f.hostSession,
        ),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
      // A self-consistent foreign-user record still cannot grant this user's binding authority.
      const foreign = { ...identity, userId: identity.userId + '0' }
      const record = path.join(f.context.runDirectory, 'hosts', f.hostId)
      await writeFile(
        record,
        JSON.stringify({ ...foreign, hostId: f.hostId, hostSession: f.hostSession }),
        { mode: 0o600 },
      )
      const probe = vi.spyOn(nativeModule, 'vaultProcessIdentity').mockResolvedValue(foreign)
      try {
        await expect(f.base.identify(foreign, f.hostId, f.hostSession)).rejects.toThrow(
          UI_TEXT.vault.noAccess,
        )
      } finally {
        probe.mockRestore()
      }
    } finally {
      await f.handle.close()
      f.platform.dispose?.()
    }
  })
  it('refuses registration when the native process user differs from the binding user', async () => {
    const f = await composition()
    const identity = await f.platform.process.identity(process.pid)
    const probe = vi
      .spyOn(nativeModule, 'vaultProcessIdentity')
      .mockResolvedValue({ ...identity, userId: identity.userId + '0' })
    try {
      await expect(
        registerPosixVaultHost(
          f.context.runDirectory,
          vaultPeerExecutable(native.root),
          'd'.repeat(32),
          f.hostSession,
        ),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(await readdir(path.join(f.context.runDirectory, 'hosts'))).not.toContain(
        'd'.repeat(32),
      )
    } finally {
      probe.mockRestore()
      await f.handle.close()
      f.platform.dispose?.()
    }
  })
  it('refuses discovery repair for a live owner with a malformed boot token', async () => {
    const f = await composition()
    try {
      await writeFile(path.join(f.platform.discovery.directory, 'boot-token'), 'malformed', {
        mode: 0o600,
      })
      await expect(f.platform.discovery.discover(f.platform.process.identity)).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(await stat(path.join(f.platform.discovery.directory, 'broker.lock'))).toBeDefined()
    } finally {
      await f.handle.close()
      f.platform.dispose?.()
    }
  })
  it('keeps the public availability switch off and refuses unregistered, wrong-session and stale-birth peers', async () => {
    const f = await composition()
    try {
      expect(VAULT_AVAILABILITY.isBrokerAvailable).toBe(false)
      await expect(
        vaultClientPlatform({
          dataDir: f.context.dataDir,
          distDir: path.join(native.root, 'dist'),
          hostId: f.hostId,
          hostSession: f.hostSession,
        }),
      ).rejects.toThrow(UI_TEXT.vault.brokerDisabled)
      await expect(
        VaultBrokerClient.open(f.handle.location, 'e'.repeat(32), f.hostSession, f.platform.peers),
      ).rejects.toThrow()
      await expect(
        VaultBrokerClient.open(f.handle.location, f.hostId, 'f'.repeat(32), f.platform.peers),
      ).rejects.toThrow()
      const identity = await f.platform.process.identity(process.pid)
      await expect(
        f.base.identify(
          { ...identity, startedAt: identity.startedAt + 1 },
          f.hostId,
          f.hostSession,
        ),
      ).rejects.toThrow()
      const snapshot = await f.session.snapshot()
      expect(snapshot.status.state).toBe('uncreated')
    } finally {
      await f.handle.close()
    }
  })
})
