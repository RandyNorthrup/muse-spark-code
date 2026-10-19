import process from 'node:process'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import * as z from 'zod/mini'

const brokerChildContextSchema = z.strictObject({
  dataDir: z.string(),
  runDirectory: z.string(),
  installRoot: z.string(),
  userSession: z.string(),
})

export type BrokerChildContext = z.infer<typeof brokerChildContextSchema>

/** Parse this fixture child's context: only generated paths and process facts. */
export function parseBrokerChildContext(): BrokerChildContext {
  return brokerChildContextSchema.parse(JSON.parse(process.argv[2] ?? 'null'))
}

/**
 * Hold the broker socket from inside the child: test ownership, including
 * delayed authentication, ends only with the test's signal.
 */
export async function holdBrokerSocket(handle: {
  readonly location: { readonly lock: { readonly socket: string } }
  readonly closed: Promise<unknown>
}): Promise<void> {
  const keepAlive = createConnection(handle.location.lock.socket)
  await once(keepAlive, 'connect')
  void handle.closed
    .finally(() => keepAlive.destroy())
    .catch(() => {
      process.exitCode = 1
    })
}
