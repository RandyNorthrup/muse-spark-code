// Real native credential store -> controller -> authenticated Windows
// broker -> encrypted vault, including rotation and sign-out. A unique
// service owns only this run's generated entries; no person's key is read.
// No file/Map store, anchor, broker or editor substitute participates.
import { AsyncEntry } from '@napi-rs/keyring'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { VaultFirstPartyReader } from '../../../src/core/vault/broker/firstParty'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { eraseItem } from '../../../src/core/vault/migrate/material'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { CredentialMigrationController } from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'
import { saveProviderCredential } from '../../../src/host/providers/credentialRecords'
import { secretStorageAccountVault } from '../../../src/host/providers/accountSecrets'
import { keyringSecretStore } from '../../../src/runtime/keyStore'
import { UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import { recordingLogger } from '../helpers/recordingLogger'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'

const ORIGIN = 'https://openrouter.ai'
const PROVIDER = 'openrouter'
const fixture = { current: undefined as WindowsBrokerFixture | undefined }
// The same complete real-helper flow deadline as windowsVaultPanelFlow.
const FLOW_TIMEOUT_MS = 300_000

function currentFixture(): WindowsBrokerFixture {
  const current = fixture.current
  if (current === undefined) throw new Error('the Windows broker fixture did not start')
  return current
}

describe.skipIf(process.platform !== 'win32')(
  'credential migration through the real broker',
  () => {
    beforeAll(async () => {
      fixture.current = await startWindowsBrokerFixture('vs-wmigration-')
    })
    afterAll(async () => {
      await fixture.current?.dispose()
    })

    it(
      'verifies opaque records, rotates kinds, survives lock and removes both copies',
      async () => {
        const current = currentFixture()
        const session = new VaultManageSession(current.connect, encodeVaultMaterial)
        const setup = await session.setup()
        try {
          await session.confirmSetup(setup.setupId)
        } finally {
          setup.code.fill(0)
        }
        const service = `Muse RLM109 ${randomBytes(16).toString('hex')}`
        const secrets = keyringSecretStore(
          (_service, account) => new AsyncEntry(service, account),
          { lockScope: current.hostId },
        )
        const reader = new VaultFirstPartyReader(current.connect)
        const { log, logged } = recordingLogger()
        let shouldLockAfterRemoval = false
        const active = new CredentialMigrationController({
          secrets,
          listProviderIds: () => Promise.resolve([PROVIDER]),
          ports: {
            snapshot: () => session.snapshot(),
            write: (...args) => session.write(...args),
            remove: async (...args) => {
              await session.remove(...args)
              // A controlled schedule, never a substituted failure: Lock
              // reaches the actual broker between kind replacement's two
              // real operations, so its next write must really refuse.
              if (!shouldLockAfterRemoval) return
              shouldLockAfterRemoval = false
              await session.lock()
            },
            firstPartyRead: (...args) => reader.read(...args),
          },
          minorRelease: () => 19,
          now: Date.now,
          log,
          label: UI_TEXT.vault.secret,
        })
        const shell = createMigrationShell(secrets)
        shell.bind(active)
        const codec = providerCredentialMigrationCredential(PROVIDER, Date.now)
        const readBack = () =>
          reader.read({
            v: VAULT_PROTOCOL_VERSION,
            kind: 'firstPartyRead',
            itemId: codec.itemId,
            origin: ORIGIN,
            client: 'provider',
          })
        const assertMigrated = async (expected: string): Promise<void> => {
          const bytes = await readBack()
          const item = codec.decode(Buffer.from(expected))
          try {
            if (item.material.kind !== 'apiKey' && item.material.kind !== 'secret')
              throw new Error('the installed codec returned a different material kind')
            expect(Buffer.from(item.material.value).equals(bytes)).toBe(true)
            expect((await secrets.get(codec.key)) === expected).toBe(true)
            const snapshot = await session.snapshot()
            const metadata = snapshot.items.find((entry) => entry.id === codec.itemId)
            expect(metadata?.kind).toBe(item.material.kind)
            expect(metadata?.hidden).toBe(true)
            expect(metadata?.firstParty).toBe(true)
            expect(metadata?.policy.mode).toBe('never')
          } finally {
            bytes.fill(0)
            eraseItem(item)
          }
        }
        try {
          const apiKey = {
            v: 1 as const,
            auth: 'apiKey' as const,
            origin: ORIGIN,
            secret: randomBytes(32).toString('hex'),
          }
          await saveProviderCredential(secrets, PROVIDER, apiKey)
          await active.ensureMigrated()
          await assertMigrated(JSON.stringify(apiKey))

          for (const auth of ['oauth', 'subscription'] as const) {
            const record = {
              v: 1 as const,
              auth,
              origin: ORIGIN,
              secret: randomBytes(32).toString('hex'),
            }
            await saveProviderCredential(shell.store, PROVIDER, record)
            await assertMigrated(JSON.stringify(record))
            await active.ensureMigrated()
            await assertMigrated(JSON.stringify(record))
          }
          shouldLockAfterRemoval = true
          await saveProviderCredential(shell.store, PROVIDER, apiKey)
          expect(shouldLockAfterRemoval).toBe(false)
          const interrupted = await session.snapshot()
          expect(interrupted.status.state).toBe('locked')
          expect((await secrets.get(codec.key)) === JSON.stringify(apiKey)).toBe(true)
          await session.unlock(null)
          await active.ensureMigrated()
          await assertMigrated(JSON.stringify(apiKey))

          const binding = { provider: PROVIDER, account: 'default', origin: ORIGIN }
          const account = {
            ...binding,
            v: 1 as const,
            auth: 'apiKey' as const,
            secret: randomBytes(32).toString('hex'),
          }
          await shell.store.delete(codec.key)
          expect((await secrets.get(codec.key)) === undefined).toBe(true)
          await secretStorageAccountVault(shell.store).write(binding, account)
          await assertMigrated(JSON.stringify(account))
          await session.lock()
          await session.unlock(null)
          await active.ensureMigrated()
          await assertMigrated(JSON.stringify(account))
          let isOriginRefused = false
          try {
            const unexpected = await reader.read({
              v: VAULT_PROTOCOL_VERSION,
              kind: 'firstPartyRead',
              itemId: codec.itemId,
              origin: 'https://api.meta.ai',
              client: 'provider',
            })
            unexpected.fill(0)
          } catch (error: unknown) {
            if (!(error instanceof Error)) throw error
            isOriginRefused = true
          }
          expect(isOriginRefused, 'a different origin must not read the opaque record').toBe(true)

          await shell.store.delete(codec.key)
          expect((await secrets.get(codec.key)) === undefined).toBe(true)
          const signedOut = await session.snapshot()
          expect(signedOut.items.some((entry) => entry.id === codec.itemId)).toBe(false)
          expect(
            logged.filter((line) => line.startsWith('warn:') || line.startsWith('error:')),
          ).toEqual([])
        } finally {
          await secrets.delete(codec.key)
        }
      },
      FLOW_TIMEOUT_MS,
    )
  },
)
