import { createServer, type Server } from 'node:net'

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

/** A loopback port nothing listens on right now. */
export async function vacantLoopbackPort(): Promise<number> {
  const server = createServer()
  const port = await listenOnLoopback(server)
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return port
}
