import {
  createVaultBrokerProcess,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import process from 'node:process'
import * as z from 'zod/mini'
import { createConnection } from 'node:net'
import { once } from 'node:events'
// A staged package carries no node_modules, so the OS keyring binding is
// genuinely absent here: the broker must still start its channel, with the
// OS-store tier reporting storeUnavailable per operation.
void runVaultBrokerEntry(async () => {
  const context = z
    .strictObject({
      dataDir: z.string(),
      runDirectory: z.string(),
      installRoot: z.string(),
      userSession: z.string(),
    })
    .parse(JSON.parse(process.argv[2] ?? 'null'))
  const bindings = await createVaultBrokerBindings(context)
  const handle = await createVaultBrokerProcess(context, bindings)
  // Test ownership, including delayed authentication: only the test's signal ends this fixture.
  const keepAlive = createConnection(handle.location.lock.socket)
  await once(keepAlive, 'connect')
  void handle.closed
    .finally(() => keepAlive.destroy())
    .catch(() => {
      process.exitCode = 1
    })
  process.send?.({ ready: true })
  // This intentionally writes through inherited pipes too; closed readers must be harmless.
  process.stderr.write('vault-audit-refused\n')
  return handle
}).catch(() => {
  process.exitCode = 1
})
