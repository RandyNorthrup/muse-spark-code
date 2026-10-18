import {
  createVaultBrokerProcess,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import process from 'node:process'
import { announceBrokerFixture, parseBrokerFixtureContext } from './sessionBrokerHarness'
// A staged package carries no node_modules, so the OS keyring binding is
// genuinely absent here: the broker must still start its channel, with the
// OS-store tier reporting storeUnavailable per operation.
void runVaultBrokerEntry(async () => {
  const context = parseBrokerFixtureContext()
  const bindings = await createVaultBrokerBindings(context)
  const handle = await createVaultBrokerProcess(context, bindings)
  await announceBrokerFixture(handle)
  return handle
}).catch(() => {
  process.exitCode = 1
})
