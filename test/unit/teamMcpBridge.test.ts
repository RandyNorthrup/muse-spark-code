// The team MCP bridge (M96 lane B, PLAN.md D75 acceptance 45): one instance
// of each server on the pool, per-caller endpoints with their own tokens,
// routing by caller and request id, read-only filtering, and lease admission
// per call. The pool is a fake `TeamBridgePool` (fakes live in tests); the
// HTTP loopback is real.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpConnection } from '../../src/core/backends/modelapi/mcp/connection'
import { McpServerPool } from '../../src/core/backends/modelapi/mcp/pool'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import { type CallToolResult, McpError } from '../../src/core/backends/modelapi/mcp/protocol'
import type {
  BridgeOfferedTool,
  McpPoolSnapshot,
  McpToolRef,
} from '../../src/core/backends/modelapi/mcp/pool'
import { ResourceRegistry } from '../../src/core/team/resources'
import { type TeamBridgePool, TeamMcpBridge } from '../../src/host/team/mcpBridge'
import * as loopback from '../../src/host/mcpLoopback'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startFakeMcpHttp } from './helpers/fakeMcpHttpServer'
import { postLoopback, postLoopbackJson } from './helpers/loopbackHttp'
import { createManualClock } from './helpers/manualClock'
import { ENGINEER, ORCHESTRATOR, RESEARCHER } from './helpers/teamHolders'

async function acquiredLease(leases: ResourceRegistry, holder: typeof RESEARCHER) {
  const outcome = await leases.acquire('chrome', holder)
  if (outcome.status !== 'held') throw new Error(outcome.status)
  return outcome.lease
}

const NAVIGATE = 'mcp__chrome__navigate'
const SCREENSHOT = 'mcp__chrome__screenshot'
const READ_NOTE = 'mcp__notes__read'

function serverClientRequest(name: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name } })
}

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

const bridges: TeamMcpBridge[] = []

afterEach(() => {
  for (const bridge of bridges.splice(0)) {
    bridge.close()
  }
})

function configured(pool: TeamBridgePool, waitMs = 60_000) {
  const driven = createManualClock()
  const leases = new ResourceRegistry({ clock: driven.clock, waitMs, idleMs: 120_000 })
  for (const name of ['chrome', 'notes']) {
    const declaration = leases.ensureServer(
      name,
      name === 'chrome' ? { command: 'chrome-control-mcp' } : {},
    )
    leases.declare({ ...declaration, assignedRoles: ['research', 'engineering', 'orchestrator'] })
  }
  const bridge = new TeamMcpBridge({
    pool,
    leases,
    serverOrigins: { chrome: 'local', notes: 'remote' },
    serverIdentities: { chrome: { command: 'chrome-control-mcp' } },
    clientVersion: '0.0.0-test',
    log: new FakeLogOutputChannel(),
  })
  bridges.push(bridge)
  return { bridge, leases, ...driven }
}

async function started(pool: TeamBridgePool, waitMs = 60_000) {
  const launched = configured(pool, waitMs)
  await launched.bridge.start()
  return launched
}

/** Two workers calling the exclusive chrome, the second queued behind the first. */
async function queuedChromeCalls(waitMs = 60_000) {
  const fake = fakePool()
  const gate = fake.hold()
  const launched = await started(fake.pool, waitMs)
  launched.bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
  launched.bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
  const signal = new AbortController().signal
  const pendingFirst = launched.bridge.callAs('task-a', SCREENSHOT, '{}', signal)
  const pendingSecond = launched.bridge.callAs('task-b', SCREENSHOT, '{}', signal)
  while (fake.calls.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  return { fake, gate, ...launched, pendingFirst, pendingSecond }
}

function textOf(result: unknown): string {
  const content = (result as { result: CallToolResult }).result.content as {
    type: string
    text: string
  }[]
  return content.map((block) => block.text).join('\n')
}

describe('endpoints and tokens', () => {
  it('RVM96A-26: serves both endpoints on one pool after exact lease release', async () => {
    const fake = fakePool()
    const { bridge, leases } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const worker = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    expect(main.url).not.toBe(worker.url)
    expect(main.headers).not.toEqual(worker.headers)

    const first = await postLoopbackJson(main, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: NAVIGATE, arguments: {} },
    })
    leases.release(await acquiredLease(leases, ORCHESTRATOR))
    const second = await postLoopbackJson(worker, {
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

  it('RVM96A-26: refuses a wrong token, an unknown caller and a GET', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    const denied = await postLoopback(main, body, { Authorization: 'Bearer [REDACTED]' })
    expect(denied.status).toBe(401)
    const unauthenticated = await postLoopback(main, body, {})
    expect(unauthenticated.status).toBe(401)
    const unknown = { ...main, url: main.url.replace('/main', '/elsewhere') }
    const missing = await postLoopback(unknown, body)
    expect(missing.status).toBe(404)
    const plainGet = await fetch(main.url)
    expect(plainGet.status).toBe(405)
    expect(fake.calls).toHaveLength(0)
  })

  it('answers initialize and ping, and refuses a bad body and a bad method', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const hello = (await postLoopbackJson(main, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    })) as { result: { serverInfo: { name: string } } }
    expect(hello.result.serverInfo.name).toBe('muse-spark-team-bridge')
    const pong = await postLoopbackJson(main, { jsonrpc: '2.0', id: 2, method: 'ping' })
    expect(pong).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
    const garbage = await postLoopback(main, '{nope')
    const garbageBody = (await garbage.json()) as { error: { code: number } }
    expect(garbageBody.error.code).toBe(-32_700)
    const missing = await postLoopbackJson(main, { jsonrpc: '2.0', id: 3, method: 'tools/fly' })
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
    const response = await postLoopback(
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
    const gone = await postLoopback(main, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }))
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
    const pendingFirst = postLoopback(first, JSON.stringify(call))
    const pendingSecond = postLoopback(second, JSON.stringify(call))
    while (fake.calls.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    // Cancelling the first worker's call stops only its own.
    await postLoopback(
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
  it('refuses a server unassigned while its worker waited', async () => {
    const { fake, gate, leases, pendingFirst, pendingSecond } = await queuedChromeCalls()
    leases.declare({ name: 'chrome', kind: 'exclusive', assignedRoles: ['research'] })
    gate.resolve({ content: [{ type: 'text', text: 'shot' }] })
    await pendingFirst
    leases.release(await acquiredLease(leases, RESEARCHER))
    const result = await pendingSecond
    expect(result.isError).toBe(true)
    expect(fake.calls).toHaveLength(1)
    expect(leases.snapshot()[0]?.holders).toEqual([])
  })

  it.each([
    { servers: undefined, holder: RESEARCHER },
    { servers: ['chrome', 'notes'], holder: RESEARCHER },
    { servers: undefined, holder: ORCHESTRATOR },
    { servers: ['chrome'], holder: { ...RESEARCHER, role: 'orchestrator' } },
  ])(
    'requires user assignment for $holder.role with server selection $servers',
    async ({ servers, holder }) => {
      const fake = fakePool()
      const { bridge, leases } = await started(fake.pool)
      leases.declare({ name: 'chrome', kind: 'exclusive' })
      leases.declare({ name: 'notes', kind: 'shared' })
      bridge.registerCaller({ id: 'task-a', holder, readOnly: false, servers })
      expect(bridge.listTools('task-a')).toEqual([])
      expect(bridge.serverEntriesFor('task-a')).toEqual({})
      const result = await bridge.callAs('task-a', NAVIGATE, '{}', new AbortController().signal)
      expect(result.isError).toBe(true)
      expect(fake.calls).toEqual([])
    },
  )

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
  it('RVM96A-10: retains the lease after M50 times out without a terminal server answer', async () => {
    const fake = fakePool()
    const connection = new McpConnection(
      {
        send: () => Promise.resolve(),
        setProtocolVersion: vi.fn(),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        close: () => Promise.resolve(),
      },
      { name: 'chrome', clientVersion: '0.0.0-test', log: new FakeLogOutputChannel() },
    )
    const { bridge, leases, advance } = await started({
      ...fake.pool,
      callRaw: (_name, _args, signal) =>
        connection.callTool('screenshot', {}, { signal, timeoutMs: 1 }),
    })
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const stop = new AbortController()
    const result = await bridge.callAs('task-a', SCREENSHOT, '{}', stop.signal)
    expect(result.isError).toBe(true)
    expect(textOf({ result })).toContain('tools/call timed out')
    expect(stop.signal.aborted).toBe(false)
    advance(1_000_000)
    expect(leases.snapshot()[0]?.holders).toEqual([RESEARCHER])
    leases.retireAttempt(RESEARCHER.taskId, RESEARCHER.attempt)
    leases.takeBack('chrome', ORCHESTRATOR)
    expect(leases.snapshot()[0]?.holders).toEqual([RESEARCHER])
    leases.releaseAnyway('chrome')
    expect(leases.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
    await connection.close()
  })

  it('ends a lease on a terminal JSON-RPC error response', async () => {
    const fake = fakePool()
    const { bridge, leases, advance } = await started({
      ...fake.pool,
      callRaw: () => Promise.reject(new McpError('server refused', -32_602)),
    })
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const result = await bridge.callAs('task-a', SCREENSHOT, '{}', new AbortController().signal)
    expect(result.isError).toBe(true)
    advance(120_000)
    expect(leases.snapshot()[0]?.holders).toEqual([])
  })

  it('accepts a terminal result even when the caller already cancelled', async () => {
    const fake = fakePool()
    const gate = Promise.withResolvers<CallToolResult>()
    const entered = Promise.withResolvers<undefined>()
    const { bridge, leases, advance } = await started({
      ...fake.pool,
      callRaw: () => {
        entered.resolve(undefined)
        return gate.promise
      },
    })
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const stop = new AbortController()
    const pending = bridge.callAs('task-a', SCREENSHOT, '{}', stop.signal)
    await entered.promise
    stop.abort()
    gate.resolve({ content: [{ type: 'text', text: 'terminal' }] })
    await pending
    advance(120_000)
    expect(leases.snapshot()[0]?.holders).toEqual([])
  })

  it.each(['retire', 'take-back'])(
    'rechecks %s after acquiring and before dispatch',
    async (action) => {
      const fake = fakePool()
      const { bridge, leases } = await started(fake.pool)
      bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
      const pending = bridge.callAs('task-a', SCREENSHOT, '{}', new AbortController().signal)
      if (action === 'retire') {
        leases.retireAttempt(RESEARCHER.taskId, RESEARCHER.attempt)
      } else {
        leases.takeBack('chrome', ORCHESTRATOR)
      }
      const result = await pending
      expect(result.isError).toBe(true)
      expect(fake.calls).toEqual([])
    },
  )

  it('queues a second worker behind the first, then runs it', async () => {
    const { fake, gate, leases, pendingFirst, pendingSecond } = await queuedChromeCalls()
    expect(fake.calls).toHaveLength(1)
    gate.resolve({ content: [{ type: 'text', text: 'shot' }] })
    await expect(pendingFirst).resolves.toEqual({
      content: [{ type: 'text', text: 'shot' }],
    })
    // The first task's lease is still its own: the second waits for it.
    expect(fake.calls).toHaveLength(1)
    leases.release(await acquiredLease(leases, RESEARCHER))
    await expect(pendingSecond).resolves.toEqual({
      content: [{ type: 'text', text: 'shot' }],
    })
  })

  it('RVM96A-26: answers busy past wait and refuses a retired attempt with exact text', async () => {
    const { bridge, gate, leases, advance, pendingFirst, pendingSecond } =
      await queuedChromeCalls(50)
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
    const late = await bridge.callAs('task-a', NAVIGATE, '{}', new AbortController().signal)
    expect(late.isError).toBe(true)
    expect(textOf({ result: late })).toBe("The task's attempt 1 ended; the call is refused")
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

describe('cancellation and disposal', () => {
  it('refuses an HTTP caller removed while its body was being read', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const endpoint = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const bodyRead = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const readBody = loopback.readLoopbackBody
    const spy = vi.spyOn(loopback, 'readLoopbackBody').mockImplementationOnce(async (...args) => {
      const body = await readBody(...args)
      bodyRead.resolve(undefined)
      await proceed.promise
      return body
    })
    try {
      const pending = postLoopback(
        endpoint,
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: NAVIGATE } }),
      )
      await bodyRead.promise
      bridge.unregisterCaller('task-a')
      bridge.registerCaller({ id: 'task-a', holder: ENGINEER, readOnly: false })
      proceed.resolve(undefined)
      const response = await pending
      expect(response.status).toBe(404)
      expect(fake.calls).toEqual([])
    } finally {
      proceed.resolve(undefined)
      spy.mockRestore()
    }
  })

  it.each(['unregister', 'close'])(
    'RVM96A-23: cancels every in-process call on %s',
    async (action) => {
      const fake = fakePool()
      const gate = fake.hold()
      const { bridge } = await started(fake.pool)
      bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
      const pending = [
        bridge.callAs('task-a', READ_NOTE, '{}', new AbortController().signal),
        bridge.callAs('task-a', READ_NOTE, '{}', new AbortController().signal),
      ]
      await vi.waitFor(() => {
        expect(fake.calls).toHaveLength(2)
      })
      if (action === 'unregister') {
        bridge.unregisterCaller('task-a')
      } else {
        bridge.close()
      }
      const aborted = fake.calls.map((call) => call.signal.aborted)
      gate.resolve({ content: [{ type: 'text', text: 'done' }] })
      await Promise.all(pending)
      expect(aborted).toEqual([true, true])
    },
  )

  it.each(['queued', 'granted'])(
    'RVM96A-24: cancels %s admission without dispatch or lease liability',
    async (stage) => {
      const fake = fakePool()
      const { bridge, leases, advance } = await started(fake.pool)
      leases.ensureServer('chrome', { command: 'chrome-control-mcp' })
      const original = await acquiredLease(leases, RESEARCHER)
      bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
      const stop = new AbortController()
      const pending = bridge.callAs('task-b', SCREENSHOT, '{}', stop.signal)
      expect(leases.snapshot()[0]?.waiters).toEqual([ENGINEER])
      if (stage === 'granted') {
        leases.release(original)
      }
      stop.abort(new Error('admission cancelled'))
      const waitersAfterAbort = leases.snapshot()[0]?.waiters
      leases.release(original)
      const result = await pending
      expect(waitersAfterAbort).toEqual([])
      expect(result.isError).toBe(true)
      expect(textOf({ result })).toBe('admission cancelled')
      expect(fake.calls).toEqual([])
      advance(1_000_000)
      expect(leases.snapshot()[0]?.holders).toEqual([])
    },
  )

  it('refuses an already cancelled call before acquiring a resource', async () => {
    const fake = fakePool()
    const { bridge, leases } = await started(fake.pool)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const stop = new AbortController()
    stop.abort()
    const result = await bridge.callAs('task-a', SCREENSHOT, '{}', stop.signal)
    expect(result.isError).toBe(true)
    expect(fake.calls).toEqual([])
    expect(leases.snapshot().flatMap((resource) => resource.holders)).toEqual([])
  })

  it('RVM96A-25: cannot reopen or register after close overtakes startup', async () => {
    const fake = fakePool()
    const { bridge } = configured(fake.pool)
    const listener = Promise.withResolvers<loopback.LoopbackListener>()
    const listen = loopback.listenLoopback
    const spy = vi.spyOn(loopback, 'listenLoopback').mockImplementation(async (...args) => {
      const opened = await listen(...args)
      listener.resolve(opened)
      return opened
    })
    try {
      const pending = bridge.start()
      expect(bridge.start()).toBe(pending)
      bridge.close()
      await expect(pending).rejects.toThrow('closed')
      const opened = await listener.promise
      expect(opened.server.listening).toBe(false)
      expect(() =>
        bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false }),
      ).toThrow()
      await expect(bridge.start()).rejects.toThrow('closed')
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      // Also close the real listener when a deliberate guard break made the assertion fail.
      const opened = await listener.promise
      opened.server.close()
      spy.mockRestore()
    }
  })
})

describe('entries and origins', () => {
  it('RVM96RB2-5: points each configured server at its own client namespace and caller token', async () => {
    const fake = fakePool()
    const { bridge } = await started(fake.pool)
    const main = bridge.registerCaller({ id: 'main', holder: ORCHESTRATOR, readOnly: false })
    const entries = bridge.serverEntriesFor('main')
    expect(Object.keys(entries)).toEqual(['chrome', 'notes'])
    expect(entries['chrome']).toMatchObject({ url: `${main.url}/chrome`, headers: main.headers })
    expect(entries['notes']).toMatchObject({ url: `${main.url}/notes`, headers: main.headers })
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

describe('Round-3 redesign interleavings', () => {
  it('RVM96RB2-3: cancellation during re-entry leaves existing ownership and idle period intact', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge, leases, advance } = await started(fake.pool, 300_000)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    bridge.registerCaller({ id: 'task-b', holder: ENGINEER, readOnly: false })
    try {
      const first = bridge.callAs('task-a', SCREENSHOT, '{}', new AbortController().signal)
      await vi.waitFor(() => {
        expect(fake.calls).toHaveLength(1)
      })
      const stop = new AbortController()
      const reentry = bridge.callAs('task-a', SCREENSHOT, '{}', stop.signal)
      const other = bridge.callAs('task-b', SCREENSHOT, '{}', new AbortController().signal)
      stop.abort()
      await reentry
      gate.resolve({ content: [{ type: 'text', text: 'first' }] })
      await first
      expect(fake.calls).toHaveLength(1)
      expect(leases.snapshot()[0]?.holders).toEqual([RESEARCHER])
      advance(119_999)
      expect(fake.calls).toHaveLength(1)
      advance(1)
      await other
      expect(fake.calls).toHaveLength(2)
    } finally {
      gate.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
    }
  })

  it('RVM96RB2-4: old completion after Release anyway cannot settle a replacement call', async () => {
    const fake = fakePool()
    const old = Promise.withResolvers<CallToolResult>()
    const replacement = Promise.withResolvers<CallToolResult>()
    let count = 0
    const { bridge, leases, advance } = await started({
      ...fake.pool,
      callRaw: () => {
        count += 1
        return count === 1 ? old.promise : replacement.promise
      },
    })
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    try {
      const first = bridge.callAs('task-a', SCREENSHOT, '{}', new AbortController().signal)
      await vi.waitFor(() => {
        expect(count).toBe(1)
      })
      leases.releaseAnyway('chrome')
      const fresh = bridge.callAs('task-a', SCREENSHOT, '{}', new AbortController().signal)
      await vi.waitFor(() => {
        expect(count).toBe(2)
      })
      old.resolve({ content: [{ type: 'text', text: 'old terminal' }] })
      await first
      advance(120_000)
      expect(leases.snapshot()[0]?.holders).toEqual([RESEARCHER])
      replacement.resolve({ content: [{ type: 'text', text: 'fresh terminal' }] })
      await fresh
      advance(120_000)
      expect(leases.snapshot()[0]?.holders).toEqual([])
    } finally {
      old.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
      replacement.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
    }
  })

  it('RVM96RB2-5: two configured-server clients with the same request id cancel independently', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge } = await started(fake.pool)
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const entries = bridge.serverEntriesFor('task-a')
    const chrome = entries['chrome']
    const notes = entries['notes']
    if (chrome === undefined || notes === undefined || !('url' in chrome) || !('url' in notes)) {
      throw new Error('missing HTTP entries')
    }
    const a = { url: chrome.url, headers: chrome.headers }
    const b = { url: notes.url, headers: notes.headers }
    try {
      const first = postLoopback(a, serverClientRequest(NAVIGATE))
      const second = postLoopback(b, serverClientRequest(READ_NOTE))
      await vi.waitFor(() => {
        expect(fake.calls).toHaveLength(2)
      })
      await postLoopback(
        a,
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 7 },
        }),
      )
      expect(fake.calls.find((call) => call.functionName === NAVIGATE)?.signal.aborted).toBe(true)
      expect(fake.calls.find((call) => call.functionName === READ_NOTE)?.signal.aborted).toBe(false)
      gate.resolve({ content: [{ type: 'text', text: 'notes' }] })
      const responses = await Promise.all([first, second])
      expect(textOf(await responses[0].json())).toBe('aborted')
      expect(textOf(await responses[1].json())).toBe('notes')
      const wrongServer = await postLoopbackJson(a, {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: READ_NOTE },
      })
      expect(wrongServer).toMatchObject({ result: { isError: true } })
    } finally {
      gate.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
    }
  })

  it('RVM96RB2-6: locally invalid engine and HTTP arguments never create call liability on the real pool', async () => {
    const remote = await startFakeMcpHttp()
    const pool = new McpServerPool({
      readSettings: () =>
        readMcpServerEntries(JSON.stringify({ mcpServers: { chrome: { url: remote.url } } })),
      lookupEnv: () => undefined,
      isWorkspaceTrusted: () => true,
      workspaceRoot: process.cwd(),
      platform: process.platform,
      spawn: () => {
        throw new Error('HTTP fixture never spawns')
      },
      fetch: globalThis.fetch.bind(globalThis),
      clientVersion: '0.0.0-test',
      log: new FakeLogOutputChannel(),
    })
    try {
      await pool.start()
      const { bridge, leases, advance } = await started(pool)
      const endpoint = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
      const name = 'mcp__chrome__echo'
      expect(pool.find(name)).toBeDefined()
      const before = remote.requests.length
      for (const args of ['[]', 'null', 'true', '"text"', '{invalid']) {
        const invalid = await bridge.callAs('task-a', name, args, new AbortController().signal)
        expect(invalid.isError).toBe(true)
        const http = await postLoopbackJson(endpoint, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        })
        expect(http).toMatchObject({ result: { isError: true } })
      }
      leases.retireAttempt(RESEARCHER.taskId, RESEARCHER.attempt)
      advance(1_000_000)
      expect(remote.requests).toHaveLength(before)
      expect(leases.snapshot()[0]?.holders).toEqual([])
    } finally {
      await pool.close()
      await remote.close()
    }
  })

  it('RVM96RB2-7: four same-holder shared calls dispatch only two at once', async () => {
    const fake = fakePool()
    const gates = Array.from({ length: 4 }, () => Promise.withResolvers<CallToolResult>())
    const signals: AbortSignal[] = []
    const { bridge } = await started({
      ...fake.pool,
      callRaw: (_name, _args, signal) => {
        const gate = gates[signals.length]
        signals.push(signal)
        if (gate === undefined) throw new Error('unexpected call')
        return gate.promise
      },
    })
    bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const pending = gates.map(() =>
      bridge.callAs('task-a', READ_NOTE, '{}', new AbortController().signal),
    )
    try {
      await vi.waitFor(() => {
        expect(signals).toHaveLength(2)
      })
      gates[0]?.resolve({ content: [{ type: 'text', text: 'one' }] })
      await pending[0]
      await vi.waitFor(() => {
        expect(signals).toHaveLength(3)
      })
      gates[1]?.resolve({ content: [{ type: 'text', text: 'two' }] })
      await pending[1]
      await vi.waitFor(() => {
        expect(signals).toHaveLength(4)
      })
      gates[2]?.resolve({ content: [{ type: 'text', text: 'three' }] })
      gates[3]?.resolve({ content: [{ type: 'text', text: 'four' }] })
      await Promise.all(pending)
    } finally {
      for (const gate of gates) gate.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
      await Promise.all(pending)
    }
  })

  it('refuses duplicate live ids without overwriting the original cancellation record', async () => {
    const fake = fakePool()
    const gate = fake.hold()
    const { bridge } = await started(fake.pool)
    const endpoint = bridge.registerCaller({ id: 'task-a', holder: RESEARCHER, readOnly: false })
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: READ_NOTE },
    })
    try {
      const first = postLoopback(endpoint, request)
      await vi.waitFor(() => {
        expect(fake.calls).toHaveLength(1)
      })
      let isDuplicateFinished = false
      const duplicateRequest = (async () => {
        const response = await postLoopback(endpoint, request)
        isDuplicateFinished = true
        return response
      })()
      await vi.waitFor(() => {
        expect(isDuplicateFinished).toBe(true)
      })
      const duplicate = await duplicateRequest
      expect(await duplicate.json()).toMatchObject({
        result: { isError: true, content: [{ text: 'Invalid tools/call params' }] },
      })
      await postLoopback(
        endpoint,
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 7 },
        }),
      )
      expect(fake.calls[0]?.signal.aborted).toBe(true)
      gate.resolve({ content: [{ type: 'text', text: 'done' }] })
      await first
      expect(fake.calls).toHaveLength(1)
    } finally {
      gate.resolve({ content: [{ type: 'text', text: 'cleanup' }] })
    }
  })
})
