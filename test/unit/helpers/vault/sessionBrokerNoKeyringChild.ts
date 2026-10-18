import {
  createVaultBrokerProcess,
  defaultBrokerSlots,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import { VaultStoreUnavailableError } from '../../../../src/core/vault/broker/ports'
import { randomBytes } from 'node:crypto'
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
  // The broker's own per-operation degradation, asserted in process: with
  // no binding installed the OS-store tier refuses instead of working. A
  // success here means the binding resolved after all, so refuse startup.
  const slots = defaultBrokerSlots({ installRoot: context.installRoot }, () => Promise.resolve([]))
  const key = randomBytes(32)
  try {
    await slots.osStore(randomBytes(16).toString('hex'), randomBytes(16).toString('hex')).wrap(key)
  } catch (error: unknown) {
    if (!(error instanceof VaultStoreUnavailableError)) throw error
    process.send?.({ ready: true })
    return handle
  } finally {
    key.fill(0)
  }
  throw new Error('osStore.wrap succeeded without the keyring binding')
}).catch(() => {
  process.exitCode = 1
})
