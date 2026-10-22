// The ChatGPT subscription slot through the real native credential
// store, the migration controller and the authenticated POSIX broker into
// the encrypted vault: probed (never listed by the providers seam),
// copied, verified, rotated, locked/unlocked and signed out. A unique
// service owns only this run's generated entries; no person's key is read,
// and the generated tokens are never issued or sent anywhere: no sign-in,
// refresh or provider call runs. No file/Map store, anchor, broker or
// editor substitute participates.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { VaultManageSession } from '../../../src/core/vault/broker/manageClient'
import { VaultFirstPartyReader } from '../../../src/core/vault/broker/firstParty'
import { encodeVaultMaterial } from '../../../src/core/vault/crypto'
import { chatgptSubscriptionMigrationCredential } from '../../../src/core/vault/migrate/chatgptSubscription'
import { vaultPeerExecutable } from '../../../src/runtime/vault/posixNative'
import { recordingLogger } from '../helpers/recordingLogger'
import { hasBrokerSocketFit } from '../helpers/vault/socketFit'
import {
  confirmBrokerSetup,
  driveSubscriptionMigration,
  expectOriginRefused,
  uniqueKeyringStore,
} from '../helpers/vault/subscriptionMigrationFlow'
import { startPosixPanelFixture, type PosixPanelFixture } from '../helpers/vault/posixPanelFixture'

const ORIGIN = 'https://api.openai.com'
const fixture = { current: undefined as PosixPanelFixture | undefined }
// The same complete real-helper flow deadline as windowsVaultPanelFlow.
const FLOW_TIMEOUT_MS = 300_000

/** This rig's process listing for the broker's exact-birth identity: darwin reads it from /bin/ps. */
function hasProcessListing(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], { stdio: 'ignore' })
    return true
  } catch {
    // A rig that cannot list processes cannot prove process birth, so the
    // broker fail-closes a fresh vault as lost: skip with this reason.
    return false
  }
}

/**
Linux's OS store is the Secret Service, reached over the session bus: a
machine with no session bus (an SSH login, a CI runner) has no store, and
setup rightly refuses with the credential-store sentence. Such a rig skips
with this reason; a desktop session, or a private `dbus-run-session` with
an unlocked keyring, runs the flow.
*/
function hasSessionBus(): boolean {
  return process.platform !== 'linux' || (process.env['DBUS_SESSION_BUS_ADDRESS'] ?? '') !== ''
}

describe.skipIf(
  process.platform === 'win32' || !hasBrokerSocketFit() || !hasProcessListing() || !hasSessionBus(),
)('chatgpt subscription migration through the real broker', () => {
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
      const current = fixture.current
      if (current === undefined) throw new Error('the POSIX broker fixture did not start')
      const client = await current.startClient('migration')
      try {
        const session = new VaultManageSession(client.connect, encodeVaultMaterial)
        await confirmBrokerSetup(session)
        const secrets = uniqueKeyringStore(client.hostId)
        const reader = new VaultFirstPartyReader(client.connect)
        const { log, logged } = recordingLogger()
        const codec = chatgptSubscriptionMigrationCredential(Date.now)
        await driveSubscriptionMigration({
          secrets,
          session,
          reader,
          log,
          logged,
          codec,
          origin: ORIGIN,
          extra: () =>
            expectOriginRefused({
              reader,
              itemId: codec.itemId,
              origin: 'https://api.meta.ai',
              message: 'a different origin must not read the subscription',
            }),
        })
      } finally {
        await client.dispose()
      }
    },
    FLOW_TIMEOUT_MS,
  )
})
