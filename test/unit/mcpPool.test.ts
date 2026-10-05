import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { McpServerPool, type McpPoolDeps } from '../../src/core/backends/modelapi/mcp/pool'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import { MCP_TOOLS_MAX_PER_SERVER } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { type FakeMcpHttp, startFakeMcpHttp } from './helpers/fakeMcpHttpServer'
import { TINY_PNG_BASE64 } from './helpers/fakeModelApi'
import { countLogged } from './helpers/logText'
import { FAKE_MCP_SERVER, fixtureJobLifecycle, realSpawner } from './helpers/mcpFixtures'

const ROOT = path.dirname(FAKE_MCP_SERVER)
const pools: McpServerPool[] = []
const http: FakeMcpHttp[] = []
const jobState = fixtureJobLifecycle()
beforeAll(jobState.setup, 60_000)
afterAll(jobState.dispose)

afterEach(async () => {
  await Promise.all([
    ...pools.splice(0).map((pool) => pool.close()),
    ...http.splice(0).map((server) => server.close()),
  ])
}, 60_000)

/** A stdio entry that runs the fake server under this Node. */
function fake(entry: Record<string, unknown> = {}): Record<string, unknown> {
  return { command: process.execPath, args: [FAKE_MCP_SERVER], ...entry }
}

function pool(
  servers: Record<string, unknown> | string,
  overrides: Partial<McpPoolDeps> = {},
): { pool: McpServerPool; log: FakeLogOutputChannel } {
  const log = new FakeLogOutputChannel()
  const text = typeof servers === 'string' ? servers : JSON.stringify({ mcpServers: servers })
  const created = new McpServerPool({
    readSettings: () => readMcpServerEntries(text),
    lookupEnv: (name) => (name === 'FAKE_TOKEN' ? 'tok' : undefined),
    isWorkspaceTrusted: () => true,
    workspaceRoot: ROOT,
    platform: process.platform,
    spawn: realSpawner(log, jobState.path),
    fetch: globalThis.fetch.bind(globalThis),
    clientVersion: '0.0.0-test',
    log,
    ...overrides,
  })
  pools.push(created)
  return { pool: created, log }
}

const stateOf = (created: McpServerPool, name: string) =>
  created.snapshot().servers.find((server) => server.name === name)?.state

// Real child processes: on a loaded machine Node itself can take seconds to start.
const SPAWN_TIMEOUT_MS = 60_000
const WAIT_TIMEOUT_MS = 20_000

/** Five silent servers: hold the first four until their timeout or pool close. */
function silentStartupBatch(): { pool: McpServerPool; starts: string[] } {
  const starts: string[] = []
  const spawn: McpPoolDeps['spawn'] = () => {
    starts.push('started')
    let onExit: ((how: string) => void) | undefined
    return {
      write: () => undefined,
      endInput: () => onExit?.('closed'),
      onStdout: () => undefined,
      onStderr: () => undefined,
      onExit: (listener) => {
        onExit = listener
      },
      kill: () => {
        onExit?.('killed')
        return Promise.resolve()
      },
    }
  }
  const silent = fake({ startup_timeout_sec: 1 })
  return {
    pool: pool({ a: silent, b: silent, c: silent, d: silent, e: silent }, { spawn }).pool,
    starts,
  }
}

describe('McpServerPool (M50)', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('passes cancellation through an awaited process-start admission barrier', async () => {
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    let wasCancelledBeforeSpawn = false
    const spawn: McpPoolDeps['spawn'] = async (_launch, _cwd, isCancelled) => {
      entered.resolve(undefined)
      await resume.promise
      wasCancelledBeforeSpawn = isCancelled?.() === true
      throw new Error('owned fixture starts no process')
    }
    const { pool: servers } = pool({ held: fake() }, { spawn })
    const starting = servers.start()
    let closing: Promise<void> | undefined
    try {
      await entered.promise
      closing = servers.close()
    } finally {
      resume.resolve(undefined)
    }
    await starting
    await closing
    expect(wasCancelledBeforeSpawn).toBe(true)
    expect(servers.definitions()).toEqual([])
  })

  it('starts at most four servers together, then starts the next batch', async () => {
    const { pool: servers, starts } = silentStartupBatch()
    const starting = servers.start()
    expect(starts).toHaveLength(4)
    await starting
    expect(starts).toHaveLength(5)
  })

  it('finishes startup shutdown before close returns and never starts a later batch', async () => {
    const { pool: servers, starts } = silentStartupBatch()
    const starting = servers.start()
    expect(starts).toHaveLength(4)
    let hasStartupFinished = false
    void starting.then(() => {
      hasStartupFinished = true
    })
    await servers.close()
    const wasFinishedAtClose = hasStartupFinished
    await starting
    expect(wasFinishedAtClose).toBe(true)
    expect(starts).toHaveLength(4)
    expect(servers.definitions()).toEqual([])
  })

  it('starts a stdio server and offers its tools under Muse Code names', async () => {
    const { pool: servers, log } = pool({ fake: fake() })
    expect(servers.snapshot()).toEqual({ isStarted: false, fault: undefined, servers: [] })
    await servers.start()
    expect(stateOf(servers, 'fake')).toEqual({
      status: 'connected',
      toolCount: 9,
      unofferedCount: 0,
    })
    expect(servers.definitions().map((definition) => definition.name)).toEqual([
      'mcp__fake__echo',
      'mcp__fake__picture',
      'mcp__fake__broken',
      'mcp__fake__env',
      'mcp__fake__wait',
      'mcp__fake__grow',
      'mcp__fake__lookup',
      'mcp__fake__die',
      'mcp__fake__ping_client',
    ])
    expect(servers.find('mcp__fake__lookup')).toEqual({
      server: 'fake',
      catalogueGeneration: expect.any(Number),
      tool: 'lookup',
      isReadOnly: true,
    })
    expect(servers.find('mcp__fake__echo')?.isReadOnly).toBe(false)
    expect(servers.find('mcp__other__echo')).toBeUndefined()
    expect(countLogged(log, 'MCP server fake connected (stdio): 9 tools offered')).toBe(1)
    await vi.waitFor(
      () => {
        expect(countLogged(log, 'MCP server fake (info): ready')).toBe(1)
        expect(countLogged(log, 'MCP server fake (stderr): fake mcp: started')).toBe(1)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
  })

  it('calls tools: text, a picture, an error, arguments that are not an object', async () => {
    const { pool: servers } = pool({ fake: fake() })
    await servers.start()
    const signal = new AbortController().signal
    expect(await servers.call('mcp__fake__echo', '{"text":"hi"}', signal)).toEqual({
      output: 'echo: hi',
      visibleOutput: 'echo: hi',
    })
    const picture = await servers.call('mcp__fake__picture', '', signal)
    expect(picture.outputParts?.[1]).toEqual({
      type: 'input_image',
      image_url: `data:image/png;base64,${TINY_PNG_BASE64}`,
      detail: 'auto',
    })
    expect(await servers.call('mcp__fake__broken', '{}', signal)).toMatchObject({
      failureReason: 'it broke',
    })
    expect(await servers.call('mcp__fake__ping_client', '{}', signal)).toMatchObject({
      output: 'pong received',
    })
    await expect(servers.call('mcp__fake__echo', '[1]', signal)).rejects.toThrow(
      'arguments must be a JSON object',
    )
    await expect(servers.call('mcp__fake__echo', '{nope', signal)).rejects.toThrow(
      'arguments must be a JSON object',
    )
    await expect(servers.call('mcp__gone__x', '{}', signal)).rejects.toThrow(
      'mcp__gone__x is not available',
    )
  })

  it('stops a call on the Stop button, and the server hears it', async () => {
    const { pool: servers, log } = pool({ fake: fake() })
    await servers.start()
    const stop = new AbortController()
    const call = servers.call('mcp__fake__wait', '{"ms":60000}', stop.signal)
    setTimeout(() => {
      stop.abort()
    }, 50)
    await expect(call).rejects.toThrow('the user stopped the turn')
    await vi.waitFor(
      () => {
        expect(countLogged(log, 'fake mcp: cancelled')).toBe(1)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
  })

  it('lists the tools again when the server says they changed', async () => {
    const { pool: servers } = pool({ fake: fake() })
    await servers.start()
    await servers.call('mcp__fake__grow', '{}', new AbortController().signal)
    await vi.waitFor(
      () => {
        expect(servers.find('mcp__fake__extra')).toBeDefined()
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(stateOf(servers, 'fake')).toMatchObject({ toolCount: 10 })
  })

  it('withdraws the tools of a server that stops, keeping its last words', async () => {
    const { pool: servers, log } = pool({ fake: fake() })
    await servers.start()
    await expect(
      servers.call('mcp__fake__die', '{}', new AbortController().signal),
    ).rejects.toThrow('the connection closed: it exited with code 7: fake mcp: dying')
    expect(stateOf(servers, 'fake')).toEqual({
      status: 'failed',
      reason: 'it stopped: it exited with code 7: fake mcp: dying',
    })
    expect(servers.definitions()).toEqual([])
    expect(countLogged(log, 'MCP server fake stopped')).toBe(1)
  })

  it('reports each server that cannot start with its reason, and starts the rest', async () => {
    const { pool: servers } = pool({
      crash: fake({ env: { FAKE_MCP_START: 'crash' } }),
      old: fake({ env: { FAKE_MCP_VERSION: '1999-01-01' } }),
      silent: fake({ env: { FAKE_MCP_START: 'silent' }, startup_timeout_sec: 1 }),
      unset: fake({ env: { KEY: '${NOT_SET}' } }),
      off: fake({ enabled: false }),
      lsp: fake({ env: { FAKE_MCP_FRAMING: 'content_length' }, framing: 'content_length' }),
      banner: fake({ env: { FAKE_MCP_START: 'banner' }, mode: 'optional' }),
    })
    await servers.start()
    const states = Object.fromEntries(
      servers.snapshot().servers.map((server) => [server.name, server.state]),
    )
    expect(states['crash']).toEqual({
      status: 'failed',
      reason: 'the connection closed: it exited with code 3: fake mcp: refusing to start',
    })
    expect(states['old']).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('1999-01-01') as unknown,
    })
    expect(states['silent']).toEqual({
      status: 'failed',
      reason:
        'it did not finish starting within 1 s; if it frames its messages with Content-Length, set "framing": "content_length" in its entry',
    })
    expect(states['unset']).toEqual({
      status: 'failed',
      reason: 'the environment variable NOT_SET is not set',
    })
    expect(states['off']).toEqual({ status: 'disabled' })
    expect(states['lsp']).toMatchObject({ status: 'connected' })
    expect(states['banner']).toMatchObject({ status: 'connected' })
    expect(servers.snapshot().servers.find((server) => server.name === 'banner')?.isRequired).toBe(
      false,
    )
  })

  it('starts nothing in Restricted Mode, and everything once the workspace is trusted', async () => {
    let isTrusted = false
    const { pool: servers } = pool({ fake: fake() }, { isWorkspaceTrusted: () => isTrusted })
    await servers.start()
    expect(stateOf(servers, 'fake')).toEqual({ status: 'restricted' })
    await servers.start()
    expect(servers.definitions()).toEqual([])
    isTrusted = true
    await servers.start()
    expect(stateOf(servers, 'fake')).toMatchObject({ status: 'connected' })
    await servers.start()
    expect(servers.definitions()).toHaveLength(9)
  })

  it('loads nothing from settings Muse Code would load nothing from', async () => {
    const keys = pool(JSON.stringify({ mcpServers: { a: fake() }, mcp_servers: {} }))
    await keys.pool.start()
    expect(keys.pool.snapshot()).toEqual({ isStarted: true, fault: { kind: 'keys' }, servers: [] })
    expect(
      countLogged(keys.log, 'No MCP server is loaded on the Model API backend: keys fault'),
    ).toBe(1)
    const unreadable = pool(
      {},
      {
        readSettings: () => {
          throw new Error('EACCES: permission denied')
        },
      },
    )
    await unreadable.pool.start()
    expect(unreadable.pool.snapshot().fault).toEqual({
      kind: 'unreadable',
      reason: 'EACCES: permission denied',
    })
  })

  it('runs a streamable-HTTP server with the headers of its entry', async () => {
    const server = await startFakeMcpHttp({ token: 'tok', reply: 'sse' })
    http.push(server)
    const { pool: servers } = pool({
      remote: {
        type: 'streamable-http',
        url: server.url,
        headers: { Authorization: 'Bearer ${FAKE_TOKEN}' },
      },
    })
    await servers.start()
    expect(stateOf(servers, 'remote')).toEqual({
      status: 'connected',
      toolCount: 2,
      unofferedCount: 0,
    })
    expect(
      await servers.call('mcp__remote__echo', '{"text":"x"}', new AbortController().signal),
    ).toMatchObject({
      output: 'echo: x',
    })
  })

  it('offers only the tools the entry allows, and no more than the cap', async () => {
    const filtered = pool({
      fake: fake({ enabled_tools: ['echo', 'lookup', 'env'], disabled_tools: ['env'] }),
    })
    await filtered.pool.start()
    expect(filtered.pool.definitions().map((definition) => definition.name)).toEqual([
      'mcp__fake__echo',
      'mcp__fake__lookup',
    ])
    expect(stateOf(filtered.pool, 'fake')).toEqual({
      status: 'connected',
      toolCount: 2,
      unofferedCount: 7,
    })
    const many = Array.from({ length: MCP_TOOLS_MAX_PER_SERVER + 2 }, (_value, index) => ({
      name: `t${String(index)}`,
      inputSchema: { type: 'array' },
    }))
    const replies = (body: { id?: number; method?: string }) =>
      body.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
        : { tools: many }
    const fetcher: typeof fetch = (_input, init) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        id?: number
        method?: string
      }
      return Promise.resolve(
        body.id === undefined
          ? new Response(null, { status: 202 })
          : Response.json({ jsonrpc: '2.0', id: body.id, result: replies(body) }),
      )
    }
    const capped = pool({ big: { url: 'https://big.test/mcp' } }, { fetch: fetcher })
    await capped.pool.start()
    expect(stateOf(capped.pool, 'big')).toEqual({
      status: 'connected',
      toolCount: MCP_TOOLS_MAX_PER_SERVER,
      unofferedCount: 2,
    })
    expect(countLogged(capped.log, 'offers 130 tools; the first 128')).toBe(1)
    expect(countLogged(capped.log, 'its schema was fitted to the Model API')).toBe(
      MCP_TOOLS_MAX_PER_SERVER,
    )
  })

  it('stops every server when closed, and starts none afterwards', async () => {
    const { pool: servers } = pool({ fake: fake() })
    await servers.start()
    pools.length = 0
    await servers.close()
    expect(servers.definitions()).toEqual([])
    await servers.start()
    await expect(
      servers.call('mcp__fake__echo', '{}', new AbortController().signal),
    ).rejects.toThrow('is not available')
  })

  it('closes a server that was still starting when the pool closed', async () => {
    const { pool: servers } = pool({ slow: fake({ env: { FAKE_MCP_START: 'silent' } }) })
    const starting = servers.start()
    pools.length = 0
    await servers.close()
    await starting
    expect(stateOf(servers, 'slow')).toMatchObject({ status: 'failed' })
  })
})
