// One loopback HTTP server per test, shared by the suites that drive
// real sockets: the fetch reaches the target, never a proxy or the
// machine's DNS. Each file closes what it started in an afterEach.

import { createServer, type IncomingMessage, type Server } from 'node:http'

const servers: Server[] = []

/** Close every loopback server this helper started (an afterEach). */
export async function closeLoopbackServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
}

/** Answer a request with a status, a body, and optional extra headers. */
export type LoopbackReply = (status: number, body: string, headers?: Record<string, string>) => void

/** A bound loopback server and the request lines it has seen. */
export interface LoopbackTarget {
  readonly port: number
  readonly requests: string[]
  /** Close this server now (a test that needs it gone mid-test). */
  readonly close: () => Promise<void>
}

/** A loopback server on 127.0.0.1 answering through `onRequest`. */
export async function listenLoopback(
  onRequest: (request: IncomingMessage, reply: LoopbackReply) => void,
): Promise<LoopbackTarget> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`)
    onRequest(request, (status, body, headers) => {
      response.writeHead(status, { 'content-type': 'text/plain', ...headers })
      response.end(body)
    })
  })
  servers.push(server)
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        resolve(address.port)
      } else {
        reject(new Error('loopback server did not bind'))
      }
    })
  })
  return { port, requests, close }
}
