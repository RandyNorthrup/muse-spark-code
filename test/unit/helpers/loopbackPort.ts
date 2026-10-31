import type { Server } from 'node:net'

/** Binds `server` to an ephemeral loopback port and answers with the port it got. */
export async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('No TCP address to listen on')
  return address.port
}
