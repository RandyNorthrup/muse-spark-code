// The dual-era MCP client (PLAN.md D213) over recorded real exchanges
// (test/fixtures/mcpEra/*, captured 2026-10-22 from the official SDKs at
// each spec revision; see its manifest.json): the probe verdicts, the
// version retry inputs, the result readings, the form schemas both eras
// send, and the HTTP header encoding; and, captured 2026-10-23 (cc/mcp2,
// the manifest's `cc-mcp2` block), the `x-mcp-header` mirrors, the header
// mismatch refusal, the tool-change subscription's messages and the
// listing's `ttlMs` freshness. The live proof — real servers of both eras
// connected through the product — is docs/certification/rlmcpera.md and
// docs/certification/cc-mcp2.md.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  pageFreshUntil,
  subscriptionAckSchema,
  subscriptionIdOf,
} from '../../src/core/backends/modelapi/mcp/changes'
import {
  parseElicitationParams,
  validateElicitationSchema,
  validateElicitationValues,
} from '../../src/core/backends/modelapi/mcp/elicitation'
import {
  encodeHeaderValue,
  mirrorHeaders,
  scanHeaderMirrors,
} from '../../src/core/backends/modelapi/mcp/headers'
import { modernRefusalError } from '../../src/core/backends/modelapi/mcp/http'
import {
  callToolResultSchema,
  discoverResultSchema,
  incomingMessageSchema,
  initializeResultSchema,
  inputRequestSchema,
  inputRequiredResultSchema,
  listToolsResultSchema,
  McpError,
  type McpToolInfo,
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

/** A recorded listing's result, as the connection reads each page. */
function listing(name: string): unknown {
  return incomingMessageSchema.parse(wire(name)).result
}

/** One tool of a recorded listing, read as the connection reads it. */
function listedTool(name: string, tool: string): McpToolInfo {
  const found = listToolsResultSchema
    .parse(listing(name))
    .tools.map((candidate) => toolInfoSchema.parse(candidate))
    .find((candidate) => candidate.name === tool)
  if (found === undefined) {
    throw new Error(`the capture lists no ${tool}`)
  }
  return found
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

describe('x-mcp-header mirrors', () => {
  it('mirrors the reference server’s annotated region, and only it', () => {
    const scanned = scanHeaderMirrors(
      listedTool('tools-list-header-params.json', 'get-header-params').inputSchema,
    )
    expect(scanned).toEqual({
      ok: true,
      mirrors: [{ header: 'Mcp-Param-Region', path: ['region'] }],
    })
    if (!scanned.ok) return
    // The drill's two calls (green-param), as the server echoed them back.
    expect(mirrorHeaders(scanned.mirrors, { region: 'eu-west' })).toEqual({
      'Mcp-Param-Region': 'eu-west',
    })
    expect(mirrorHeaders(scanned.mirrors, { region: 'Zürich', repeat: 2 })).toEqual({
      'Mcp-Param-Region': '=?base64?WsO8cmljaA==?=',
    })
    expect(mirrorHeaders(scanned.mirrors, {})).toEqual({})
  })

  it('keeps every other tool of the reference listing', () => {
    const tools = listToolsResultSchema.parse(listing('tools-list-header-params.json')).tools
    const rejected = tools
      .map((candidate) => toolInfoSchema.parse(candidate))
      .filter((tool) => !scanHeaderMirrors(tool.inputSchema).ok)
    expect(tools).toHaveLength(22)
    expect(rejected).toEqual([])
  })

  it.each([
    ['bad_header_tool', 'v: x-mcp-header "Bad Header" is not an HTTP header token'],
    [
      'number_header_tool',
      'n: x-mcp-header "Count" is on a property that is not a string, integer or boolean',
    ],
    ['twice_header_tool', 'x-mcp-header "tenant" is named twice (also as "Tenant")'],
    ['items_header_tool', 'list.<items>: x-mcp-header sits off the chain of properties keys'],
  ])('rejects the served %s with its reason', (tool, reason) => {
    expect(scanHeaderMirrors(listedTool('tools-list-annotations.json', tool).inputSchema)).toEqual({
      ok: false,
      reason,
    })
  })

  it('mirrors a nested string, an integer and a boolean the server accepted', () => {
    const scanned = scanHeaderMirrors(
      listedTool('tools-list-annotations.json', 'nested_header_tool').inputSchema,
    )
    expect(scanned.ok).toBe(true)
    if (!scanned.ok) return
    // The drill's call (capture-annotations), answered 200 by the SDK's own
    // header validation.
    expect(
      mirrorHeaders(scanned.mirrors, { where: { region: 'eu-west' }, days: 3, flag: false }),
    ).toEqual({ 'Mcp-Param-Region': 'eu-west', 'Mcp-Param-Days': '3', 'Mcp-Param-Flag': 'false' })
  })

  it('reads the header mismatch refusal for its code, never its words', () => {
    const capture = httpCapture('header-mismatch-http.json')
    expect(capture.status).toBe(400)
    const error = modernRefusalError(capture.body)
    expect(error?.code).toBe(-32_020)
    expect(error?.message).toBe(
      'MCP error -32020: the request headers do not match the request body',
    )
  })
})

describe('tool-change subscription', () => {
  it('reads the acknowledgment for its subscription and honoured filter', () => {
    const ack = incomingMessageSchema.parse(wire('subscription-acknowledged.json'))
    expect(ack.method).toBe('notifications/subscriptions/acknowledged')
    expect(subscriptionIdOf(ack.params)).toBe(2)
    expect(subscriptionAckSchema.parse(ack.params).notifications?.toolsListChanged).toBe(true)
  })

  it('reads the change it then carried under the same subscription', () => {
    const change = incomingMessageSchema.parse(wire('tools-list-changed-subscribed.json'))
    expect(change.method).toBe('notifications/tools/list_changed')
    expect(subscriptionIdOf(change.params)).toBe(2)
  })
})

describe('listing freshness', () => {
  const receivedAt = 1_000_000

  it('keeps a listing whose ttlMs is positive fresh for that long', () => {
    const page = listing('tools-list-header-params.json')
    expect(pageFreshUntil(page, receivedAt, Infinity)).toBe(receivedAt + 60_000)
    // A later page lapses no later than the earliest one.
    expect(pageFreshUntil(page, receivedAt + 5000, receivedAt + 60_000)).toBe(receivedAt + 60_000)
  })

  it('gives a listing whose ttlMs is zero no clock', () => {
    expect(
      pageFreshUntil(listing('tools-list-annotations.json'), receivedAt, Infinity),
    ).toBeUndefined()
    expect(pageFreshUntil(listing('tools-list-modern.json'), receivedAt, Infinity)).toBeUndefined()
  })

  it('leaves a listing that already has no clock without one', () => {
    expect(pageFreshUntil(listing('tools-list-header-params.json'), receivedAt, undefined)).toBe(
      undefined,
    )
  })
})
