import {
  createVaultBrokerProcess,
  defaultBrokerSlots,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import { VaultStoreUnavailableError } from '../../../../src/core/vault/broker/ports'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { holdBrokerSocket, parseBrokerChildContext } from './brokerChildSetup'
// A staged package carries no node_modules, so the OS keyring binding is
// genuinely absent here: the broker must still start its channel, with the
// OS-store tier reporting storeUnavailable per operation.
void runVaultBrokerEntry(async () => {
  const context = parseBrokerChildContext()
  const bindings = await createVaultBrokerBindings(context)
  const handle = await createVaultBrokerProcess(context, bindings)
  await holdBrokerSocket(handle)
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
