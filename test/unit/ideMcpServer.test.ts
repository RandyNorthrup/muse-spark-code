import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpTool } from '../../src/core/mcp'
import { IdeMcpServer } from '../../src/host/ide/ideMcpServer'
import * as loopback from '../../src/host/mcpLoopback'
import { FakeLogOutputChannel } from './helpers/fakes'
import { postLoopback, postLoopbackJson } from './helpers/loopbackHttp'

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

async function status(endpoint: Endpoint, body: string, headers?: Record<string, string>) {
  const response = await postLoopback(endpoint, body, headers)
  return response.status
}

function callBody(id: number) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'hold', arguments: {} } }
}

function cancelBody(requestId: number) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId, reason: 'client cancelled `tools/call`' },
  }
}

/** A tool that waits until the test lets it finish, handing over its signal. */
function holdingTool() {
  const called = Promise.withResolvers<AbortSignal>()
  const done = Promise.withResolvers<string>()
  const held: McpTool = {
    name: 'hold',
    description: 'h',
    inputSchema: { type: 'object' },
    call: async (_args, signal) => {
      called.resolve(signal)
      return await done.promise
    },
  }
  return {
    tool: held,
    called: called.promise,
    finish: () => {
      done.resolve('done')
    },
  }
}

describe('IdeMcpServer', () => {
  it('RVM96RB2-8: close during start leaves no endpoint or listener and permits a later start', async () => {
    const server = new IdeMcpServer(() => [tool], new FakeLogOutputChannel())
    servers.push(server)
    const opened = Promise.withResolvers<loopback.LoopbackListener>()
    const listen = loopback.listenLoopback
    const spy = vi.spyOn(loopback, 'listenLoopback').mockImplementationOnce(async (...args) => {
      const listener = await listen(...args)
      opened.resolve(listener)
      return listener
    })
    try {
      const pending = server.start()
      expect(server.start()).toBe(pending)
      server.close()
      await expect(pending).rejects.toThrow('closed during start')
      expect(server.current).toBeUndefined()
      const listener = await opened.promise
      expect(listener.server.listening).toBe(false)
      await expect(server.start()).resolves.toHaveProperty('url')
    } finally {
      const listener = await opened.promise
      listener.server.close()
      spy.mockRestore()
    }
  })
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
    const response = await postLoopback(
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
    const listed = await postLoopbackJson(endpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(listed).toMatchObject({ result: { tools: [{ name: 'getDiagnostics' }] } })
    const called = await postLoopbackJson(endpoint, {
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
    const malformed = await postLoopback(endpoint, '{oops')
    expect(malformed.status).toBe(200)
    const body = await malformed.json()
    expect(body).toMatchObject({ error: { code: -32_700 } })
  })

  // M68: a caller that goes away (Muse Code's turn stopped) ends the tool's
  // wait, such as the diagnostics tool's for a language server.
  it('stops a tool call whose caller went away', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const waiting: McpTool = {
      ...tool,
      call: (_args, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal)
        started.resolve(signal)
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve('stopped')
          })
        })
      },
    }
    const server = new IdeMcpServer(() => [waiting], new FakeLogOutputChannel())
    servers.push(server)
    const endpoint = await server.start()
    const client = new AbortController()
    const request = (async (): Promise<unknown> => {
      try {
        return await fetch(endpoint.url, {
          method: 'POST',
          headers: { ...endpoint.headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'getDiagnostics', arguments: {} },
          }),
          signal: client.signal,
        })
      } catch (error: unknown) {
        return error
      }
    })()
    const signal = await started.promise
    expect(signal.aborted).toBe(false)
    client.abort()
    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true)
    })
    expect(await request).toBeInstanceOf(Error)
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
      const listed = (await postLoopbackJson(endpoint, {
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

  it('tells a call its caller stopped waiting: the request closed (M69)', async () => {
    const seen = holdingTool()
    const server = new IdeMcpServer(() => [seen.tool], new FakeLogOutputChannel())
    servers.push(server)
    const endpoint = await server.start()
    const caller = new AbortController()
    const calling = fetch(endpoint.url, {
      method: 'POST',
      headers: { ...endpoint.headers, 'content-type': 'application/json' },
      body: JSON.stringify(callBody(3)),
      signal: caller.signal,
    })
    const signal = await seen.called
    expect(signal.aborted).toBe(false)
    caller.abort()
    await expect(calling).rejects.toThrow()
    await vi.waitFor(() => {
      expect(signal.aborted).toBe(true)
    })
  })

  it('tells a call its caller stopped waiting: notifications/cancelled names it (M69)', async () => {
    const seen = holdingTool()
    const server = new IdeMcpServer(() => [seen.tool], new FakeLogOutputChannel())
    servers.push(server)
    const endpoint = await server.start()
    const calling = postLoopbackJson(endpoint, callBody(3))
    const signal = await seen.called
    // Another id, and a malformed notice, stop nothing.
    expect(await status(endpoint, JSON.stringify(cancelBody(4)))).toBe(202)
    expect(
      await status(endpoint, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled' })),
    ).toBe(202)
    expect(signal.aborted).toBe(false)
    // The shape Muse Code 1.4.0 sent for a stopped turn.
    expect(await status(endpoint, JSON.stringify(cancelBody(3)))).toBe(202)
    expect(signal.aborted).toBe(true)
    seen.finish()
    await expect(calling).resolves.toMatchObject({ id: 3, result: { content: [{ text: 'done' }] } })
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
