// M124 (D106): real loopback HTTP against the real approval server. No
// mocks, no fakes: plain `node:http` requests over 127.0.0.1, used by the
// connector suites after main's test overhaul deleted `./helpers/companion`.
import { request, type IncomingHttpHeaders } from 'node:http'

export function connectorHeaders(panel: { url: string }, token?: string): string[] {
  const origin = new URL(panel.url).origin
  return [
    'Host',
    new URL(origin).host,
    'Origin',
    origin,
    'Sec-Fetch-Site',
    'same-origin',
    'X-Muse-Panel',
    '1',
    'Content-Type',
    'application/json',
    ...(token === undefined ? [] : ['Authorization', `Bearer ${token}`]),
  ]
}

export function connectorCall(
  panel: { url: string },
  path: string,
  method = 'GET',
  body?: string | Buffer,
  supplied?: string[],
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(path, panel.url),
      { method, headers: supplied ?? connectorHeaders(panel), setHost: false },
      (response) => {
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
      },
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

export async function connectorLogin(panel: {
  url: string
  launchUrl: () => string
}): Promise<string> {
  const code = new URLSearchParams(new URL(panel.launchUrl()).hash.slice(1)).get('k')
  const result = await connectorCall(panel, '/session', 'POST', JSON.stringify({ code }))
  if (result.status !== 200) throw new Error(`login failed: ${result.body}`)
  const token = result.headers.authorization?.slice('Bearer '.length)
  if (token === undefined) throw new Error('login token absent')
  return token
}
