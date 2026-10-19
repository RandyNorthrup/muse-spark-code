import {
  createVaultBrokerProcess,
  runVaultBrokerEntry,
} from '../../../../src/runtime/vault/vaultBrokerEntry'
import { createVaultBrokerBindings } from '../../../../src/runtime/vault/brokerBindings'
import { memoryKeyring } from '../keyring'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { holdBrokerSocket, parseBrokerChildContext } from './brokerChildSetup'
// Only generated fixture paths and process facts, no credential or model access.
void runVaultBrokerEntry(async () => {
  const context = parseBrokerChildContext()
  const gate = path.join(context.installRoot, 'gate')
  try {
    await readFile(gate)
    await writeFile(path.join(context.installRoot, 'spawned'), String(process.pid))
    while ((await readFile(gate, 'utf8')) === 'wait') await delay(10)
  } catch {
    /* This fixture does not gate ordinary startup. */
  }
  const bindings = await createVaultBrokerBindings(context, { keyring: memoryKeyring().openEntry })
  const handle = await createVaultBrokerProcess(context, bindings)
  await holdBrokerSocket(handle)
  process.send?.({ ready: true })
  // This intentionally writes through inherited pipes too; closed readers must be harmless.
  process.stderr.write('vault-audit-refused\n')
  return handle
}).catch(() => {
  process.exitCode = 1
})
