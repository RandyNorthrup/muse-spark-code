import { Buffer } from 'node:buffer'
import type { IncomingMessage, IncomingHttpHeaders } from 'node:http'

export function receiveHttpResponse(
  resolve: (value: { status: number; headers: IncomingHttpHeaders; body: string }) => void,
  reject: (error: Error) => void,
) {
  return (response: IncomingMessage) => {
    const chunks: Buffer[] = []
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    response.on('error', reject)
    response.on('end', () => {
      resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  }
}
