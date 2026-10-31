import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import type { Duplex } from 'node:stream'

/** The pinned loopback request headers every node HTTPS test sends. */
export function loopbackHeaders(
  port: number,
  headers: Record<string, string | undefined>,
  bearer?: string,
): Record<string, string> {
  const defaults: Record<string, string | undefined> = {
    Host: `home.local:${String(port)}`,
    Origin: `https://home.local:${String(port)}`,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Authorization: bearer === undefined ? undefined : `Bearer ${bearer}`,
    'Content-Type': 'application/json',
  }
  const merged: Record<string, string> = {}
  const entries = Object.entries({ ...defaults, ...headers })
  for (const [name, value] of entries) {
    if (value !== undefined) merged[name] = value
  }
  return merged
}

export interface LoopbackPostOptions {
  readonly port: number
  readonly certificate: string
  readonly route: string
  readonly method: string
  readonly body: string
  readonly headers: Record<string, string>
}

export interface LoopbackResponse {
  readonly status: number
  readonly body: string
  readonly headers: IncomingHttpHeaders
}

/** One pinned HTTPS call against the node's loopback listener. */
export async function loopbackPost(options: LoopbackPostOptions): Promise<LoopbackResponse> {
  return await new Promise<LoopbackResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: options.port,
        servername: 'home.local',
        ca: options.certificate,
        path: options.route,
        method: options.method,
        headers: options.headers,
        agent: false,
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (part: string) => {
          text += part
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: text, headers: response.headers })
        })
        response.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

export interface LoopbackSocketOptions {
  readonly port: number
  readonly certificate: string
  readonly origin: string
}

/** The terminal stream's websocket upgrade against the node's loopback listener. */
export async function loopbackTerminalSocket(options: LoopbackSocketOptions): Promise<Duplex> {
  return await new Promise<Duplex>((resolve, reject) => {
    const req = httpsRequest({
      host: '127.0.0.1',
      port: options.port,
      servername: 'home.local',
      ca: options.certificate,
      path: '/node/terminal/stream',
      agent: false,
      headers: {
        Host: `home.local:${String(options.port)}`,
        Origin: options.origin,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'websocket',
        'Sec-Fetch-Dest': 'websocket',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64'),
      },
    })
    req.once('upgrade', (_response, socket) => {
      resolve(socket)
    })
    req.once('error', reject)
    req.end()
  })
}
