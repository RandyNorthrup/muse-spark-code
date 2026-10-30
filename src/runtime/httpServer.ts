import type { IncomingMessage, Server } from 'node:http'
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

/** The whole request body as text, or undefined when it passed the bound. */
export async function readBoundedBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > maxBytes) return undefined
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function armHttpServerShutdown(signal: AbortSignal | undefined, onSignal: () => void) {
  signal?.throwIfAborted()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  signal?.addEventListener('abort', onSignal, { once: true })
}
