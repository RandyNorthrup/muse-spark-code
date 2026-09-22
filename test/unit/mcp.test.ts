import { describe, expect, it, vi } from 'vitest'
import { handleMcpMessage, type McpTool } from '../../src/core/mcp'

const info = { name: 'muse_spark_ide', version: '1' }

function echoTool(): McpTool & { readonly call: ReturnType<typeof vi.fn> } {
  return {
    name: 'echo',
    description: 'Echoes its argument.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    call: vi.fn((args: Readonly<Record<string, unknown>>) =>
      Promise.resolve(`echo:${String(args['text'])}`),
    ),
  }
}

const request = (id: number, method: string, params?: unknown) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined && { params }) })

describe('handleMcpMessage', () => {
  it('answers initialize with the client protocol version, tools capability and server info', async () => {
    // What muse serve 1.3.0 sent on 2026-09-22.
    const outcome = await handleMcpMessage(
      request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'tbh', version: '0.1.0' },
      }),
      [],
      info,
    )
    expect(outcome).toEqual({
      kind: 'response',
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: info,
        },
      },
    })
  })

  it('falls back to its own protocol version when the client names none', async () => {
    const outcome = await handleMcpMessage(request(1, 'initialize', {}), [], info)
    expect(outcome).toMatchObject({ body: { result: { protocolVersion: '2025-06-18' } } })
  })

  it('accepts notifications without a body', async () => {
    const outcome = await handleMcpMessage(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      [],
      info,
    )
    expect(outcome).toEqual({ kind: 'accepted' })
  })

  it('lists the tools with their schemas and calls one', async () => {
    const tool = echoTool()
    const listed = await handleMcpMessage(request(2, 'tools/list', {}), [tool], info)
    expect(listed).toMatchObject({
      body: {
        result: {
          tools: [
            { name: 'echo', description: 'Echoes its argument.', inputSchema: tool.inputSchema },
          ],
        },
      },
    })
    const called = await handleMcpMessage(
      request(3, 'tools/call', { name: 'echo', arguments: { text: 'hi' } }),
      [tool],
      info,
    )
    expect(called).toEqual({
      kind: 'response',
      body: { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'echo:hi' }] } },
    })
    expect(tool.call).toHaveBeenCalledWith({ text: 'hi' })
  })

  it('reports an unknown tool and a throwing tool as tool errors, not protocol errors', async () => {
    const failing: McpTool = { ...echoTool(), call: () => Promise.reject(new Error('boom')) }
    expect(
      await handleMcpMessage(request(4, 'tools/call', { name: 'nope' }), [failing], info),
    ).toMatchObject({
      body: { result: { isError: true, content: [{ text: 'Unknown tool: nope' }] } },
    })
    expect(
      await handleMcpMessage(
        request(5, 'tools/call', { name: 'echo', arguments: 'x' }),
        [failing],
        info,
      ),
    ).toMatchObject({ body: { result: { isError: true, content: [{ text: 'boom' }] } } })
  })

  it('answers ping, rejects unknown methods, bad JSON and non-requests', async () => {
    expect(await handleMcpMessage(request(6, 'ping'), [], info)).toMatchObject({
      body: { id: 6, result: {} },
    })
    expect(await handleMcpMessage(request(7, 'resources/list'), [], info)).toMatchObject({
      body: { id: 7, error: { code: -32_601 } },
    })
    expect(await handleMcpMessage('{not json', [], info)).toMatchObject({
      body: { id: null, error: { code: -32_700 } },
    })
    expect(await handleMcpMessage('{"jsonrpc":"1.0","id":1}', [], info)).toMatchObject({
      body: { id: null, error: { code: -32_600 } },
    })
  })
})
