// Owned loopback servers for transport tests: real `node:http` endpoints,
// really-closed ports, and ports that accept and never answer. Shared so
// the duplication gate stays silent. Statuses and byte counts are plain
// input; no provider bytes anywhere.
import { createServer as createHttpServer, type ServerResponse } from 'node:http'
import { createServer as createNetServer, type Socket } from 'node:net'

export interface LoopbackEndpoint {
  readonly url: string
  readonly port: number
  readonly hits: () => number
  readonly close: () => Promise<void>
}

/** Bind on 127.0.0.1:0 and read back the kernel's port. */
async function boundPort(
  bind: (done: () => void) => void,
  addressOf: () => unknown,
): Promise<number> {
  await new Promise<void>((done) => {
    bind(done)
  })
  const address = addressOf()
  if (
    typeof address !== 'object' ||
    address === null ||
    !('port' in address) ||
    typeof address.port !== 'number'
  ) {
    throw new Error('loopback test server never bound')
  }
  return address.port
}

async function closeServer(close: (done: () => void) => void): Promise<void> {
  await new Promise<void>((done) => {
    close(done)
  })
}

/** A real HTTP endpoint on 127.0.0.1 answering through `handler`. */
export async function httpEndpoint(
  handler: (response: ServerResponse) => void,
): Promise<LoopbackEndpoint> {
  let hits = 0
  const server = createHttpServer((_request, response) => {
    hits += 1
    handler(response)
  })
  const port = await boundPort(
    (done) => {
      server.listen(0, '127.0.0.1', done)
    },
    () => server.address(),
  )
  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    hits: () => hits,
    close: async () => {
      server.closeAllConnections()
      await closeServer((done) => {
        server.close(() => {
          done()
        })
      })
    },
  }
}

/** A port nothing listens on: dialling it refuses for real. */
export async function closedPort(): Promise<number> {
  const server = createNetServer()
  const port = await boundPort(
    (done) => {
      server.listen(0, '127.0.0.1', done)
    },
    () => server.address(),
  )
  await closeServer((done) => {
    server.close(() => {
      done()
    })
  })
  return port
}

/** A port that accepts and never answers: a hung peer, held sockets and all. */
export async function silentPort(): Promise<LoopbackEndpoint> {
  let hits = 0
  const held = new Set<Socket>()
  const server = createNetServer((socket) => {
    hits += 1
    held.add(socket)
  })
  const port = await boundPort(
    (done) => {
      server.listen(0, '127.0.0.1', done)
    },
    () => server.address(),
  )
  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    hits: () => hits,
    close: async () => {
      for (const socket of held) socket.destroy()
      await closeServer((done) => {
        server.close(() => {
          done()
        })
      })
    },
  }
}
