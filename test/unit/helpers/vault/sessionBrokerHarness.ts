import { once } from 'node:events'
import { createConnection } from 'node:net'
import process from 'node:process'
import * as z from 'zod/mini'
import type { createVaultBrokerProcess } from '../../../../src/runtime/vault/vaultBrokerEntry'

export interface BrokerFixtureContext {
  readonly dataDir: string
  readonly runDirectory: string
  readonly installRoot: string
  readonly userSession: string
}

/** Only generated fixture paths and process facts, no credential or model access. */
export function parseBrokerFixtureContext(): BrokerFixtureContext {
  return z
    .strictObject({
      dataDir: z.string(),
      runDirectory: z.string(),
      installRoot: z.string(),
      userSession: z.string(),
    })
    .parse(JSON.parse(process.argv[2] ?? 'null'))
}

/** Test ownership, including delayed authentication: only the test's signal ends a fixture. */
export async function announceBrokerFixture(
  handle: Awaited<ReturnType<typeof createVaultBrokerProcess>>,
): Promise<void> {
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
}
