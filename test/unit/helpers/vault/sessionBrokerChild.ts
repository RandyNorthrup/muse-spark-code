import {
  configureBrokerResources,
  createVaultBrokerProcess,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { announceBrokerFixture, parseBrokerFixtureContext } from './sessionBrokerHarness'
// Session broker fixture: the installed entry's own governor wiring over the
// generated fixture paths, then the product's keyring resolution with no
// override — the real OS store where the binding resolves, the product's
// keyring-less fallback where it does not. Only generated fixture paths and
// process facts, no credential or model access.
const lifecycle: { dispose?: () => void } = {}
void runVaultBrokerEntry(async () => {
  const context = parseBrokerFixtureContext()
  const gate = path.join(context.installRoot, 'gate')
  try {
    await readFile(gate)
    await writeFile(path.join(context.installRoot, 'spawned'), String(process.pid))
    while ((await readFile(gate, 'utf8')) === 'wait') await delay(10)
  } catch {
    /* This fixture does not gate ordinary startup. */
  }
  lifecycle.dispose = await configureBrokerResources(
    context,
    () => import('../../../../src/core/resources/resourceGovernorEntry'),
  )
  const bindings = await createVaultBrokerBindings(context)
  const handle = await createVaultBrokerProcess(context, bindings)
  await announceBrokerFixture(handle)
  return handle
})
  .finally(() => {
    lifecycle.dispose?.()
  })
  .catch(() => {
    process.exitCode = 1
  })
