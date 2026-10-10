// M95 step 1 (PLAN.md D74): Scan this computer probes loopback over plain
// `node:http`, never through a proxy. Over real loopback sockets: the fetch
// reaches the target, ignores every proxy variable (a recording proxy sees
// nothing), refuses anything that is not an `http:` URL on 127.0.0.1 or ::1
// before any lookup or connection, honors abort, and refuses oversized
// bodies rather than reading them.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchLoopback } from '../../src/host/providers/loopbackFetch'
import { LOOPBACK_FETCH_MAX_BODY_BYTES } from '../../src/shared/constants'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
})

async function listen(
  onRequest: (request: IncomingMessage, reply: (status: number, body: string) => void) => void,
): Promise<{ port: number; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`)
    onRequest(request, (status, body) => {
      response.writeHead(status, { 'content-type': 'text/plain' })
      response.end(body)
    })
  })
  servers.push(server)
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        resolve(address.port)
      } else {
        reject(new Error('loopback server did not bind'))
      }
    })
  })
  return { port, requests }
}

const PROXY_VARIABLES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

async function withRecordingProxy<T>(run: (proxyRequests: string[]) => Promise<T>): Promise<T> {
  const proxy = await listen((_request, reply) => {
    reply(200, 'proxy answer')
  })
  const saved = new Map<string, string | undefined>()
  for (const variable of PROXY_VARIABLES) {
    saved.set(variable, process.env[variable])
    process.env[variable] = `http://127.0.0.1:${String(proxy.port)}`
  }
  try {
    return await run(proxy.requests)
  } finally {
    for (const variable of PROXY_VARIABLES) {
      const previous = saved.get(variable)
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, variable)
      } else {
        process.env[variable] = previous
      }
    }
  }
}

describe('fetchLoopback (M95 step 1)', () => {
  it('GETs a loopback target and returns its status and body', async () => {
    const target = await listen((_request, reply) => {
      reply(200, 'Ollama is running')
    })
    const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Ollama is running')
    expect(target.requests).toEqual(['GET /'])
  })

  it('passes non-2xx answers through with their status', async () => {
    const target = await listen((_request, reply) => {
      reply(500, 'bad')
    })
    const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/health`)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('bad')
  })

  it('ignores every proxy variable: a recording proxy sees nothing', async () => {
    const target = await listen((_request, reply) => {
      reply(200, '{"models":[]}')
    })
    const outcome = await withRecordingProxy(async (proxyRequests) => {
      const response = await fetchLoopback(`http://127.0.0.1:${String(target.port)}/v1/models`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('{"models":[]}')
      return proxyRequests
    })
    expect(outcome).toEqual([])
    expect(target.requests).toEqual(['GET /v1/models'])
  })

  it('refuses a non-loopback host before any connection', async () => {
    await expect(fetchLoopback('http://203.0.113.7:8080/')).rejects.toThrow(
      'loopback fetch refuses a non-loopback host (203.0.113.7)',
    )
  })

  it('refuses localhost without resolving it', async () => {
    await expect(fetchLoopback('http://localhost:1234/v1/models')).rejects.toThrow(
      'loopback fetch refuses a non-loopback host (localhost)',
    )
  })

  it('refuses https, credentials and non-GET requests', async () => {
    await expect(fetchLoopback('https://127.0.0.1:1234/')).rejects.toThrow(
      'loopback fetch refuses a https: URL',
    )
    await expect(fetchLoopback('http://user:pass@127.0.0.1:1234/')).rejects.toThrow(
      'loopback fetch refuses a URL carrying credentials',
    )
    await expect(fetchLoopback('http://127.0.0.1:1234/', { method: 'POST' })).rejects.toThrow(
      'loopback fetch refuses a POST request',
    )
  })

  it('reports a refused connection instead of answering', async () => {
    const closed = await listen((_request, reply) => {
      reply(200, 'gone')
    })
    const port = closed.port
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          }),
      ),
    )
    await expect(fetchLoopback(`http://127.0.0.1:${String(port)}/`)).rejects.toThrow()
  })

  it('honors an aborted signal', async () => {
    const target = await listen((_request, reply) => {
      reply(200, 'slow')
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchLoopback(`http://127.0.0.1:${String(target.port)}/`, { signal: controller.signal }),
    ).rejects.toThrow()
  })

  it('refuses a body past the cap rather than reading it', async () => {
    const target = await listen((_request, reply) => {
      reply(200, 'x'.repeat(LOOPBACK_FETCH_MAX_BODY_BYTES + 1))
    })
    await expect(fetchLoopback(`http://127.0.0.1:${String(target.port)}/`)).rejects.toThrow(
      'loopback fetch refuses a body past',
    )
  })
})
