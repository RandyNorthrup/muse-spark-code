// A foreign Unix-socket holder with no lock semantics, for the stale-file
// drill only. Binds the given path, reports readiness, then waits to be
// killed: SIGKILL leaves the socket file behind exactly as a crashed holder
// does (a graceful close is not a production source of stale files).
// No credentials or service traffic.
import { once } from 'node:events'
import net from 'node:net'

const target = process.argv[2]
const server = net.createServer((socket) => socket.destroy())
server.on('error', (error) => {
  const code = error instanceof Error && 'code' in error ? error.code : error
  process.send?.(`failed:${String(code)}`)
  process.exitCode = 1
})
server.listen(target, () => {
  process.send?.('listening')
})
await once(process, 'message')
