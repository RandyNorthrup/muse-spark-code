import type { Server } from 'node:http'
import type { Server as HttpsServer } from 'node:https'

export async function listenHttpServer(
  server: Server | HttpsServer,
  host: string,
  port: number,
  errorCode: string,
) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error(errorCode)
  return address
}

export function armHttpServerShutdown(signal: AbortSignal | undefined, onSignal: () => void) {
  signal?.throwIfAborted()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  signal?.addEventListener('abort', onSignal, { once: true })
}
