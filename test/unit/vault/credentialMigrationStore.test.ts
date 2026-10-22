// Real native credential store -> controller -> authenticated Windows
// broker -> encrypted vault, including rotation and sign-out. A unique
// service owns only this run's generated entries; no person's key is read.
// No file/Map store, anchor, broker or editor substitute participates.
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { chatgptSubscriptionMigrationCredential } from '../../../src/core/vault/migrate/chatgptSubscription'
import { providerCredentialMigrationCredential } from '../../../src/core/vault/migrate/providerCredentials'
import { CredentialMigrationController } from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'
import { saveProviderCredential } from '../../../src/host/providers/credentialRecords'
import { secretStorageAccountVault } from '../../../src/host/providers/accountSecrets'
import { UI_TEXT } from '../../../src/shared/constants'
import { recordingLogger } from '../helpers/recordingLogger'
import {
  assertMigratedSlot,
  chatgptSeeds,
  driveRetireCase,
  driveSlotCase,
  expectOriginRefused,
  openMigrationSession,
  pooledAccountSeeds,
} from '../helpers/vault/subscriptionMigrationFlow'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'

const ORIGIN = 'https://openrouter.ai'
const PROVIDER = 'openrouter'
const CHATGPT_ORIGIN = 'https://api.openai.com'
const POOLED_ACCOUNT = 'work'
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
        const { session, secrets, reader } = await openMigrationSession({
          connect: current.connect,
          lockScope: current.hostId,
          fresh: false,
        })
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
        const assertMigrated = (expected: string) =>
          assertMigratedSlot({
            reader,
            session,
            codec,
            secrets,
            shell,
            origin: ORIGIN,
            expected,
            isLegacyPresent: true,
          })
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
          await expectOriginRefused({
            reader,
            itemId: codec.itemId,
            origin: 'https://api.meta.ai',
            message: 'a different origin must not read the opaque record',
          })

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

    it(
      'probes the chatgpt slot, migrates its tokens, rotates them and removes both copies',
      async () => {
        const current = currentFixture()
        // The providers seam answers no providers: a slot that still
        // migrates proves the controller probed it itself.
        await driveSlotCase({
          connect: current.connect,
          lockScope: current.hostId,
          fresh: false,
          codec: chatgptSubscriptionMigrationCredential(Date.now),
          origin: CHATGPT_ORIGIN,
          providers: [],
          ...chatgptSeeds(),
        })
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'lists the pooled slot from the account pool and migrates it like any slot',
      async () => {
        const current = currentFixture()
        await driveSlotCase({
          connect: current.connect,
          lockScope: current.hostId,
          fresh: false,
          codec: accountSecretMigrationCredential(PROVIDER, POOLED_ACCOUNT, Date.now),
          origin: ORIGIN,
          providers: [PROVIDER],
          pool: {
            file: path.join(current.root, 'pooled', 'providers.json'),
            provider: PROVIDER,
            origin: ORIGIN,
            accounts: ['default', POOLED_ACCOUNT],
          },
          ...pooledAccountSeeds(PROVIDER, POOLED_ACCOUNT, ORIGIN),
        })
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'retires the legacy entry when due and keeps reading from the vault',
      async () => {
        const current = currentFixture()
        await driveRetireCase({
          connect: current.connect,
          lockScope: current.hostId,
          fresh: false,
        })
      },
      FLOW_TIMEOUT_MS,
    )
  },
)
