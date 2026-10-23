// Fake-only, started by the owning tests; forwards only to this rig's loopback.
import { createServer, createConnection } from 'node:net'
const [address, port, target] = process.argv.slice(2)
const server = createServer((socket) => {
  socket.on('error', () => {
    /* A refused or killed fixture closes its peer. */
  })
  if (Number(target)) {
    const upstream = createConnection({ host: '127.0.0.1', port: Number(target) })
    upstream.on('error', () => socket.destroy())
    socket.pipe(upstream).pipe(socket)
    socket.on('close', () => upstream.destroy())
  } else {
    socket.on('data', () =>
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'),
    )
  }
})
server.listen({ host: address, port: Number(port), ipv6Only: true }, () => {
  const bound = server.address()
  if (!bound || typeof bound === 'string') throw new Error('missing listener')
  console.log(JSON.stringify({ port: bound.port }))
})
