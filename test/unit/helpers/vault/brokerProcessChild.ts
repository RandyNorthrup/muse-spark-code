// Fake-only child for real crash/EOF-lock recovery; no credential or model access.
import { startVaultBrokerProcess } from '../../../../src/runtime/vault/brokerProcess'
const runDirectory = process.argv[2]
const helper = process.argv[3]
const dataDir = process.argv[4]
if (!runDirectory || !helper || !dataDir) throw new Error('missing fake child arguments')
const state: { shutdown?: () => Promise<void> } = {}
void startVaultBrokerProcess({
  runDirectory,
  dataDir,
  helper,
  userSession: 'test-session',
  idleMs: 30_000,
  lock: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
  channel: (_location, listener) => ({
    listen: async (socket) => {
      state.shutdown = await listener.listen(socket, (stream) => stream.resume())
    },
    close: async () => {
      await state.shutdown?.()
    },
  }),
})
  .then(async (handle) => {
    process.stdout.write('ready\n')
    process.once('SIGTERM', () => {
      void handle.close()
    })
    await handle.closed
  })
  .catch((error: unknown) => {
    process.stderr.write(
      error instanceof Error ? `${error.stack ?? error.message}\n` : 'fake-broker-failed\n',
    )
    process.exitCode = 1
  })
