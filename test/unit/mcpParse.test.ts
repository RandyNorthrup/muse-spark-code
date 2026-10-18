// Malformed MCP wire text (D119): only malformed JSON reads as a parse
// problem; anything else keeps its kind past the parse.
import { describe, expect, it } from 'vitest'
import { handleMcpMessage, mcpRequestKeys, type McpServerInfo } from '../../src/core/mcp'

const server: McpServerInfo = { name: 'test', version: '1' }

describe('malformed MCP wire text', () => {
  it('reads no keys from malformed JSON', () => {
    expect(mcpRequestKeys('{{{not json')).toEqual({ request: undefined, cancelled: undefined })
  })

  it('answers a parse error for malformed JSON', async () => {
    const outcome = await handleMcpMessage('{{{not json', [], server)
    expect(outcome.kind).toBe('response')
    expect(outcome).toMatchObject({
      kind: 'response',
      body: { error: { message: 'Parse error' } },
    })
  })

  it('still reads keys from a well-formed cancellation', () => {
    expect(mcpRequestKeys('{"method":"notifications/cancelled","params":{"requestId":3}}')).toEqual(
      { request: undefined, cancelled: 'n:3' },
    )
  })
})
