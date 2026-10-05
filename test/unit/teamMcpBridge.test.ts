// The team MCP bridge (M96 lane B, PLAN.md D75 acceptance 45): one instance
// of each server on the pool, per-caller endpoints with their own tokens,
// routing by caller and request id, read-only filtering, and lease admission
// per call. The pool is a fake `TeamBridgePool` (fakes live in tests); the
// HTTP loopback is real.

import { afterEach, describe, expect, it } from 'vitest'
import type { CallToolResult } from '../../src/core/backends/modelapi/mcp/protocol'
import type {
  BridgeOfferedTool,
  McpPoolSnapshot,
  McpToolRef,
} from '../../src/core/backends/modelapi/mcp/pool'
import {
  type LeaseHolder,
  type RegistryClock,
  ResourceRegistry,
} from '../../src/core/team/resources'
import {
  type BridgeEndpoint,
  type TeamBridgePool,
  TeamMcpBridge,
} from '../../src/host/team/mcpBridge'
import { FakeLogOutputChannel } from './helpers/fakes'

const RESEARCHER: LeaseHolder = { role: 'research', taskId: 'task-a', attempt: 1 }
const ENGINEER: LeaseHolder = { role: 'engineering', taskId: 'task-b', attempt: 1 }
const ORCHESTRATOR: LeaseHolder = { role: 'orchestrator', taskId: 'main', attempt: 1 }

const NAVIGATE = 'mcp__chrome__navigate'
const SCREENSHOT = 'mcp__chrome__screenshot'
const READ_NOTE = 'mcp__notes__read'

function offered(
  functionName: string,
  server: string,
  tool: string,
  isReadOnly: boolean,
): BridgeOfferedTool {
  return {
    functionName,
    server,
    tool: {
      name: tool,
      description: `${tool} of ${server}`,
      inputSchema: { type: 'object' },
      annotations: isReadOnly ? { readOnlyHint: true } : undefined,
    },
    isReadOnly,
  }
}

const TOOLS: readonly BridgeOfferedTool[] = [
  offered(NAVIGATE, 'chrome', 'navigate', true),
  offered(SCREENSHOT, 'chrome', 'screenshot', false),
  offered(READ_NOTE, 'notes', 'read', true),
]

interface PoolCall {
  readonly functionName: string
  readonly signal: AbortSignal
}

function okResult(functionName: string, _signal: AbortSignal): Promise<CallToolResult> {
  return Promise.resolve({ content: [{ type: 'text', text: `${functionName} ok` }] })
}

/** A `TeamBridgePool` with scripted tools and results. */
function fakePool() {
  const calls: PoolCall[] = []
  let behavior: (functionName: string, signal: AbortSignal) => Promise<CallToolResult> = okResult
  const pool: TeamBridgePool = {
    snapshot: (): McpPoolSnapshot => ({
      isStarted: true,
      fault: undefined,
      servers: [
        {
          name: 'chrome',
          isRequired: false,
          state: { status: 'connected', toolCount: 2, unofferedCount: 0 },
        },
        {
          name: 'notes',
          isRequired: false,
          state: { status: 'connected', toolCount: 1, unofferedCount: 0 },
        },
      ],
    }),
    find: (functionName: string): McpToolRef | undefined => {
      const found = TOOLS.find((tool) => tool.functionName === functionName)
      return found === undefined
        ? undefined
        : { server: found.server, tool: found.tool.name, isReadOnly: found.isReadOnly }
    },
    bridgeTools: () => TOOLS,
    callRaw: async (functionName: string, _argsJson: string, signal: AbortSignal) => {
      calls.push({ functionName, signal })
      return await behavior(functionName, signal)
    },
  }
  return {
    pool,
    calls,
    hold: () => {
      const gate = Promise.withResolvers<CallToolResult>()
      behavior = async (_functionName, signal) => {
        const result = await gate.promise
        if (signal.aborted) {
          throw new Error('aborted')
        }
        return result
      }
      return gate
    },
    answer: (text: string) => {
      behavior = () => Promise.resolve({ content: [{ type: 'text', text }] })
    },
  }
}

function fakeClock() {
  let now = 1000
  const scheduled: { callback: () => void; at: number; cancelled: boolean }[] = []
  const delayed: { resolve: () => void; at: number }[] = []
  const clock: RegistryClock = {
    now: () => now,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        delayed.push({ resolve, at: now + ms })
      }),
    schedule: (callback: () => void, ms: number) => {
      const entry = { callback, at: now + ms, cancelled: false }
      scheduled.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
  }
  return {
    clock,
    advance(ms: number): void {
      now += ms
      for (const entry of scheduled.splice(0)) {
        if (!entry.cancelled && entry.at <= now) {
          entry.callback()
        } else if (!entry.cancelled) {
          scheduled.push(entry)
        }
      }
      for (const entry of delayed.splice(0)) {
        if (entry.at <= now) {
          entry.resolve()
        } else {
          delayed.push(entry)
        }
      }
    },
  }
}

const bridges: TeamMcpBridge[] = []

afterEach(() => {
  for (const bridge of bridges.splice(0)) {
    bridge.close()
  }
})

async function started(pool: TeamBridgePool, waitMs = 60_000) {
  const driven = fakeClock()
  const leases = new ResourceRegistry({ clock: driven.clock, waitMs, idleMs: 120_000 })
  const bridge = new TeamMcpBridge({
    pool,
    leases,
    serverOrigins: { chrome: 'local', notes: 'remote' },
    serverIdentities: { chrome: { command: 'chrome-control-mcp' } },
    clientVersion: '0.0.0-test',
    log: new FakeLogOutputChannel(),
  })
  bridges.push(bridge)
  await bridge.start()
  return { bridge, leases, ...driven }
}

async function post(
  endpoint: BridgeEndpoint,
  body: string,
  headers: Record<string, string> = endpoint.headers,
): Promise<Response> {
  return await fetch(endpoint.url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body,
  })
}

async function postJson(endpoint: BridgeEndpoint, body: unknown): Promise<unknown> {
  const response = await post(endpoint, JSON.stringify(body))
  return await response.json()
}

function textOf(result: unknown): string {
  const content = (result as { result: CallToolResult }).result.content as {
    type: string
    text: string
  }[]
  return content.map((block) => block.text).join('\n')
}

describe('endpoints and tokens', () => {
  it('serves the orchestrator and a worker through their own endpoints, on the one pool', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const worker = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    expect(main.url).not.toBe(worker.url)
    expect(main.headers).not.toEqual(worker.headers)

    const first = await postJson(main, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: NAVIGATE, arguments: {} },
    })
    const second = await postJson(worker, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: NAVIGATE, arguments: {} },
    })
    expect(textOf(first)).toBe(`${NAVIGATE} ok`)
    expect(textOf(second)).toBe(`${NAVIGATE} ok`)
    // One instance of the server: both callers reached the same pool.
    expect(fake.calls.map((call) => call.functionName)).toEqual([NAVIGATE, NAVIGATE])
  })

  it('refuses a wrong token, an unknown caller and a GET', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const denied = await post(main, body, { Authorization: 'Bearer [REDACTED]' })
    expect(denied.status).toBe(401)
    const unknown = { ...main, url: main.url.replace('/main', '/elsewhere') }
    const missing = await post(unknown, body)
    expect(missing.status).toBe(404)
    const plainGet = await fetch(main.url)
    expect(plainGet.status).toBe(405)
    expect(fake.calls).toHaveLength(0)
  })

  it('answers initialize and ping, and refuses a bad body and a bad method', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const hello = (await postJson(main, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })) as { result: { serverInfo: { name: string } } }
    expect(hello.result.serverInfo.name).toBe('muse-spark-team-bridge')
    const pong = await postJson(main, { jsonrpc: '2.0', id: 2, method: 'ping' })
    expect(pong).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
    const garbage = await post(main, '{nope')
    const garbageBody = (await garbage.json()) as { error: { code: number } }
    expect(garbageBody.error.code).toBe(-32_700)
    const missing = await postJson(main, { jsonrpc: '2.0', id: 3, method: 'tools/fly' })
    expect(missing).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32_601, message: 'Method not found: tools/fly' },
    })
  })

  it('accepts a notification without answering it', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const response = await post(
      main,
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    )
    expect(response.status).toBe(202)
    expect(fake.calls).toEqual([])
  })

  it('refuses a second registration of an id, and calls after unregistering', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    expect(() => bridge.registerCaller({ id: 'main', holder: ENGINEER, readOnly: false })).toThrow()
    bridge.unregisterCaller('main')
    const gone = await post(main, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    expect(gone.status).toBe(404)
    expect(() => bridge.listTools('main')).toThrow()
  })

  it('needs a start before registering', () => {
    const fake = fakePool()
    const bridge = new TeamMcpBridge({
      pool: fake.pool,
      leases: new ResourceRegistry(),
      serverOrigins: {},
      clientVersion: '0.0.0-test',
      log: new FakeLogOutputChannel(),
    })
    bridges.push(bridge)
    expect(() =>
      bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false }),
    ).toThrow()
  })
})

describe('routing by caller and request id', () => {
  it('keeps two workers’ same request id apart, results and cancellations included', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge } = await started(fake.pool)
    const first = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const second = bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
    const call = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: READ_NOTE } }
    const pendingFirst = post(first, JSON.stringify(call))
    const pendingSecond = post(second, JSON.stringify(call))
    while (fake.calls.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    // Cancelling the first worker's call stops only its own.
    await post(
      first,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 7 },
      }),
    )
    gate.resolve({ content: [{ type: 'text', text: 'note' }] })
    const [answeredFirst, answeredSecond] = await Promise.all([pendingFirst, pendingSecond])
    expect(textOf(await answeredFirst.json())).toBe('aborted')
    expect(textOf(await answeredSecond.json())).toBe('note')
    expect(fake.calls[0]?.signal.aborted).toBe(true)
    expect(fake.calls[1]?.signal.aborted).toBe(false)
  })
})

describe('read-only filtering', () => {
  it('serves a read-only role only read-only tools, in the list and at the call', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    bridge.registerCaller({ id: 'reader', holder: RESEARCHER, readOnly: true })
    expect(bridge.listTools('reader').map((tool) => tool.name)).toEqual([NAVIGATE, READ_NOTE])
    const refused = await bridge.callAs('reader', SCREENSHOT, '{}', new AbortController().signal)
    expect(refused.isError).toBe(true)
    const allowed = await bridge.callAs('reader', NAVIGATE, '{}', new AbortController().signal)
    expect(allowed.isError).not.toBe(true)
    expect(fake.calls.map((call) => call.functionName)).toEqual([NAVIGATE])
  })
})

describe('worker configuration isolation', () => {
  it('starts a worker with only its role’s servers', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false, servers: ['notes'] })
    expect(bridge.listTools('task-a').map((tool) => tool.name)).toEqual([READ_NOTE])
    const refused = await bridge.callAs('task-a', NAVIGATE, '{}', new AbortController().signal)
    expect(refused).toEqual({
      content: [{ type: 'text', text: `Unknown tool: ${NAVIGATE}` }],
      isError: true,
    })
    expect(fake.calls).toEqual([])
  })

  it('answers an unknown tool as a tool error', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const result = await bridge.callAs(
      'main',
      'mcp__nope__missing',
      '{}',
      new AbortController().signal,
    )
    expect(result.isError).toBe(true)
  })
})

describe('lease admission per call', () => {
  it('queues a second worker behind the first, then runs it', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge, leases } = await started(fake.pool)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
    const signal = new AbortController().signal
    const pendingFirst = bridge.callAs('task-a', SCREENSHOT, '{}', signal)
    const pendingSecond = bridge.callAs('task-b', SCREENSHOT, '{}', signal)
    while (fake.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(fake.calls).toHaveLength(1)
    gate.resolve({ content: [{ type: 'text', text: 'shot' }] })
    await expect(pendingFirst).resolves.toEqual({
      content: [{ type: 'text', text: 'shot' }],
    })
    // The first task's lease is still its own: the second waits for it.
    expect(fake.calls).toHaveLength(1)
    leases.release('chrome', RESEARCHER)
    await expect(pendingSecond).resolves.toEqual({
      content: [{ type: 'text', text: 'shot' }],
    })
  })

  it('answers busy past the wait, and refuses a retired attempt’s late call', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge, leases, advance } = await started(fake.pool, 50)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
    const signal = new AbortController().signal
    const pendingFirst = bridge.callAs('task-a', SCREENSHOT, '{}', signal)
    const pendingSecond = bridge.callAs('task-b', SCREENSHOT, '{}', signal)
    while (fake.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    advance(50)
    const busy = await pendingSecond
    expect(busy.isError).toBe(true)
    expect(textOf({ result: busy })).toBe('resource busy, held by research task task-a')
    leases.retireAttempt('task-a', 1)
    gate.resolve({ content: [{ type: 'text', text: 'shot' }] })
    await expect(pendingFirst).resolves.toEqual({
      content: [{ type: 'text', text: 'shot' }],
    })
    // A call from the retired attempt, arriving after, is refused.
    const late = await bridge.callAs('task-a', NAVIGATE, '{}', signal)
    expect(late.isError).toBe(true)
    expect(textOf({ result: late })).toBe('The task’s attempt 1 ended; the call is refused')
  })

  it('tells a taken-back holder busy, naming the orchestrator', async () => {
    const fake = fakePool()
    const { bridge, leases } = await started(fake.pool)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    await bridge.callAs('task-a', NAVIGATE, '{}', new AbortController().signal)
    leases.takeBack('chrome', ORCHESTRATOR)
    const refused = await bridge.callAs('task-a', NAVIGATE, '{}', new AbortController().signal)
    expect(refused.isError).toBe(true)
    expect(textOf({ result: refused })).toBe('resource busy, held by orchestrator task main')
  })

  it('registers the server with the registry’s command-and-package defaults', async () => {
    const fake = fakePool()
    const { bridge, leases } = await started(fake.pool)
    bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    await bridge.callAs('main', NAVIGATE, '{}', new AbortController().signal)
    const chrome = leases.list().find((entry) => entry.name === 'chrome')
    expect(chrome?.kind).toBe('exclusive')
  })
})

describe('entries and origins', () => {
  it('points every allowed server at the caller’s own endpoint and token', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const entries = bridge.serverEntriesFor('main')
    expect(Object.keys(entries)).toEqual(['chrome', 'notes'])
    expect(entries['chrome']).toMatchObject({ url: main.url, headers: main.headers })
    expect(entries['notes']).toMatchObject({ url: main.url, headers: main.headers })
    expect(() => bridge.serverEntriesFor('elsewhere')).toThrow()
  })

  it('names a server’s origin, and unknown for anything else', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    expect(bridge.serverOrigin('chrome')).toBe('local')
    expect(bridge.serverOrigin('notes')).toBe('remote')
    expect(bridge.serverOrigin('missing')).toBe('unknown')
  })
})
