// MCP elicitation in form mode (M91 lane M): the restricted schema subset,
// value validation, the advertised capability, and `elicitation/create`
// answered through a real pool and connection over a scripted server.

import { describe, expect, it, vi } from 'vitest'
import {
  ALLOW_ELICITATION_SEAM,
  type McpElicitationHandler,
  checkElicitationOutcome,
  describeElicitationForLog,
  parseElicitationParams,
  validateElicitationSchema,
  validateElicitationValues,
} from '../../src/core/backends/modelapi/mcp/elicitation'
import { McpConnection, type McpTransport } from '../../src/core/backends/modelapi/mcp/connection'
import { McpServerPool } from '../../src/core/backends/modelapi/mcp/pool'
import type { McpChildProcess } from '../../src/core/backends/modelapi/mcp/stdio'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import type { OutgoingMessage } from '../../src/core/backends/modelapi/mcp/protocol'
import { FakeLogOutputChannel } from './helpers/fakes'

const log = () => new FakeLogOutputChannel()

function validSchema() {
  return {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name', description: 'Your name' },
      age: { type: 'integer' },
      score: { type: 'number' },
      robot: { type: 'boolean' },
      colour: { type: 'string', enum: ['red', 'blue'] },
      email: { type: 'string', format: 'email' },
    },
    required: ['name'],
  }
}

const FORM_PARAMS = { message: 'Who?', requestedSchema: validSchema() }

describe('elicitation params (M91 lane M)', () => {
  it('takes form mode, or an omitted mode, with a message and a schema', () => {
    expect(parseElicitationParams({ message: 'Who?', requestedSchema: validSchema() })).toEqual({
      message: 'Who?',
      requestedSchema: validSchema(),
    })
    expect(
      parseElicitationParams({ mode: 'form', message: 'Who?', requestedSchema: {} }).message,
    ).toBe('Who?')
  })

  it('refuses url mode with a reason, and anything else malformed', () => {
    expect(() =>
      parseElicitationParams({ mode: 'url', message: 'Sign in', requestedSchema: {} }),
    ).toThrow('url mode')
    expect(() => parseElicitationParams({ mode: 'portal', message: 'Hi' })).toThrow('unknown mode')
    expect(() => parseElicitationParams({ message: '  ' })).toThrow()
    expect(() => parseElicitationParams({})).toThrow()
    expect(() => parseElicitationParams(undefined)).toThrow()
  })
})

describe('the restricted schema subset (M91 lane M)', () => {
  it('accepts a flat object of primitive fields, enums and formats', () => {
    const checked = validateElicitationSchema(validSchema())
    expect(checked.ok).toBe(true)
    if (!checked.ok) {
      return
    }
    expect(checked.fields.map((field) => field.name)).toEqual([
      'name',
      'age',
      'score',
      'robot',
      'colour',
      'email',
    ])
    expect(checked.fields[0]).toMatchObject({ required: true, title: 'Name' })
    expect(checked.fields[4]).toMatchObject({ enum: ['red', 'blue'] })
  })

  it('accepts titles, descriptions and fitting defaults', () => {
    const checked = validateElicitationSchema({
      type: 'object',
      title: 'Hi',
      description: 'A form',
      properties: { nick: { type: 'string', default: 'bob' } },
    })
    expect(checked.ok).toBe(true)
  })

  it('keeps the spec bounds and enum labels and validates their values', () => {
    const checked = validateElicitationSchema({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 4 },
        age: { type: 'integer', minimum: 1, maximum: 2 },
        colour: { type: 'string', enum: ['r', 'b'], enumNames: ['Red', 'Blue'] },
      },
    })
    expect(checked.ok).toBe(true)
    if (!checked.ok) throw new Error('the spec fixture must be valid')
    expect(checked.fields[2]).toMatchObject({ enumNames: ['Red', 'Blue'] })
    expect(validateElicitationValues(checked.fields, { name: 'Ada', age: 2 }).ok).toBe(true)
    for (const values of [{ name: 'A' }, { name: 'Alice' }, { age: 0 }, { age: 3 }]) {
      expect(validateElicitationValues(checked.fields, values).ok).toBe(false)
    }
  })

  it.each([
    ['a non-object', 42, 'object schema'],
    ['a non-object type', { type: 'array', properties: {} }, 'object schema'],
    ['extra root keywords', { type: 'object', properties: {}, maxProperties: 2 }, 'object schema'],
    ['a missing object type', { properties: {} }, 'object schema'],
    [
      'a required stranger',
      { type: 'object', properties: { a: { type: 'string' } }, required: ['x'] },
      'does not define',
    ],
    [
      'a bad required list',
      { type: 'object', properties: { a: { type: 'string' } }, required: 'x' },
      'object schema',
    ],
    [
      'a nested object',
      { type: 'object', properties: { a: { type: 'object' } } },
      'primitive schema',
    ],
    ['an array', { type: 'object', properties: { a: { type: 'array' } } }, 'primitive schema'],
    ['a combiner', { type: 'object', properties: { a: { anyOf: [] } } }, 'primitive schema'],
    ['a reference', { type: 'object', properties: { a: { $ref: '#/x' } } }, 'primitive schema'],
    [
      'an unknown format',
      { type: 'object', properties: { a: { type: 'string', format: 'widget' } } },
      'primitive schema',
    ],
    [
      'a pattern the form cannot show',
      { type: 'object', properties: { a: { type: 'string', pattern: '^a' } } },
      'primitive schema',
    ],
    [
      'an empty enum',
      { type: 'object', properties: { a: { type: 'string', enum: [] } } },
      'primitive schema',
    ],
    [
      'options that do not fit',
      { type: 'object', properties: { a: { type: 'string', enum: [1] } } },
      'primitive schema',
    ],
    [
      'a default that does not fit',
      { type: 'object', properties: { a: { type: 'string', default: 3 } } },
      'primitive schema',
    ],
    [
      'a bad format',
      { type: 'object', properties: { a: { type: 'string', format: 3 } } },
      'primitive schema',
    ],
  ])('declines %s', (_label, schema, reason) => {
    const checked = validateElicitationSchema(schema)
    expect(checked.ok).toBe(false)
    if (!checked.ok) {
      expect(checked.reason).toContain(reason)
    }
  })
})

const fieldsOf = () => {
  const checked = validateElicitationSchema(validSchema())
  if (!checked.ok) {
    throw new Error('the fixture schema must be valid')
  }
  return checked.fields
}

describe('answer validation (M91 lane M)', () => {
  it('accepts values of every kind', () => {
    const checked = validateElicitationValues(fieldsOf(), {
      name: 'Ada',
      age: 36,
      score: 1.5,
      robot: false,
      colour: 'red',
      email: 'ada@example.com',
    })
    expect(checked).toEqual({
      ok: true,
      content: {
        name: 'Ada',
        age: 36,
        score: 1.5,
        robot: false,
        colour: 'red',
        email: 'ada@example.com',
      },
    })
  })

  it('lets optional fields stay out', () => {
    const checked = validateElicitationValues(fieldsOf(), { name: 'Ada' })
    expect(checked).toEqual({ ok: true, content: { name: 'Ada' } })
  })

  it.each([
    ['a missing required field', {}, 'name', 'is required'],
    ['a wrong type', { name: 3 }, 'name', 'is not text'],
    ['a fractional integer', { name: 'A', age: 1.5 }, 'age', 'whole number'],
    ['an infinite number', { name: 'A', score: Infinity }, 'score', 'not a number'],
    ['a non-boolean', { name: 'A', robot: 'yes' }, 'robot', 'true or false'],
    ['outside the enum', { name: 'A', colour: 'green' }, 'colour', 'offered options'],
    ['a bad email', { name: 'A', email: 'not-an-email' }, 'email', 'requested format'],
    ['a stray field', { name: 'A', extra: 1 }, 'extra', 'not a field'],
  ])('refuses %s', (_label, values, field, reason) => {
    const checked = validateElicitationValues(fieldsOf(), values)
    expect(checked.ok).toBe(false)
    if (checked.ok) {
      return
    }

    expect(checked.refusal.field).toBe(field)
    expect(checked.refusal.reason).toContain(reason)
  })

  it('checks every format the negotiated spec supports', () => {
    const checked = validateElicitationSchema({
      type: 'object',
      properties: {
        day: { type: 'string', format: 'date' },
        at: { type: 'string', format: 'date-time' },
        site: { type: 'string', format: 'uri' },
      },
      required: ['day', 'at', 'site'],
    })
    if (!checked.ok) {
      throw new Error('the format fixture must be valid')
    }
    expect(
      validateElicitationValues(checked.fields, {
        day: '2026-10-04',
        at: '2026-10-04T06:00:00Z',
        site: 'https://example.com/x',
      }).ok,
    ).toBe(true)
    const bad = validateElicitationValues(checked.fields, {
      day: '2026-02-30',
      at: 'noon',
      site: 'not a uri',
    })
    expect(bad.ok).toBe(false)
  })
})

describe('answers and log lines (M91 lane M)', () => {
  it('passes accept through, strips decline and cancel bare, and refuses garbage', () => {
    expect(checkElicitationOutcome({ action: 'accept', content: { a: 1 } })).toEqual({
      action: 'accept',
      content: { a: 1 },
    })
    expect(checkElicitationOutcome({ action: 'accept' })).toEqual({
      action: 'accept',
      content: {},
    })
    expect(checkElicitationOutcome({ action: 'decline', content: { a: 1 } })).toEqual({
      action: 'decline',
    })
    expect(() => checkElicitationOutcome({ action: 'maybe' })).toThrow()
  })

  it('logs the server, the fields and the action, never the values', () => {
    const line = describeElicitationForLog('srv', ['name', 'age'], 'accept')
    expect(line).toContain('srv')
    expect(line).toContain('name')
    expect(line).not.toContain('Ada')
    expect(line).not.toContain('36')
  })

  it('proceeds past the seam by default', async () => {
    await expect(
      ALLOW_ELICITATION_SEAM.fireElicitation({
        server: 's',
        message: 'm',
        fieldNames: [],
        requiredNames: [],
      }),
    ).resolves.toEqual({ decision: 'proceed' })
    await expect(
      ALLOW_ELICITATION_SEAM.fireElicitationResult({
        server: 's',
        fieldNames: [],
        action: 'cancel',
      }),
    ).resolves.toBeUndefined()
  })
})

/** A transport in memory: what was sent, and a lever for what arrives. */
function loopback() {
  const sent: OutgoingMessage[] = []
  const incoming = new Set<(message: unknown) => void>()
  const closed = new Set<(reason: string) => void>()
  const transport: McpTransport = {
    send: (message) => {
      sent.push(message)
      return Promise.resolve()
    },
    setProtocolVersion: vi.fn(),
    onMessage: (listener) => {
      incoming.add(listener)
    },
    onClose: (listener) => {
      closed.add(listener)
    },
    close: () => Promise.resolve(),
  }
  return {
    transport,
    sent,
    receive: (message: unknown) => {
      for (const listener of incoming) {
        listener(message)
      }
    },
  }
}

function waitingForm(seen: AbortSignal[]): McpElicitationHandler {
  return ({ signal }) => {
    seen.push(signal)
    return new Promise((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve({ action: 'cancel' })
        },
        { once: true },
      )
    })
  }
}

function watchedConnection() {
  const t = loopback()
  const seen: AbortSignal[] = []
  const connection = new McpConnection(t.transport, {
    name: 'srv',
    clientVersion: 'test',
    log: log(),
    elicitation: waitingForm(seen),
  })
  return { t, seen, connection }
}

const INITIALIZED = {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
}

describe('the connection (M91 lane M)', () => {
  it('declares the form capability only while a handler stands', async () => {
    const without = loopback()
    const plain = new McpConnection(without.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
    })
    const initializing = plain.initialize(1000)
    expect(without.sent[0]).toMatchObject({
      method: 'initialize',
      params: { capabilities: {} },
    })
    without.receive({ jsonrpc: '2.0', id: 1, result: INITIALIZED })
    await initializing

    const offered = loopback()
    const eliciting = new McpConnection(offered.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
      elicitation: () => Promise.resolve({ action: 'decline' as const }),
    })
    const starting = eliciting.initialize(1000)
    expect(offered.sent[0]).toMatchObject({
      method: 'initialize',
      params: { capabilities: { elicitation: {} } },
    })
    offered.receive({ jsonrpc: '2.0', id: 1, result: INITIALIZED })
    await starting
  })

  it('still answers ping, and refuses what it does not offer', async () => {
    const t = loopback()
    new McpConnection(t.transport, { name: 'srv', clientVersion: 'test', log: log() })
    t.receive({ jsonrpc: '2.0', id: 1, method: 'ping' })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(1)
    })
    expect(t.sent[0]).toMatchObject({ id: 1, result: {} })
    t.receive({ jsonrpc: '2.0', id: 2, method: 'elicitation/create', params: {} })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(2)
    })
    expect(t.sent[1]).toMatchObject({ id: 2, error: { code: -32_601 } })
  })

  it('relays the handler answer to the server', async () => {
    const t = loopback()
    new McpConnection(t.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
      elicitation: ({ params }) => {
        const text =
          typeof params === 'object' &&
          params !== null &&
          'message' in params &&
          typeof params.message === 'string'
            ? params.message
            : '?'
        return Promise.resolve({ action: 'accept', content: { name: text } })
      },
    })
    t.receive({
      jsonrpc: '2.0',
      id: 7,
      method: 'elicitation/create',
      params: { message: 'Ada', requestedSchema: validSchema() },
    })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(1)
    })
    expect(t.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { action: 'accept', content: { name: 'Ada' } },
    })
  })

  it('answers a refusal with the reason, never the form', async () => {
    const t = loopback()
    new McpConnection(t.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
      elicitation: () => Promise.resolve({ action: 'cancel' as const }),
    })
    t.receive({
      jsonrpc: '2.0',
      id: 8,
      method: 'elicitation/create',
      params: { mode: 'url', message: 'Sign in', requestedSchema: {} },
    })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(1)
    })
    expect(t.sent[0]).toMatchObject({ id: 8, error: { code: -32_602 } })
  })

  it('stops the elicitation when the waiting call stops or closes', async () => {
    const { t, seen, connection } = watchedConnection()
    const stopper = new AbortController()
    const calling = connection.callTool('ask', {}, { timeoutMs: 10_000, signal: stopper.signal })
    t.receive({
      jsonrpc: '2.0',
      id: 9,
      method: 'elicitation/create',
      params: FORM_PARAMS,
    })
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1)
    })
    expect(seen[0]?.aborted).toBe(false)
    stopper.abort()
    await vi.waitFor(() => {
      expect(seen[0]?.aborted).toBe(true)
    })
    await expect(calling).rejects.toThrow()
    await connection.close()
  })

  it('cancels a pending form when its tool call reaches the deadline', async () => {
    const t = loopback()
    const connection = new McpConnection(t.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
      elicitation: ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ action: 'cancel' })
            },
            { once: true },
          )
        }),
    })
    const calling = expect(connection.callTool('ask', {}, { timeoutMs: 20 })).rejects.toThrow(
      'timed out',
    )
    t.receive({
      jsonrpc: '2.0',
      id: 'form',
      method: 'elicitation/create',
      params: FORM_PARAMS,
    })
    await calling
    await vi.waitFor(() => {
      expect(t.sent).toContainEqual({ jsonrpc: '2.0', id: 'form', result: { action: 'cancel' } })
    })
    await connection.close()
  })

  it('aborts a pending form when its connection closes', async () => {
    const { t, seen, connection } = watchedConnection()
    t.receive({ jsonrpc: '2.0', id: 'form', method: 'elicitation/create', params: FORM_PARAMS })
    expect(seen).toHaveLength(1)
    await connection.close()
    expect(seen[0]?.aborted).toBe(true)
  })

  it('never logs or returns a handler exception containing answer values', async () => {
    const t = loopback()
    const logger = log()
    new McpConnection(t.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: logger,
      elicitation: () => Promise.reject(new Error('private-answer-value')),
    })
    t.receive({
      jsonrpc: '2.0',
      id: 'form',
      method: 'elicitation/create',
      params: FORM_PARAMS,
    })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(1)
    })
    expect(JSON.stringify(t.sent)).not.toContain('private-answer-value')
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private-answer-value')
  })

  it('refuses invalid handler content and declines an unsupported schema before invoking it', async () => {
    const t = loopback()
    const handler = vi.fn(() =>
      Promise.resolve({ action: 'accept' as const, content: { name: 1 } }),
    )
    new McpConnection(t.transport, {
      name: 'srv',
      clientVersion: 'test',
      log: log(),
      elicitation: handler,
    })
    t.receive({
      jsonrpc: '2.0',
      id: 'invalid',
      method: 'elicitation/create',
      params: FORM_PARAMS,
    })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(1)
    })
    expect(t.sent[0]).toMatchObject({
      error: { message: 'the elicitation answer does not fit the requested schema' },
    })
    t.receive({
      jsonrpc: '2.0',
      id: 'schema',
      method: 'elicitation/create',
      params: {
        message: 'Who?',
        requestedSchema: { type: 'object', properties: { a: { type: 'array' } } },
      },
    })
    await vi.waitFor(() => {
      expect(t.sent).toHaveLength(2)
    })
    expect(t.sent[1]).toEqual({ jsonrpc: '2.0', id: 'schema', result: { action: 'decline' } })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

/** A stdio server in memory: scripted answers, and a record of the elicitation. */
function scriptedServer(elicit: unknown) {
  const written: string[] = []
  const stdout = new Set<(chunk: Uint8Array) => void>()
  let elicitationAnswer: unknown
  const waitingCalls = new Map<number, number>()
  let nextElicitation = 49
  const out = (message: unknown) => {
    const line = `${JSON.stringify(message)}\n`
    for (const listener of stdout) {
      listener(Buffer.from(line, 'utf8'))
    }
  }
  const receiveLine = (line: string) => {
    if (line.trim() === '') return
    const message: { id?: unknown; method?: unknown } = JSON.parse(line)
    if (typeof message.id !== 'number') return
    if (message.method === undefined) {
      const waiting = waitingCalls.get(message.id)
      if (waiting !== undefined) {
        elicitationAnswer = message
        out({ jsonrpc: '2.0', id: waiting, result: { content: [{ type: 'text', text: 'done' }] } })
        waitingCalls.delete(message.id)
      }
      return
    }
    switch (message.method) {
      case 'initialize': {
        out({
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } },
        })
        return
      }
      case 'tools/list': {
        out({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: [{ name: 'ask', description: 'ask', inputSchema: { type: 'object' } }] },
        })
        return
      }
      case 'tools/call': {
        nextElicitation += 1
        waitingCalls.set(nextElicitation, message.id)
        out({ jsonrpc: '2.0', id: nextElicitation, method: 'elicitation/create', params: elicit })
        return
      }
    }
  }
  const child: McpChildProcess = {
    write: (chunk) => {
      const text = Buffer.from(chunk).toString('utf8')
      written.push(text)
      for (const line of text.split('\n')) receiveLine(line)
    },
    endInput: vi.fn(),
    onStdout: (listener) => {
      stdout.add(listener)
    },
    onStderr: vi.fn(),
    onExit: vi.fn(),
    kill: () => Promise.resolve(),
  }
  // The initialize params the client sent, once written.
  const initializeOf = (): unknown => {
    const line = written.find((entry) => entry.includes('"initialize"'))
    if (line === undefined) {
      return undefined
    }
    const sent: { params?: { capabilities?: unknown } } = JSON.parse(line)
    return sent.params?.capabilities
  }
  return { child, written, initializeOf, elicitation: () => elicitationAnswer }
}

function poolWith(elicit: unknown, hasHandler: boolean) {
  const server = scriptedServer(elicit)
  const pool = new McpServerPool({
    readSettings: () =>
      readMcpServerEntries(JSON.stringify({ mcpServers: { srv: { command: 'srv' } } })),
    lookupEnv: () => undefined,
    isWorkspaceTrusted: () => true,
    workspaceRoot: '/ws',
    platform: 'linux',
    spawn: () => server.child,
    fetch: vi.fn<typeof fetch>(() => Promise.reject(new Error('no fetch in this test'))),
    clientVersion: 'test',
    log: log(),
  })
  if (hasHandler) {
    pool.setElicitationHandler(() => Promise.resolve({ action: 'decline' as const }))
  }
  return { pool, server }
}

describe('the pool (M91 lane M)', () => {
  it('cancels ambiguous concurrent routes instead of sending another session the form', async () => {
    const { pool, server } = poolWith({ message: 'Who?', requestedSchema: validSchema() }, true)
    await pool.start()
    const firstSignal = new AbortController()
    const firstAnswer = Promise.withResolvers<{ action: 'cancel' }>()
    const firstHandler = vi.fn(() => firstAnswer.promise)
    const first = expect(
      pool.call('mcp__srv__ask', '{}', firstSignal.signal, firstHandler),
    ).rejects.toThrow()
    await vi.waitFor(() => {
      expect(firstHandler).toHaveBeenCalledTimes(1)
    })
    const otherHandler = vi.fn(() =>
      Promise.resolve({ action: 'accept' as const, content: { name: 'wrong-session' } }),
    )
    await pool.call('mcp__srv__ask', '{}', new AbortController().signal, otherHandler)
    expect(otherHandler).not.toHaveBeenCalled()
    expect(server.elicitation()).toMatchObject({ result: { action: 'cancel' } })
    firstSignal.abort()
    firstAnswer.resolve({ action: 'cancel' })
    await first
    await pool.close()
  })
  it('declares the capability and routes the call through its session', async () => {
    const { pool, server } = poolWith({ message: 'Who?', requestedSchema: validSchema() }, true)
    await pool.start()
    expect(server.initializeOf()).toEqual({ elicitation: {} })
    expect(pool.definitions().map((definition) => definition.name)).toContain('mcp__srv__ask')
    const seen: unknown[] = []
    const outcome = await pool.call(
      'mcp__srv__ask',
      '{}',
      new AbortController().signal,
      (request) => {
        seen.push(request.server)
        return Promise.resolve({ action: 'accept', content: { name: 'Ada' } })
      },
    )
    expect(seen).toEqual(['srv'])
    expect(outcome.output).toContain('done')
    expect(server.elicitation()).toMatchObject({
      id: 50,
      result: { action: 'accept', content: { name: 'Ada' } },
    })
    await pool.close()
  })

  it('offers nothing while no handler stands, and refuses the request', async () => {
    const { pool, server } = poolWith({ message: 'Who?', requestedSchema: validSchema() }, false)
    await pool.start()
    expect(server.initializeOf()).toEqual({})
    const outcome = await pool.call('mcp__srv__ask', '{}', new AbortController().signal, () =>
      Promise.resolve({ action: 'accept', content: {} }),
    )
    expect(outcome.output).toContain('done')
    expect(server.elicitation()).toMatchObject({ id: 50, error: { code: -32_601 } })
    // The unoffered client still closes its server after the refusal.
    await pool.close()
  })
})
