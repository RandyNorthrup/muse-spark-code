// A vault's OS-store records belong to its own root (RLVAULTANCHOR,
// 2026-10-21): the rollback anchor, the audit checkpoint and pending
// intent, and the OS-store slot keys live under accounts derived from the
// canonical broker root, so a vault in a test's folder can never read or
// write the person's real anchor. The broker cases set up for real through
// the panel fixtures and read the store back through the real keyring; the
// store cases drive the anchor and the slot through the real store against
// scratch accounts (the shared pre-scoping anchor itself is snapshotted,
// never written). Every case ends with its records removed.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AsyncEntry } from '@napi-rs/keyring'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { VaultFirstPartyReader } from '../../../src/core/vault/broker/firstParty'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import type { VaultBrokerProcess } from '../../../src/host/vault/brokerProcess'
import { NodeVaultFiles, VaultStore, peekVaultSlotFiles } from '../../../src/core/vault/store'
import { vaultSlotRecordSchema } from '../../../src/shared/vault'
import {
  KEYRING_SERVICE,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
  VAULT_PROTOCOL_VERSION,
} from '../../../src/shared/constants'
import { FileVaultAnchor, vaultAnchorFile } from '../../../src/runtime/vault/fileAnchor'
import { KeyringVaultAnchor } from '../../../src/runtime/vault/keyringAnchor'
import { OsStoreVaultSlot } from '../../../src/runtime/vault/slots/osStoreVaultSlot'
import {
  VAULT_ANCHOR_ACCOUNT,
  legacyVaultAuditAccount,
  legacyVaultAuditPendingAccount,
  legacyVaultSlotReference,
  vaultAnchorAccount,
  vaultAuditAccount,
  vaultAuditPendingAccount,
  vaultBrokerDataDir,
  vaultRootHash,
  vaultSlotReference,
} from '../../../src/runtime/vault/vaultStoreScope'
import { hasBrokerSocketFit } from '../helpers/vault/socketFit'
import { PANEL_FLOW_ORIGIN, panelFirstPartyItem } from '../helpers/vault/panelFlowDriver'
import { removeFolder } from '../helpers/temporaryFolders'
import { startPosixPanelFixture, type PosixPanelFixture } from '../helpers/vault/posixPanelFixture'
import { startWindowsBrokerFixture } from '../helpers/vault/windowsBrokerFixture'

// A genuinely long operation keeps its named timeout with its reason: the
// broker cases launch the real broker and run setup through fresh helpers,
// which takes minutes on a busy rig.
const TEST_TIMEOUT_MS = 180_000
// The broker appends audit rows beside the read that caused them, so the
// checkpoint settles after the read returns; polls below wait for it.
const AUDIT_SETTLE_TIMEOUT_MS = 60_000
// The checkpoint must read back identical across this window before the
// test relocates it, so no append lands mid-move.
const AUDIT_QUIESCE_MS = 1000

/** Linux's OS store is the Secret Service over the session bus; without one there is no store. */
function hasStore(): boolean {
  return process.platform !== 'linux' || (process.env['DBUS_SESSION_BUS_ADDRESS'] ?? '') !== ''
}

function openEntry(account: string): AsyncEntry {
  return process.platform === 'linux'
    ? new AsyncEntry(KEYRING_SERVICE, account, { linux: { store: 'secret-service' } })
    : new AsyncEntry(KEYRING_SERVICE, account)
}

async function readPassword(account: string): Promise<string | null> {
  return (await openEntry(account).getPassword()) ?? null
}

async function removePassword(account: string): Promise<void> {
  const entry = openEntry(account)
  if ((await entry.getPassword()) != null) await entry.deletePassword()
}

/** This vault's id and slot records from the files its broker wrote, parsed with the product's peek. */
async function readVaultFiles(brokerDataDir: string): Promise<{
  vaultId: string
  records: { tier: string; keyReference: string | null }[]
}> {
  const slots = await readFile(path.join(brokerDataDir, 'slots.v1'))
  try {
    const peeked = peekVaultSlotFiles(slots, null)
    if (peeked === null) throw new Error('the broker wrote no slots file')
    const parsed = JSON.parse(slots.toString('utf8')) as {
      records: { tier: string; keyReference: string | null }[]
    }
    return { vaultId: peeked.vaultId, records: parsed.records }
  } finally {
    slots.fill(0)
  }
}

/**
Sets up for real, proves the vault's records live under its own root's
accounts while the shared anchor reads back byte-identical, migrates a
checkpoint moved to the pre-scoping account, and returns what disposal
must remove.
*/
async function driveScopedVault(
  connect: () => ReturnType<VaultBrokerProcess['connect']>,
  clientDataDir: string,
  label: string,
): Promise<{ brokerDataDir: string; vaultId: string; osStoreReference: string | null }> {
  const brokerDataDir = vaultBrokerDataDir(clientDataDir)
  const sharedBefore = await readPassword(VAULT_ANCHOR_ACCOUNT)
  const session = new VaultManageSession(connect, encodeVaultMaterial)
  const fresh = await session.snapshot()
  expect(fresh.status.state, `${label}: fresh root`).toBe('uncreated')
  const { setupId, code } = await session.setup()
  try {
    await session.confirmSetup(setupId)
  } finally {
    code.fill(0)
  }
  const unlocked = await session.snapshot()
  expect(unlocked.status.state, `${label}: setup unlocks`).toBe('unlocked')
  const item = panelFirstPartyItem('b2'.repeat(16), Buffer.from('scope-probe-value'))
  await session.write(item, false)
  const reader = new VaultFirstPartyReader(connect)
  const readBack = async (): Promise<Buffer> =>
    await reader.read({
      v: VAULT_PROTOCOL_VERSION,
      kind: 'firstPartyRead',
      itemId: item.metadata.id,
      origin: PANEL_FLOW_ORIGIN,
      client: 'model',
    })
  const first = await readBack()
  expect(first.equals(Buffer.from('scope-probe-value'))).toBe(true)
  first.fill(0)
  const { vaultId, records } = await readVaultFiles(brokerDataDir)

  // The vault's own accounts hold its records, bound to this vault.
  const anchorRaw = await readPassword(vaultAnchorAccount(brokerDataDir))
  expect(anchorRaw, `${label}: scoped anchor exists`).not.toBeNull()
  expect((JSON.parse(anchorRaw ?? '') as { vaultId: string }).vaultId).toBe(vaultId)
  const checkpointAccount = vaultAuditAccount(brokerDataDir, vaultId)
  let checkpointRaw = ''
  await vi.waitFor(
    async () => {
      const before = await readPassword(checkpointAccount)
      expect(before, `${label}: scoped checkpoint exists`).not.toBeNull()
      await new Promise((resolve) => setTimeout(resolve, AUDIT_QUIESCE_MS))
      const after = await readPassword(checkpointAccount)
      expect(after, `${label}: audit settled`).toBe(before)
      checkpointRaw = before ?? ''
      expect(
        (JSON.parse(checkpointRaw) as { generation: number }).generation,
        `${label}: the read audited`,
      ).toBeGreaterThanOrEqual(1)
    },
    { timeout: AUDIT_SETTLE_TIMEOUT_MS, interval: 100 },
  )
  const checkpoint = JSON.parse(checkpointRaw) as { generation: number }
  expect(
    await readPassword(legacyVaultAuditAccount(vaultId)),
    `${label}: no pre-scoping checkpoint`,
  ).toBeNull()
  const osStore = records.find((record) => record.tier === 'osStore')
  const osStoreReference = osStore?.keyReference ?? null
  if (osStoreReference != null) {
    expect(osStoreReference.startsWith(`vault.${vaultRootHash(brokerDataDir)}.`)).toBe(true)
    expect(
      await openEntry(osStoreReference).getSecret(),
      `${label}: slot key under the scoped reference`,
    ).not.toBeNull()
  }
  // The shared anchor reads back exactly as before, whatever it held.
  expect(await readPassword(VAULT_ANCHOR_ACCOUNT), `${label}: shared anchor untouched`).toBe(
    sharedBefore,
  )

  // A checkpoint moved to the pre-scoping account is adopted and migrated
  // by the next audited read: the bytes are the settled checkpoint above,
  // the product's own, relocated.
  await openEntry(legacyVaultAuditAccount(vaultId)).setPassword(checkpointRaw)
  await openEntry(vaultAuditAccount(brokerDataDir, vaultId)).deletePassword()
  const second = await readBack()
  expect(second.equals(Buffer.from('scope-probe-value'))).toBe(true)
  second.fill(0)
  await vi.waitFor(
    async () => {
      const migratedRaw = await readPassword(vaultAuditAccount(brokerDataDir, vaultId))
      expect(migratedRaw, `${label}: checkpoint migrated back`).not.toBeNull()
      expect(
        (JSON.parse(migratedRaw ?? '') as { generation: number }).generation,
        `${label}: migration keeps history`,
      ).toBeGreaterThanOrEqual(checkpoint.generation)
      expect(await readPassword(legacyVaultAuditAccount(vaultId))).toBeNull()
      expect(await readPassword(legacyVaultAuditPendingAccount(vaultId))).toBeNull()
    },
    { timeout: AUDIT_SETTLE_TIMEOUT_MS, interval: 100 },
  )
  // The log still opens after the migration: any rollback would throw here.
  await session.audit()
  expect(await readPassword(VAULT_ANCHOR_ACCOUNT), `${label}: shared anchor still untouched`).toBe(
    sharedBefore,
  )
  return { brokerDataDir, vaultId, osStoreReference }
}

/** Every record the driven vault wrote is gone; the shared anchor reads back as before. */
async function expectVaultRecordsRemoved(driven: {
  brokerDataDir: string
  vaultId: string
  osStoreReference: string | null
}): Promise<void> {
  expect(await readPassword(vaultAnchorAccount(driven.brokerDataDir))).toBeNull()
  expect(await readPassword(vaultAuditAccount(driven.brokerDataDir, driven.vaultId))).toBeNull()
  expect(
    await readPassword(vaultAuditPendingAccount(driven.brokerDataDir, driven.vaultId)),
  ).toBeNull()
  if (driven.osStoreReference != null)
    expect(await openEntry(driven.osStoreReference).getSecret()).toBeNull()
}

describe.skipIf(process.platform === 'win32' || !hasBrokerSocketFit() || !hasStore())(
  'POSIX vault store scope',
  () => {
    const fixture = { current: undefined as PosixPanelFixture | undefined }
    // The broker staging takes as long as the machine needs: no time limit
    // of ours on this setup (owner 2026-10-16).
    beforeAll(async () => {
      fixture.current = await startPosixPanelFixture('vs-scope-')
    }, 0)
    afterAll(async () => {
      await fixture.current?.dispose()
    })

    it(
      'keeps a vault on its own records and removes them on disposal',
      async () => {
        const current = fixture.current
        if (!current) throw new Error('the client platform did not build')
        const client = await current.startClient('scope')
        const sharedBefore = await readPassword(VAULT_ANCHOR_ACCOUNT)
        try {
          const driven = await driveScopedVault(client.connect, client.dataDir, 'posix')
          await client.dispose()
          await expectVaultRecordsRemoved(driven)
          expect(await readPassword(VAULT_ANCHOR_ACCOUNT)).toBe(sharedBefore)
        } catch (error: unknown) {
          await client.dispose()
          throw error
        }
      },
      TEST_TIMEOUT_MS,
    )
  },
)

describe.skipIf(process.platform !== 'win32')('Windows vault store scope', () => {
  it(
    'keeps a vault on its own records and removes them on disposal',
    async () => {
      const sharedBefore = await readPassword(VAULT_ANCHOR_ACCOUNT)
      // The helper builds take as long as the machine needs; the named
      // case timeout above covers them.
      const fixture = await startWindowsBrokerFixture('vs-scope-')
      try {
        const driven = await driveScopedVault(fixture.connect, fixture.dataDir, 'windows')
        await fixture.dispose()
        await expectVaultRecordsRemoved(driven)
        expect(await readPassword(VAULT_ANCHOR_ACCOUNT)).toBe(sharedBefore)
      } catch (error: unknown) {
        await fixture.dispose()
        throw error
      }
    },
    TEST_TIMEOUT_MS,
  )
})

describe('vault file peek', () => {
  // POSIX-only: the file anchor's owner-only modes are POSIX; on Windows
  // the pipe-helper guard owns them instead.
  it.skipIf(process.platform === 'win32')(
    'reads the vault id and slot references from real vault files',
    async () => {
      // The peek feeds the anchor's startup adoption and the fixtures'
      // teardown: real files from a real setup (recovery slot only, so no OS
      // store), read back through both peek entry points.
      const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'vs-peek-')))
      try {
        const brokerDataDir = path.join(directory, 'vault')
        const files = new NodeVaultFiles(brokerDataDir, VAULT_LIMITS.frameBytes)
        const anchor = new FileVaultAnchor(vaultAnchorFile(brokerDataDir))
        const key = randomBytes(VAULT_KEY_BYTES)
        const vaultId = randomBytes(16).toString('hex')
        try {
          const recovery = createRecoverySlot(key, vaultId, { now: () => Date.now() })
          try {
            const store = await VaultStore.create({ files, anchor, key }, vaultId, [recovery.slot])
            try {
              expect(await VaultStore.peekVaultId(files)).toBe(vaultId)
              const slots = await readFile(path.join(brokerDataDir, 'slots.v1'))
              try {
                const peeked = peekVaultSlotFiles(slots, null)
                expect(peeked?.vaultId).toBe(vaultId)
                expect(peeked?.keyReferences).toEqual(
                  recovery.slot.keyReference === null ? [] : [recovery.slot.keyReference],
                )
              } finally {
                slots.fill(0)
              }
            } finally {
              store.lock()
            }
          } finally {
            recovery.code.fill(0)
          }
        } finally {
          key.fill(0)
        }
      } finally {
        await removeFolder(directory)
      }
      // Corrupt files read as absent, never as another vault: adoption then
      // stays off and the open still fails closed on its own checks.
      expect(peekVaultSlotFiles(Buffer.from('not a vault file'), null)).toBeNull()
      expect(peekVaultSlotFiles(null, null)).toBeNull()
    },
  )
})

describe.skipIf(!hasStore())('vault store record adoption', () => {
  const usable = { current: false }
  beforeAll(async () => {
    // A locked login keychain refuses rather than prompts: these cases run
    // only where the store answers, and skip with this reason elsewhere.
    // The hosts job provisions a store on every platform, so they run there.
    try {
      const probe = `${VAULT_ANCHOR_ACCOUNT}:rlvaultanchor-probe`
      await openEntry(probe).setPassword('probe')
      await openEntry(probe).deletePassword()
      usable.current = true
    } catch {
      usable.current = false
    }
  })

  it('a pre-scoping anchor stays with the vault that owns it', async (context) => {
    if (!usable.current) context.skip()
    const sharedBefore = await readPassword(VAULT_ANCHOR_ACCOUNT)
    const root = await mkdtemp(path.join(tmpdir(), 'vs-adopt-'))
    try {
      // The product's own entry factory shape over the real store.
      const open = (_service: string, account: string) => openEntry(account)
      // Scratch accounts in the real store: the shared anchor itself is
      // snapshotted above and never written here.
      const account = vaultAnchorAccount(root)
      const legacyAccount = `${VAULT_ANCHOR_ACCOUNT}:rlvaultanchor-${randomBytes(8).toString('hex')}`
      const vaultId = randomBytes(16).toString('hex')
      const foreignId = randomBytes(16).toString('hex')
      const first = {
        generation: 1,
        auditGeneration: 0,
        auditHead: '0'.repeat(64),
        stateDigest: '1'.repeat(64),
      }
      const second = { ...first, generation: 2, stateDigest: '2'.repeat(64) }
      try {
        // The legacy record, written the way the product writes one.
        await new KeyringVaultAnchor(open, { account: legacyAccount }).advance(vaultId, first, null)
        const anchor = new KeyringVaultAnchor(open, { account, legacyAccount })
        anchor.adoptLegacyScope(vaultId)
        expect(await anchor.vaultId()).toBe(vaultId)
        expect(await anchor.minimum(vaultId)).toEqual(first)
        // Advances stay on the adopted record; the scoped account is untouched.
        await anchor.advance(vaultId, second, first)
        expect(await readPassword(account)).toBeNull()
        expect(await anchor.minimum(vaultId)).toEqual(second)
        // A vault that does not own the legacy record never sees it.
        const foreign = new KeyringVaultAnchor(open, { account, legacyAccount })
        foreign.adoptLegacyScope(foreignId)
        expect(await foreign.vaultId()).toBeNull()
        expect(await foreign.minimum(foreignId)).toBeNull()
        // Reset removes exactly the adopted record.
        await anchor.reset(vaultId, second, () => undefined)
        expect(await readPassword(legacyAccount)).toBeNull()
        expect(await readPassword(account)).toBeNull()
      } finally {
        await removePassword(account)
        await removePassword(legacyAccount)
      }
    } finally {
      await removeFolder(root)
    }
    expect(await readPassword(VAULT_ANCHOR_ACCOUNT)).toBe(sharedBefore)
  })

  it.skipIf(process.platform === 'win32')(
    'slots wrap scoped references and still open pre-scoping ones',
    async (context) => {
      if (!usable.current) context.skip()
      const root = await mkdtemp(path.join(tmpdir(), 'vs-slot-'))
      try {
        const context = (vaultId: string, slotId: string) => ({
          id: slotId,
          vaultId,
          lastGeneration: 0,
          auditGeneration: 0,
          auditHead: '0'.repeat(64),
          createdAt: Date.now(),
        })
        // A fresh wrap lives under this root's scoped reference and round-trips.
        const vaultId = randomBytes(16).toString('hex')
        const slotId = randomBytes(16).toString('hex')
        const slot = new OsStoreVaultSlot(
          context(vaultId, slotId),
          process.platform,
          undefined,
          root,
        )
        const key = randomBytes(32)
        try {
          const record = await slot.wrap(key)
          expect(record.keyReference).toBe(vaultSlotReference(root, vaultId, slotId))
          const restored = await slot.unwrap(record, 'use')
          try {
            expect(Buffer.from(restored)).toEqual(key)
          } finally {
            restored.fill(0)
          }
          // A pre-scoping reference opens through the same slot: the record
          // is the product's own shape with the pre-scoping reference, and
          // the key beside it is placed in the real store.
          const legacyVaultId = randomBytes(16).toString('hex')
          const legacySlotId = randomBytes(16).toString('hex')
          const legacyReference = legacyVaultSlotReference(legacyVaultId, legacySlotId)
          const legacyKey = randomBytes(32)
          try {
            await openEntry(legacyReference).setSecret(legacyKey)
            const legacyRecord = vaultSlotRecordSchema.parse({
              ...record,
              id: legacySlotId,
              vaultId: legacyVaultId,
              keyReference: legacyReference,
              wrappedKey: Buffer.from(legacyReference, 'ascii').toString('base64'),
            })
            const legacySlot = new OsStoreVaultSlot(
              context(legacyVaultId, legacySlotId),
              process.platform,
              undefined,
              root,
            )
            const legacyRestored = await legacySlot.unwrap(legacyRecord, 'use')
            try {
              expect(Buffer.from(legacyRestored)).toEqual(legacyKey)
            } finally {
              legacyRestored.fill(0)
            }
            // Removal covers both references.
            await legacySlot.remove()
            expect(await openEntry(legacyReference).getSecret()).toBeNull()
          } finally {
            legacyKey.fill(0)
            if ((await openEntry(legacyReference).getSecret()) != null)
              await openEntry(legacyReference).deleteCredential()
          }
          await slot.remove()
          expect(await openEntry(record.keyReference ?? '').getSecret()).toBeNull()
        } finally {
          key.fill(0)
        }
      } finally {
        await removeFolder(root)
      }
    },
  )
})
