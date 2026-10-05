// A raw exchange with the browser check's proxy over loopback (M81 A1): the
// bytes a test writes on a fresh connection, and everything the proxy
// answered until the connection closed.
import { connect } from 'node:net'

/** `text` on a fresh connection to `port`; what came back until it closed (ended here after `keepOpenMs`, when given). */
export async function rawExchange(
  port: number,
  text: string | Buffer,
  keepOpenMs = 0,
): Promise<string> {
  return await new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const parts: Buffer[] = []
    socket.on('data', (chunk: Buffer) => {
      parts.push(chunk)
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      resolve(Buffer.concat(parts).toString('latin1'))
    })
    socket.write(text)
    if (keepOpenMs > 0) {
      setTimeout(() => socket.end(), keepOpenMs)
    }
  })
}
