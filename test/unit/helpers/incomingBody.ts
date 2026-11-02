import { type IncomingMessage } from 'node:http'

/** The text one HTTP request carried. The socket belongs to the caller. */
export function readIncomingBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const fail = (error: Error): void => {
      reject(error)
    }
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.once('error', fail)
    request.once('end', () => {
      request.off('error', fail)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}
