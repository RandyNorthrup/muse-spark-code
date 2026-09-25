import { afterEach, describe, expect, it } from 'vitest'
import type { McpTool } from '../../src/core/mcp'
import { IdeMcpServer } from '../../src/host/ide/ideMcpServer'
import { FakeLogOutputChannel } from './helpers/fakes'

const tool: McpTool = {
  name: 'getDiagnostics',
  description: 'd',
  inputSchema: { type: 'object' },
  call: () => Promise.resolve('No diagnostics.'),
}

const servers: IdeMcpServer[] = []

async function start(): Promise<{ server: IdeMcpServer; log: FakeLogOutputChannel }> {
  const log = new FakeLogOutputChannel()
  const server = new IdeMcpServer(() => [tool], log)
  servers.push(server)
  await server.start()
  return { server, log }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
  }
})

interface Endpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

async function post(
  endpoint: Endpoint,
  body: string,
  headers: Record<string, string> = endpoint.headers,
): Promise<Response> {
  return await fetch(endpoint.url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body,
  })
}

async function postJson(endpoint: Endpoint, body: unknown): Promise<unknown> {
  const response = await post(endpoint, JSON.stringify(body))
  return await response.json()
}

async function status(endpoint: Endpoint, body: string, headers?: Record<string, string>) {
  const response = await post(endpoint, body, headers)
  return response.status
}

describe('IdeMcpServer', () => {
  it('listens on loopback with a bearer token and answers the MCP handshake', async () => {
    const { server, log } = await start()
    const endpoint = server.current
    expect(endpoint?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(endpoint?.headers['Authorization']).toMatch(/^Bearer [0-9a-f]{64}$/)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('IDE tool server listening'))
    // The token never reaches the log.
    const token = endpoint?.headers['Authorization']?.slice('Bearer '.length) ?? ''
    for (const call of log.info.mock.calls) {
      expect(String(call[0])).not.toContain(token)
    }
    if (endpoint === undefined) {
      throw new Error('no endpoint')
    }
    const response = await post(
      endpoint,
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    const initialized = await response.json()
    expect(initialized).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'muse_spark_ide' } },
    })
    const listed = await postJson(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(listed).toMatchObject({ result: { tools: [{ name: 'getDiagnostics' }] } })
    const called = await postJson(endpoint, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'getDiagnostics', arguments: {} },
    })
    expect(called).toMatchObject({
      result: { content: [{ type: 'text', text: 'No diagnostics.' }] },
    })
  })

  it('accepts notifications with 202 and refuses other methods, paths and tokens', async () => {
    const { server, log } = await start()
    const endpoint = server.current
    if (endpoint === undefined) {
      throw new Error('no endpoint')
    }
    expect(
      await status(
        endpoint,
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      ),
    ).toBe(202)
    const got = await fetch(endpoint.url, { headers: endpoint.headers })
    expect(got.status).toBe(405)
    expect(await status({ ...endpoint, url: endpoint.url.replace('/mcp', '/x') }, '{}')).toBe(404)
    expect(await status(endpoint, '{}', { Authorization: 'Bearer wrong' })).toBe(401)
    expect(await status(endpoint, '{}', {})).toBe(401)
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('without the session token'))
    const malformed = await post(endpoint, '{oops')
    expect(malformed.status).toBe(200)
    const body = await malformed.json()
    expect(body).toMatchObject({ error: { code: -32_700 } })
  })

  it('starts once and forgets its endpoint on close', async () => {
    const { server } = await start()
    const first = server.current
    await expect(server.start()).resolves.toBe(first)
    server.close()
    expect(server.current).toBeUndefined()
  })

  it('lists the tools as they stand at each request (M44: the image tools come and go)', async () => {
    const log = new FakeLogOutputChannel()
    let isImageOn = false
    const image: McpTool = { ...tool, name: 'generateImage' }
    // A new list per request, as the extension builds it.
    const server = new IdeMcpServer(() => (isImageOn ? [tool, image] : [tool]), log)
    servers.push(server)
    const endpoint = await server.start()
    const names = async () => {
      const listed = (await postJson(endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      })) as {
        readonly result: { readonly tools: readonly { readonly name: string }[] }
      }
      return listed.result.tools.map((listedTool) => listedTool.name)
    }
    expect(await names()).toEqual(['getDiagnostics'])
    isImageOn = true
    expect(await names()).toEqual(['getDiagnostics', 'generateImage'])
  })

  it('shares a start in flight and can start again after a close (D25)', async () => {
    const log = new FakeLogOutputChannel()
    const server = new IdeMcpServer(() => [tool], log)
    servers.push(server)
    const [first, second] = await Promise.all([server.start(), server.start()])
    expect(second).toBe(first)
    server.close()
    const again = await server.start()
    expect(again.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })
})
