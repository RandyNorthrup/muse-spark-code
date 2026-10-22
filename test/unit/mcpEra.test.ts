// The dual-era MCP client (PLAN.md D213) over recorded real exchanges
// (test/fixtures/mcpEra/*, captured 2026-10-22 from the official SDKs at
// each spec revision; see its manifest.json): the probe verdicts, the
// version retry inputs, the result readings, the form schemas both eras
// send, and the HTTP header encoding. The live proof — real servers of
// both eras connected through the product — is docs/certification/rlmcpera.md.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  parseElicitationParams,
  validateElicitationSchema,
  validateElicitationValues,
} from '../../src/core/backends/modelapi/mcp/elicitation'
import { encodeHeaderValue, modernRefusalError } from '../../src/core/backends/modelapi/mcp/http'
import {
  callToolResultSchema,
  discoverResultSchema,
  incomingMessageSchema,
  initializeResultSchema,
  inputRequestSchema,
  inputRequiredResultSchema,
  listToolsResultSchema,
  McpError,
  newestMutualModern,
  resultTypeOf,
  toolInfoSchema,
  unsupportedVersions,
} from '../../src/core/backends/modelapi/mcp/protocol'
import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '../../src/shared/constants'

const FIXTURES = path.join(process.cwd(), 'test/fixtures/mcpEra')

function wire(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'))
}

const httpCaptureSchema = z.object({ status: z.number(), body: z.string() })

function httpCapture(name: string): { status: number; body: string } {
  return httpCaptureSchema.parse(wire(name))
}

/** The error the connection's settle builds from a recorded error answer. */
function settled(capture: unknown): McpError {
  const parsed = incomingMessageSchema.parse(capture)
  if (parsed.error === undefined) {
    throw new Error('the capture carries no error')
  }
  return new McpError(
    `MCP error ${String(parsed.error.code)}: ${parsed.error.message}`,
    parsed.error.code,
    parsed.error.data,
  )
}

describe('era verdicts', () => {
  it('reads the modern discovery result', () => {
    const reply = incomingMessageSchema.parse(wire('discover-modern.json'))
    const discover = discoverResultSchema.parse(reply.result)
    expect(discover.supportedVersions).toEqual(['2026-07-28'])
    expect(discover.capabilities.tools).toBeDefined()
    expect(newestMutualModern(discover.supportedVersions)).toBe('2026-07-28')
  })

  it('reads a legacy -32601 as no modern evidence', () => {
    const error = settled(wire('discover-legacy-stdio.json'))
    expect(error.code).toBe(-32_601)
    expect(unsupportedVersions(error)).toBeUndefined()
  })

  it('reads a legacy HTTP 400 as no modern refusal', () => {
    const capture = httpCapture('discover-legacy-http.json')
    expect(capture.status).toBe(400)
    expect(modernRefusalError(capture.body)).toBeUndefined()
  })

  it('reads a modern HTTP 400 for its code and versions', () => {
    const capture = httpCapture('initialize-modern-only-http.json')
    expect(capture.status).toBe(400)
    const error = modernRefusalError(capture.body)
    expect(error?.code).toBe(-32_022)
    expect(unsupportedVersions(error ?? new McpError('missing'))).toEqual({
      supported: ['2026-07-28'],
      requested: '2025-06-18',
    })
  })

  it('still handshakes a legacy server', () => {
    const reply = incomingMessageSchema.parse(wire('initialize-legacy.json'))
    const shaken = initializeResultSchema.parse(reply.result)
    expect(MCP_SUPPORTED_PROTOCOL_VERSIONS.has(shaken.protocolVersion)).toBe(true)
    expect(shaken.capabilities.tools).toBeDefined()
  })
})

describe('version retry inputs', () => {
  it('reads a -32022 naming requested and supported', () => {
    const error = settled(wire('initialize-modern-only.json'))
    expect(error.code).toBe(-32_022)
    const versions = unsupportedVersions(error)
    expect(versions?.requested).toBe('2025-06-18')
    expect(newestMutualModern(versions?.supported ?? [])).toBe('2026-07-28')
  })

  it('reads a -32022 without requested', () => {
    const error = settled(wire('version-missing.json'))
    expect(error.code).toBe(-32_022)
    const versions = unsupportedVersions(error)
    expect(versions?.requested).toBeUndefined()
    expect(newestMutualModern(versions?.supported ?? [])).toBe('2026-07-28')
  })

  it('shares nothing with no versions', () => {
    expect(newestMutualModern([])).toBeUndefined()
  })
})

describe('result readings', () => {
  it('reads the modern tool list as complete', () => {
    const reply = incomingMessageSchema.parse(wire('tools-list-modern.json'))
    expect(resultTypeOf(reply.result)).toBe('complete')
    // Each tool is read on its own, as the connection does.
    const names = Array.from(
      listToolsResultSchema.parse(reply.result).tools,
      (tool) => toolInfoSchema.parse(tool).name,
    )
    expect(names).toContain('add')
  })

  it('reads the modern tool result as complete', () => {
    const reply = incomingMessageSchema.parse(wire('tools-call-modern.json'))
    expect(resultTypeOf(reply.result)).toBe('complete')
    const result = callToolResultSchema.parse(reply.result)
    expect(result.content).toEqual([{ type: 'text', text: '42' }])
  })

  it('reads a legacy answer naming no result type as complete', () => {
    const reply = incomingMessageSchema.parse(wire('initialize-legacy.json'))
    expect(resultTypeOf(reply.result)).toBeUndefined()
  })

  it('reads input_required with its form request and state', () => {
    const reply = incomingMessageSchema.parse(wire('tools-call-input-required.json'))
    expect(resultTypeOf(reply.result)).toBe('input_required')
    const asked = inputRequiredResultSchema.parse(reply.result)
    expect(asked.requestState).toBe('rlmcpera-round-1')
    const entry = inputRequestSchema.parse(asked.inputRequests?.['who'])
    expect(entry.method).toBe('elicitation/create')
    const parsed = parseElicitationParams(entry.params)
    expect(parsed.message).toBe('What nickname greets?')
    const schema = validateElicitationSchema(parsed.requestedSchema)
    expect(schema.ok).toBe(true)
    if (schema.ok) {
      expect(validateElicitationValues(schema.fields, { nickname: 'drill' }).ok).toBe(true)
    }
  })

  it('still accepts the legacy form request', () => {
    const request = incomingMessageSchema.parse(wire('elicitation-create-legacy.json'))
    expect(request.method).toBe('elicitation/create')
    const parsed = parseElicitationParams(request.params)
    const schema = validateElicitationSchema(parsed.requestedSchema)
    expect(schema.ok).toBe(true)
  })
})

describe('header encoding', () => {
  // The spec's own Value Encoding table
  // (specification/2026-07-28/basic/transports/streamable-http#value-encoding).
  it.each([
    ['us-west1', 'us-west1'],
    ['Hello世界', '=?base64?SGVsbG/kuJbnlYw=?='],
    ['  padded  ', '=?base64?ICBwYWRkZWQgIA==?='],
    ['新年', '=?base64?5paw5bm0?='],
    ['line1\nline2', '=?base64?bGluZTEKbGluZTI=?='],
    ['=?base64?e30=?=', '=?base64?PT9iYXNlNjQ/ZTMwPT89?='],
  ])('encodes %j', (value, encoded) => {
    expect(encodeHeaderValue(value)).toBe(encoded)
  })

  it('round-trips the encoded values', () => {
    for (const value of ['Hello世界', '  padded  ', 'line1\nline2', '=?base64?e30=?=']) {
      const encoded = encodeHeaderValue(value)
      const payload = encoded.slice('=?base64?'.length, -'?='.length)
      expect(Buffer.from(payload, 'base64').toString('utf8')).toBe(value)
    }
  })
})
