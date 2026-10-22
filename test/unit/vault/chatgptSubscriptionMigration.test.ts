// The subscription and pooled-account slots through the real native
// credential store, the migration controller and the authenticated POSIX
// broker into the encrypted vault: probed or pool-listed (never listed by
// the providers seam), copied, verified, rotated, locked/unlocked and
// signed out. A unique service owns only this run's generated entries; no
// person's key is read, and the generated tokens are never issued or sent
// anywhere: no sign-in, refresh or provider call runs. No file/Map store,
// anchor, broker or editor substitute participates.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { accountSecretMigrationCredential } from '../../../src/core/vault/migrate/accountSecrets'
import { chatgptSubscriptionMigrationCredential } from '../../../src/core/vault/migrate/chatgptSubscription'
import { vaultPeerExecutable } from '../../../src/runtime/vault/posixNative'
import { shouldSkipPosixBrokerSuite } from '../helpers/vault/socketFit'
import {
  chatgptSeeds,
  driveSlotCase,
  expectOriginRefused,
  pooledAccountSeeds,
} from '../helpers/vault/subscriptionMigrationFlow'
import {
  startPosixPanelFixture,
  type PosixPanelClient,
  type PosixPanelFixture,
} from '../helpers/vault/posixPanelFixture'

const ORIGIN = 'https://api.openai.com'
const POOLED_PROVIDER = 'openrouter'
const POOLED_ACCOUNT = 'work'
const POOLED_ORIGIN = 'https://openrouter.ai'
const fixture = { current: undefined as PosixPanelFixture | undefined }
// The same complete real-helper flow deadline as windowsVaultPanelFlow.
const FLOW_TIMEOUT_MS = 300_000

/** One case over its own fresh client, ended afterwards. */
async function withClient(
  name: string,
  work: (client: PosixPanelClient, root: string) => Promise<void>,
): Promise<void> {
  const current = fixture.current
  if (current === undefined) throw new Error('the POSIX broker fixture did not start')
  const client = await current.startClient(name)
  try {
    await work(client, current.root)
  } finally {
    await client.dispose()
  }
}

describe.skipIf(shouldSkipPosixBrokerSuite())(
  'chatgpt and pooled migration through the real broker',
  () => {
    beforeAll(async () => {
      fixture.current = await startPosixPanelFixture('vs-pmigration-')
      // One-time OS costs belong in hooks, never in a case: the first exec
      // of the fresh peer binary pays macOS trust evaluation, so warm it
      // here without the governor (raw exec, like the session suites) so no
      // case races that cost against the test timeout.
      execFileSync(vaultPeerExecutable(fixture.current.root), ['identity', String(process.pid)], {
        stdio: 'ignore',
      })
    }, 0)
    afterAll(async () => {
      await fixture.current?.dispose()
    })

    it(
      'probes the slot, migrates it, rotates its tokens, survives lock and removes both copies',
      async () => {
        await withClient('migration', (client) =>
          // The providers seam answers no providers: a slot that still
          // migrates proves the controller probed it itself.
          driveSlotCase({
            connect: client.connect,
            lockScope: client.hostId,
            fresh: true,
            codec: chatgptSubscriptionMigrationCredential(Date.now),
            origin: ORIGIN,
            providers: [],
            ...chatgptSeeds(),
            extra: ({ reader, codec }) =>
              expectOriginRefused({
                reader,
                itemId: codec.itemId,
                origin: 'https://api.meta.ai',
                message: 'a different origin must not read the subscription',
              }),
          }),
        )
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'lists the pooled slot from the account pool and migrates it like any slot',
      async () => {
        await withClient('pooled', (client, root) =>
          driveSlotCase({
            connect: client.connect,
            lockScope: client.hostId,
            fresh: true,
            codec: accountSecretMigrationCredential(POOLED_PROVIDER, POOLED_ACCOUNT, Date.now),
            origin: POOLED_ORIGIN,
            providers: [POOLED_PROVIDER],
            pool: {
              file: path.join(root, 'pooled', 'providers.json'),
              provider: POOLED_PROVIDER,
              origin: POOLED_ORIGIN,
              accounts: ['default', POOLED_ACCOUNT],
            },
            ...pooledAccountSeeds(POOLED_PROVIDER, POOLED_ACCOUNT, POOLED_ORIGIN),
          }),
        )
      },
      FLOW_TIMEOUT_MS,
    )
  },
)
