import type { Server } from 'node:http'

export async function listenHttpServer(
  server: Server,
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
