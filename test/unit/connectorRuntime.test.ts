// M124 (D106): the connector's runtime pieces: the stdio framer's bounds,
// the protocol's negotiation and cancellation, our approval page over the
// real companion server, the owner-only store and the owner's commands.
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_LIMITS,
  CONNECTOR_PROTOCOL_VERSIONS,
  CONNECTOR_SCHEMA_VERSION,
  UI_TEXT,
} from '../../src/shared/constants'
import type { ConnectorGrant } from '../../src/shared/connector'
import { SharedLimits } from '../../src/core/connector/policy'
import { ConnectorProtocol, type ConnectorServer } from '../../src/core/connector/protocol'
import { serveStdio } from '../../src/runtime/connector/stdio'
import { startApprovalPage } from '../../src/runtime/connector/approvalPage'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { connectorCall, connectorHeaders, connectorLogin } from './helpers/connectorLoopback'

/** The awaited result's field (the lint rule forbids member access on an await). */
async function field<T extends object, K extends keyof T>(
  result: Promise<T>,
  key: K,
): Promise<T[K]> {
  const value = await result
  return value[key]
}

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
async function folder(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), 'm124-connector-'))
  folders.push(created)
  return created
}

const earlierTransport = { ready: () => Promise.resolve() }

function fakeServer(overrides: Partial<ConnectorServer> = {}): ConnectorServer {
  return {
    // The pre-round-4 transport's journal wait, so these tests also run against that source.
    ...earlierTransport,
    serverInfo: { name: 'muse-spark-code', version: 'test' },
    initialized: () => Promise.resolve('instructions'),
    list: () => Promise.resolve([]),
    call: () => Promise.resolve({ content: [{ type: 'text', text: '{}' }], isError: false }),
    disconnect: () => undefined,
    transport: () => undefined,
    ...overrides,
  }
}

/** A transport's protocol port that answers nothing (refusals still answer their frame). */
function idleProtocol(
  close: () => void,
  handle: (raw: string) => Promise<unknown> = () => Promise.resolve(undefined),
) {
  const refusals = new ConnectorProtocol(fakeServer())
  return {
    handle: async (raw: string) => (await handle(raw)) as Record<string, unknown> | undefined,
    close,
    refuse: (code: number, id: unknown) => refusals.refuse(code, id),
    ...earlierTransport,
  }
}

const frame = (message: unknown) => JSON.stringify(message)
/** A valid grant of `generation` for the default connection. */
function savedGrant(generation: number): ConnectorGrant {
  return {
    schemaVersion: CONNECTOR_SCHEMA_VERSION,
    connectionId: 'default',
    generation,
    createdAt: '2026-10-09T00:00:00.000Z',
    revoked: false,
    scopes: ['prompts:read'],
    userLibrary: true,
    paidCapMicrousd: 0,
    workspaces: [],
  }
}

/** A clock that never moves: limits spent stay spent. */
const fixedNow = () => Date.parse('2026-10-09T12:00:00.000Z')

/** Whether the work settles within `ms` (a hung server never does). */
async function isSettledWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  const isSettled = async () => {
    await work
    return true
  }
  return await Promise.race([isSettled(), sleep(ms, false)])
}
const INIT = frame({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', clientInfo: { name: 'c' } },
})

describe('M124 MCP protocol subset', () => {
  it('negotiates a supported revision and falls back to the newest one', async () => {
    const protocol = new ConnectorProtocol(fakeServer())
    expect(await protocol.handle(INIT)).toMatchObject({
      result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } } },
    })
    const other = new ConnectorProtocol(fakeServer())
    expect(
      await other.handle(
        frame({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '1999-01-01' },
        }),
      ),
    ).toMatchObject({ result: { protocolVersion: CONNECTOR_PROTOCOL_VERSIONS[0] } })
  })

  it('refuses work before initialize, unknown methods, batches and malformed JSON', async () => {
    const protocol = new ConnectorProtocol(fakeServer())
    expect(
      await protocol.handle(frame({ jsonrpc: '2.0', id: 2, method: 'tools/list' })),
    ).toMatchObject({
      error: { code: -32_600 },
    })
    await protocol.handle(INIT)
    expect(
      await protocol.handle(frame({ jsonrpc: '2.0', id: 3, method: 'resources/list' })),
    ).toMatchObject({ error: { code: -32_601 } })
    expect(await protocol.handle(frame([{ jsonrpc: '2.0', id: 4, method: 'ping' }]))).toMatchObject(
      {
        error: { code: -32_600 },
      },
    )
    expect(await protocol.handle('{')).toMatchObject({ error: { code: -32_700 } })
    expect(await protocol.handle(frame({ jsonrpc: '2.0', id: 5, method: 'ping' }))).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: {},
    })
    expect(
      await protocol.handle(frame({ jsonrpc: '2.0', method: 'notifications/initialized' })),
    ).toBeUndefined()
  })

  it('stops a call that notifications/cancelled names, and answers nothing for it', async () => {
    let seen: AbortSignal | undefined
    const protocol = new ConnectorProtocol(
      fakeServer({
        call: (_name, _args, _version, signal) =>
          new Promise((resolve) => {
            seen = signal
            signal.addEventListener('abort', () => {
              resolve({ content: [{ type: 'text', text: 'late' }], isError: false })
            })
          }),
      }),
    )
    await protocol.handle(INIT)
    const pending = protocol.handle(
      frame({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x', arguments: {} } }),
    )
    await Promise.resolve()
    await protocol.handle(
      frame({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } }),
    )
    expect(await pending).toBeUndefined()
    expect(seen?.aborted).toBe(true)
  })
})

/** A client's two pipes; `lines` collects every reply line written to stdout. */
function pipes() {
  const input = new PassThrough()
  const output = new PassThrough()
  const lines: string[] = []
  output.on('data', (chunk: Buffer) => {
    lines.push(...chunk.toString('utf8').split('\n').filter(Boolean))
  })
  return { input, output, lines }
}

/** Serving a protocol that answers nothing; `close` counts disconnects. */
function idleServe() {
  const { input, output } = pipes()
  const close = vi.fn()
  const served = serveStdio({ input, output }, idleProtocol(close))
  return { input, output, close, served }
}

describe('M124 stdio framing', () => {
  it('keeps stdout to one JSON reply per line, refuses an oversized frame and continues', async () => {
    const { input, output, lines } = pipes()
    const served = serveStdio({ input, output }, new ConnectorProtocol(fakeServer()), 64)
    input.write(INIT.slice(0, 10))
    input.write(`${INIT.slice(10)}\r\n`)
    input.write(`${'x'.repeat(100)}\n`)
    input.write(`${frame({ jsonrpc: '2.0', id: 9, method: 'ping' })}\n\n`)
    input.end()
    await served
    const replies = lines.map(
      (line) => JSON.parse(line) as { id?: unknown; error?: { code: number } },
    )
    expect(replies.some((reply) => reply.error?.code === -32_001)).toBe(true)
    expect(replies.some((reply) => reply.id === 9)).toBe(true)
    // The oversized frame was never parsed: no parse error for it.
    expect(replies.some((reply) => reply.error?.code === -32_700)).toBe(false)
    expect(CONNECTOR_LIMITS.frameBytes).toBe(65_536)
  })

  it('stops calls in flight when stdin ends (the client disconnected)', async () => {
    const { input, close, served } = idleServe()
    input.end()
    await served
    expect(close).toHaveBeenCalled()
  })

  it('closes the connector when stdout closes while stdin stays open (RVM124 P2-4)', async () => {
    const { output, close, served } = idleServe()
    output.destroy()
    expect(await isSettledWithin(served, 1000)).toBe(true)
    expect(close).toHaveBeenCalled()
  })

  it('honours stdout backpressure and disconnects a client that never reads (RVM124 P2-5)', async () => {
    const input = new PassThrough()
    // A client that never reads: the first write never completes.
    const output = new Writable({ highWaterMark: 16, write: () => undefined })
    const served = serveStdio({ input, output }, new ConnectorProtocol(fakeServer()))
    const ping = `${frame({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`
    input.write(ping.repeat(50_000))
    expect(await isSettledWithin(served, 2000)).toBe(true)
    expect(output.writableLength).toBeLessThanOrEqual(CONNECTOR_LIMITS.frameBytes)
  })

  it('answers busy beyond the task bound and keeps room for Stop (RVM124 P2-5)', async () => {
    const { input, output, lines } = pipes()
    const hung: (() => void)[] = []
    const served = serveStdio(
      { input, output },
      idleProtocol(
        () => {
          for (const resolve of hung.splice(0)) resolve()
        },
        (raw) =>
          raw.includes('muse_stop')
            ? Promise.resolve({ jsonrpc: '2.0', id: 'stop', result: {} })
            : new Promise((resolve) => {
                hung.push(() => {
                  resolve(undefined)
                })
              }),
      ),
    )
    const extra = 4
    for (let id = 1; id <= CONNECTOR_LIMITS.transportTasks + extra; id += 1)
      input.write(
        `${frame({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'muse_prompt_list' } })}\n`,
      )
    input.write(
      `${frame({ jsonrpc: '2.0', id: 'stop', method: 'tools/call', params: { name: 'muse_stop' } })}\n`,
    )
    await vi.waitFor(() => {
      expect(lines).toHaveLength(extra + 1)
    })
    const replies = lines.map(
      (line) => JSON.parse(line) as { id: unknown; error?: { code: number } },
    )
    expect(
      replies.filter((reply) => reply.error?.code === -32_002).map((reply) => reply.id),
    ).toEqual(
      Array.from({ length: extra }, (_, index) => CONNECTOR_LIMITS.transportTasks + 1 + index),
    )
    expect(replies.some((reply) => reply.id === 'stop' && reply.error === undefined)).toBe(true)
    input.end()
    await served
  })
})

describe('M124 approval page', () => {
  it('settles an intent only from an authenticated page post with the shown digest', async () => {
    const decide = vi.fn((_id: string, digest: string) => digest === 'a'.repeat(64))
    const page = await startApprovalPage({
      pending: () => [
        {
          intentId: 'i1',
          digest: 'a'.repeat(64),
          client: 'codex',
          connectionId: 'default',
          workspace: 'repo',
          tool: 'muse_prompt_save',
          toolClass: 'write',
          generation: 1,
          priceMicrousd: 0,
          expiresAt: Date.now() + 1000,
          fields: [{ label: 'body', value: '<script>alert(1)</script>' }],
        },
      ],
      decide,
    })
    try {
      const panel = { url: `${new URL(page.launchUrl()).origin}/`, launchUrl: page.launchUrl }
      const body = JSON.stringify({
        type: 'decide',
        intentId: 'i1',
        digest: 'a'.repeat(64),
        approve: true,
      })
      // No bearer: refused before any decision.
      expect(await field(connectorCall(panel, '/post', 'POST', body), 'status')).toBe(401)
      expect(decide).not.toHaveBeenCalled()
      const token = await connectorLogin(panel)
      const html = await connectorCall(panel, '/', 'GET', undefined, connectorHeaders(panel, token))
      expect(html.body).toContain(UI_TEXT.acpConnector.title)
      // Request text reaches the page only through the event stream, as data.
      expect(html.body).not.toContain('<script>alert(1)</script>')
      expect(
        await field(
          connectorCall(panel, '/post', 'POST', body, connectorHeaders(panel, token)),
          'status',
        ),
      ).toBe(202)
      expect(decide).toHaveBeenCalledWith('i1', 'a'.repeat(64), true)
      const wrong = JSON.stringify({
        type: 'decide',
        intentId: 'i1',
        digest: 'b'.repeat(64),
        approve: true,
      })
      expect(
        await field(
          connectorCall(panel, '/post', 'POST', wrong, connectorHeaders(panel, token)),
          'status',
        ),
      ).toBe(500)
      const extra = JSON.stringify({
        type: 'decide',
        intentId: 'i1',
        digest: 'a'.repeat(64),
        approve: true,
        always: true,
      })
      expect(
        await field(
          connectorCall(panel, '/post', 'POST', extra, connectorHeaders(panel, token)),
          'status',
        ),
      ).toBe(400)
    } finally {
      await page.close()
    }
  })
})

describe('M124 owner-only store and commands', () => {
  it('grants nothing without a grant, fails the kill switch closed and keeps the audit bounded', async () => {
    const data = await folder()
    const store = new ConnectorStore(data)
    expect(await store.grant('default')).toBeUndefined()
    expect(await store.isKilled()).toBe(false)
    await mkdir(path.join(data, 'connector'), { recursive: true })
    await writeFile(path.join(data, 'connector', 'kill-switch.json'), 'not json')
    expect(await store.isKilled()).toBe(true)
    await store.setKilled(false, new Date().toISOString())
    expect(await store.isKilled()).toBe(false)
    await mkdir(path.join(data, 'connector', 'grants'), { recursive: true })
    await writeFile(
      path.join(data, 'connector', 'grants', 'default.json'),
      JSON.stringify({
        schemaVersion: CONNECTOR_SCHEMA_VERSION,
        connectionId: 'default',
        paidCapMicrousd: 5,
      }),
    )
    expect(await store.grant('default')).toBeUndefined()
    const audit = store.audit('default', Date.now)
    await audit.append('{"a":1}\n')
    const key = await audit.key()
    expect(key).toHaveLength(32)
    expect(await audit.key()).toEqual(key)
    expect(await readFile(path.join(data, 'connector', 'audit', 'default.jsonl'), 'utf8')).toBe(
      '{"a":1}\n',
    )
    if (process.platform !== 'win32')
      expect((await field(stat(path.join(data, 'connector', 'audit.key')), 'mode')) & 0o777).toBe(
        0o600,
      )
  })

  it('keeps the live authority current: another process’s revocation is seen (round 4 P1)', async () => {
    const data = await folder()
    const store = new ConnectorStore(data)
    await store.saveGrant(savedGrant(1))
    const authority = store.authority('default')
    // Switched off until its first reading (fail closed).
    expect(authority.current()).toEqual({ grant: undefined, killed: true })
    const changed = vi.fn()
    const stop = authority.watch(changed)
    try {
      await authority.refresh()
      expect(authority.current()).toMatchObject({ killed: false, grant: { generation: 1 } })
      // The owner's `mcp revoke`, in another process, rewrites the grant: the watch reads it.
      await new ConnectorStore(data).saveGrant({ ...savedGrant(2), revoked: true })
      await vi.waitFor(
        () => {
          expect(authority.current().grant?.revoked).toBe(true)
        },
        { timeout: 3000 },
      )
      expect(changed).toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  it('drops an authority reading that finishes after a newer one (round 4 P1)', async () => {
    const store = new ConnectorStore(await folder())
    const authority = store.authority('default')
    const older = Promise.withResolvers<undefined>()
    vi.spyOn(store, 'grant')
      .mockImplementationOnce(async () => {
        await older.promise
        return savedGrant(1)
      })
      .mockImplementationOnce(() => Promise.resolve(savedGrant(2)))
    const first = authority.refresh()
    await authority.refresh()
    older.resolve(undefined)
    await first
    expect(authority.current().grant?.generation).toBe(2)
  })

  it('keeps the limits of one grant across server processes and restarts (RVM124 P2-7)', async () => {
    const data = await folder()
    // Two stores on one folder stand for two server processes: no memory is shared.
    // A fixed clock: no token refills while twenty updates take turns at the lock.
    const first = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    const second = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    const taken = await Promise.all(
      Array.from({ length: 2 * CONNECTOR_LIMITS.burst }, (_, index) =>
        (index % 2 === 0 ? first : second).take(),
      ),
    )
    expect(taken.filter(Boolean)).toHaveLength(CONNECTOR_LIMITS.burst)
    const restarted = new SharedLimits(new ConnectorStore(data).limits('default'), fixedNow)
    expect(await restarted.take()).toBe(false)
  })

  it('parses only its own words and needs a terminal confirmation to widen authority', async () => {
    expect(parseConnectorCommand([])).toEqual({ kind: 'serve', connectionId: 'default' })
    expect(parseConnectorCommand(['--connection', 'codex'])).toEqual({
      kind: 'serve',
      connectionId: 'codex',
    })
    expect(parseConnectorCommand(['--workspace', '.'])).toBeUndefined()
    expect(parseConnectorCommand(['grant'])).toBeUndefined()
    expect(parseConnectorCommand(['kill', '--key', 'sk-secret'])).toBeUndefined()
    const data = await folder()
    const store = new ConnectorStore(data)
    const printed: string[] = []
    const io = {
      isInteractive: false,
      now: Date.now,
      print: (line: string) => {
        printed.push(line)
      },
      printError: (line: string) => {
        printed.push(line)
      },
      confirm: vi.fn(() => Promise.resolve(true)),
    }
    const grant = parseConnectorCommand(['grant', '--workspace', data])
    if (grant?.kind !== 'grant') throw new Error('grant parse')
    expect(await runConnectorCommand(store, grant, io)).toBe(1)
    expect(io.confirm).not.toHaveBeenCalled()
    expect(await store.grant('default')).toBeUndefined()
    const interactive = { ...io, isInteractive: true }
    const paid = parseConnectorCommand(['grant', '--workspace', data, '--scope', 'paid:request'])
    if (paid?.kind !== 'grant') throw new Error('paid parse')
    expect(await runConnectorCommand(store, paid, interactive)).toBe(2)
    expect(await runConnectorCommand(store, grant, interactive)).toBe(0)
    const saved = await store.grant('default')
    expect(saved?.scopes).toContain('control:stop')
    expect(saved?.scopes).not.toContain('content:read')
    expect(saved?.paidCapMicrousd).toBe(0)
    expect(await runConnectorCommand(store, { kind: 'revoke', connectionId: 'default' }, io)).toBe(
      0,
    )
    const revoked = await store.grant('default')
    expect(revoked?.revoked).toBe(true)
    expect(await runConnectorCommand(store, { kind: 'kill' }, io)).toBe(0)
    expect(await store.isKilled()).toBe(true)
    // Re-enabling widens authority: refused without a terminal.
    expect(await runConnectorCommand(store, { kind: 'resume' }, io)).toBe(1)
    expect(await store.isKilled()).toBe(true)
    expect(await runConnectorCommand(store, { kind: 'resume' }, interactive)).toBe(0)
    // Every owner command that changed something left its control receipt (RVM124B P2-4).
    const controls = async (journal: string) => {
      const text = await readFile(path.join(data, 'connector', 'audit', `${journal}.jsonl`), 'utf8')
      return text
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { event: string; control?: string; grantGeneration?: number },
        )
    }
    expect(await controls('default')).toEqual([
      expect.objectContaining({ event: 'control', control: 'grant', grantGeneration: 1 }),
      expect.objectContaining({ event: 'control', control: 'revoke', grantGeneration: 2 }),
    ])
    const owner = await controls('_owner')
    expect(owner.map((record) => record.control)).toEqual(['kill', 'resume'])
  })
})
