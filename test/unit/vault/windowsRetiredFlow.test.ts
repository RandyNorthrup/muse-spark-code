// A retired credential on Windows: undo, a killed undo and a reset, through the
// real native credential store and the real broker, each in a vault of its own.
// A unique service owns only each run's generated entries; no person's key is read.
//
// Each case starts its own fixture, as the POSIX suite gives each of these a client
// of its own (chatgptSubscriptionMigration). In one shared vault they meet what the
// retire case left: the journal outlives a case, and run 41561620943's three reds
// began with `expected [ 'museSpark.provider.chatgpt' ] to deeply equal []`. They are
// a file of their own because the shard holding credentialMigrationStore already takes
// 16 of its job's 20 minutes (docs/certification/cc-winfix4.md).
import { describe, it } from 'vitest'
import { vaultBrokerDataDir } from '../../../src/runtime/vault/vaultStoreScope'
import {
  driveResetCase,
  driveUndoCrashCase,
  driveUndoRetiredCase,
} from '../helpers/vault/retiredUndoFlow'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'

// The same complete real-helper flow deadline as windowsVaultPanelFlow, the fixture's start included.
const FLOW_TIMEOUT_MS = 300_000

async function withOwnVault(
  prefix: string,
  work: (own: WindowsBrokerFixture) => Promise<void>,
): Promise<void> {
  const own = await startWindowsBrokerFixture(prefix)
  try {
    await work(own)
  } finally {
    await own.dispose()
  }
}

describe.skipIf(process.platform !== 'win32')(
  'a retired credential through the real broker, each in a vault of its own',
  () => {
    it(
      'undoes a retired entry byte-exact and refuses an emptied or changed one in words',
      async () => {
        await withOwnVault('vs-wundo-', async (own) => {
          await driveUndoRetiredCase({
            connect: own.connect,
            lockScope: own.hostId,
            fresh: true,
          })
        })
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'finishes a retired undo that was killed between its steps',
      async () => {
        await withOwnVault('vs-wcrash-', async (own) => {
          await driveUndoCrashCase({
            connect: own.connect,
            lockScope: own.hostId,
            fresh: true,
            dataDir: own.dataDir,
            installRoot: own.root,
          })
        })
      },
      FLOW_TIMEOUT_MS,
    )

    it(
      'deletes retired entries with everything else when a lost vault is reset',
      async () => {
        await withOwnVault('vs-wreset-', async (own) => {
          await driveResetCase({
            connect: own.connect,
            lockScope: own.hostId,
            fresh: true,
            brokerDataDir: vaultBrokerDataDir(own.dataDir),
          })
        })
      },
      FLOW_TIMEOUT_MS,
    )
  },
)
