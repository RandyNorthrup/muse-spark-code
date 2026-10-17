// M124 (RVM124R4 finding 3): the runtime's shutdown owns the approval page
// and its pending operations. The page's start-up is held (the module is
// mocked); the client leaves while it starts: the runtime must not finish
// before that start-up has settled, must close the page, and must never open
// a browser afterwards. With operations still draining it must stop them
// first and finish only once they have (registry.drained, held here).
import { mkdtemp } from 'node:fs/promises'
import { request, type IncomingHttpHeaders } from 'node:http'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_COMPANION_LIMITS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import * as companion from '../../src/runtime/companion/server'
import { startApprovalPage, type ApprovalPage } from '../../src/runtime/connector/approvalPage'
import { parseConnectorCommand, runConnectorCommand } from '../../src/runtime/connector/command'
import { runConnector, type ConnectorRuntimeDeps } from '../../src/runtime/connector/entry'
import { ConnectorStore } from '../../src/runtime/connector/store'
import { ConnectorRegistry } from '../../src/core/connector/registry'
import { removeFolder } from './helpers/temporaryFolders'

/** Real loopback HTTP against the real approval server (main's test overhaul deleted `./helpers/companion`). */
function headers(panel: { url: string }, token?: string): string[] {
  const origin = new URL(panel.url).origin
  return [
    'Host',
    new URL(origin).host,
    'Origin',
    origin,
    'Sec-Fetch-Site',
    'same-origin',
    'X-Muse-Panel',
    '1',
    'Content-Type',
    'application/json',
    ...(token === undefined ? [] : ['Authorization', `Bearer ${token}`]),
  ]
}

function call(
  panel: { url: string },
  path: string,
  method = 'GET',
  body?: string | Buffer,
  supplied?: string[],
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      new URL(path, panel.url),
      { method, headers: supplied ?? headers(panel), setHost: false },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

vi.mock('../../src/runtime/connector/approvalPage', () => ({ startApprovalPage: vi.fn() }))

const frame = (message: unknown) => `${JSON.stringify(message)}\n`

/** A user-library grant that may ask to save prompts, made by the owner's own command. */
async function granted(data: string): Promise<void> {
  const command = parseConnectorCommand(['grant', '--user-library', '--scope', 'prompts:write'])
  if (command?.kind !== 'grant') throw new Error('grant parse')
  const code = await runConnectorCommand(new ConnectorStore(data), command, {
    isInteractive: true,
    now: Date.now,
    print: vi.fn(),
    printError: vi.fn(),
    confirm: () => Promise.resolve(true),
  })
  expect(code).toBe(0)
}

/** The runtime serving `stdin` over a data folder; its replies are read and dropped. */
function runtimeDeps(
  data: string,
  stdin: PassThrough,
  openBrowser: (url: string) => Promise<void>,
): ConnectorRuntimeDeps {
  const stdout = new PassThrough()
  stdout.resume()
  return {
    argv: [],
    table: EN,
    locale: 'en',
    dataFolder: data,
    homeDir: data,
    version: '0.0.0-test',
    stdin,
    stdout,
    stderr: new PassThrough(),
    isInteractive: false,
    registered: () => [],
    openBrowser,
    schedules: {
      list: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
      pause: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
    },
    reports: { generate: () => Promise.resolve('') },
  }
}

/** A real connector with captured replies, kept until its client leaves. */
function serveWithReplies(data: string, openBrowser: (url: string) => Promise<void>) {
  const stdin = new PassThrough()
  const deps = runtimeDeps(data, stdin, openBrowser)
  let text = ''
  deps.stdout.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  return {
    stdin,
    running: runConnector(deps),
    output: () => text,
    clearOutput: () => {
      text = ''
    },
  }
}

/** The client initializes and requests a save that needs our approval page. */
function requestSave(stdin: PassThrough, id = 1): void {
  if (id === 1)
    stdin.write(
      frame({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } },
      }),
    )
  stdin.write(
    frame({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: 'muse_prompt_save',
        arguments: {
          requestId: `r${String(id)}`,
          expectedGeneration: 0,
          scope: 'user',
          title: 'Saved',
          body: 'Body',
        },
      },
    }),
  )
}

/** A fresh socket cannot reuse an HTTP connection that the page already closed. */
async function expectRetired(url: string): Promise<void> {
  const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(url).port) })
  try {
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    await expect(connected).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  } finally {
    socket.destroy()
  }
}

/** Idle expiry must not keep the runtime attached to a dead approval page. */
async function recoverAfterIdle(data: string, isFirstOpenerRejected: boolean): Promise<void> {
  await granted(data)
  const actual = await vi.importActual<{ startApprovalPage: typeof startApprovalPage }>(
    '../../src/runtime/connector/approvalPage',
  )
  vi.mocked(startApprovalPage).mockImplementation(actual.startApprovalPage)
  const startServer = companion.startCompanionServer
  const servers: Awaited<ReturnType<typeof startServer>>[] = []
  const start = vi.spyOn(companion, 'startCompanionServer').mockImplementation(async (options) => {
    const server = await startServer({
      ...options,
      // Only the first idle delay changes; its production close callback is untouched.
      limits: {
        ...options.limits,
        idleTimeoutMs: servers.length === 0 ? 100 : options.limits.idleTimeoutMs,
      },
    })
    servers.push(server)
    return server
  })
  const urls: string[] = []
  const openBrowser = vi.fn((url: string) => {
    urls.push(url)
    return isFirstOpenerRejected && urls.length === 1
      ? Promise.reject(new Error('test opener failed'))
      : Promise.resolve()
  })
  const { stdin, running, output, clearOutput } = serveWithReplies(data, openBrowser)
  try {
    requestSave(stdin)
    await vi.waitFor(
      () => {
        expect(output()).toContain(
          isFirstOpenerRejected ? 'approval_unavailable' : 'awaitingApproval',
        )
      },
      { timeout: 5000 },
    )
    const first = servers[0]
    if (first === undefined) throw new Error('approval server absent')
    await first.closed
    await expectRetired(first.url)
    clearOutput()
    requestSave(stdin, 2)
    await vi.waitFor(
      () => {
        expect(output()).toContain('awaitingApproval')
      },
      { timeout: 5000 },
    )
    expect(start).toHaveBeenCalledTimes(2)
    expect(openBrowser).toHaveBeenCalledTimes(2)
    const second = servers[1]
    if (second === undefined) throw new Error('replacement approval server absent')
    expect(urls[1]).toContain(second.url)
    expect(await call(second, '/')).toHaveProperty('status', 200)
    stdin.end()
    expect(await running).toBe(0)
    await second.closed
    await expectRetired(second.url)
  } finally {
    stdin.end()
    await running
    for (const server of servers) await server.close()
    start.mockRestore()
  }
}

async function shutDownWhilePageStarts(data: string): Promise<void> {
  await granted(data)
  const starting = Promise.withResolvers<ApprovalPage>()
  vi.mocked(startApprovalPage).mockReturnValue(starting.promise)
  const openBrowser = vi.fn(() => Promise.resolve())
  const stdin = new PassThrough()
  let isDone = false
  const running = (async () => {
    const code = await runConnector(runtimeDeps(data, stdin, openBrowser))
    isDone = true
    return code
  })()
  requestSave(stdin)
  await vi.waitFor(
    () => {
      expect(startApprovalPage).toHaveBeenCalled()
    },
    { timeout: 5000 },
  )
  // The client leaves while the page is still starting.
  stdin.end()
  await sleep(300)
  expect(isDone).toBe(false)
  const closed = Promise.withResolvers<undefined>()
  const page: ApprovalPage = {
    closed: closed.promise,
    launchUrl: () => 'http://127.0.0.1:9/',
    isWatched: () => false,
    changed: vi.fn(),
    close: vi.fn(() => {
      closed.resolve(undefined)
      return Promise.resolve()
    }),
  }
  starting.resolve(page)
  expect(await running).toBe(0)
  expect(page.close).toHaveBeenCalled()
  expect(openBrowser).not.toHaveBeenCalled()
}

/** A failed opener must not orphan the real page's listener or idle timer. */
async function shutDownAfterOpenerRejects(data: string): Promise<void> {
  await granted(data)
  const actual = await vi.importActual<{ startApprovalPage: typeof startApprovalPage }>(
    '../../src/runtime/connector/approvalPage',
  )
  let page: ApprovalPage | undefined
  vi.mocked(startApprovalPage).mockImplementation(async (owner) => {
    const started = await actual.startApprovalPage(owner)
    page = { ...started, close: vi.fn(started.close) }
    return page
  })
  const timers = vi.spyOn(globalThis, 'setTimeout')
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  let url = ''
  const openBrowser = vi.fn((launchUrl: string) => {
    url = new URL(launchUrl).origin
    return Promise.reject(new Error('test opener failed'))
  })
  const { stdin, running, output } = serveWithReplies(data, openBrowser)
  try {
    requestSave(stdin)
    await vi.waitFor(() => {
      expect(output()).toContain('approval_unavailable')
      expect(output()).toContain('"isError":true')
    })
    expect(openBrowser).toHaveBeenCalledTimes(1)
    // A rejected opener retires its page immediately, while shutdown still owns cleanup.
    await expectRetired(url)
    const idleIndex = timers.mock.calls.findIndex(
      ([, delay]) => delay === CONNECTOR_COMPANION_LIMITS.idleTimeoutMs,
    )
    const idle = timers.mock.results[idleIndex]
    if (idle?.type !== 'return') throw new Error('approval idle timer absent')
    stdin.end()
    expect(await running).toBe(0)
    expect(page?.close).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith(idle.value)
    // A fresh socket proves the listener is gone without reusing HTTP's idle connection.
    await expectRetired(url)
  } finally {
    stdin.end()
    await running
    await page?.close()
    timers.mockRestore()
    clear.mockRestore()
  }
}

/** Disconnects with operations still draining (held), then lets them settle. */
async function shutDownWhileDraining(data: string): Promise<void> {
  await granted(data)
  const draining = Promise.withResolvers<undefined>()
  const drained = vi.spyOn(ConnectorRegistry.prototype, 'drained').mockReturnValue(draining.promise)
  const disconnect = vi.spyOn(ConnectorRegistry.prototype, 'disconnect')
  try {
    const stdin = new PassThrough()
    let isDone = false
    const running = (async () => {
      const code = await runConnector(runtimeDeps(data, stdin, vi.fn()))
      isDone = true
      return code
    })()
    stdin.end()
    await vi.waitFor(() => {
      expect(drained).toHaveBeenCalled()
    })
    await sleep(300)
    expect(isDone).toBe(false)
    draining.resolve(undefined)
    expect(await running).toBe(0)
    // The transport stopped the client's calls first; the runtime then waited for them.
    expect(disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      drained.mock.invocationCallOrder[0] ?? 0,
    )
  } finally {
    drained.mockRestore()
    disconnect.mockRestore()
  }
}

describe('M124 runtime shutdown (RVM124R4 P2-3, RVM124R5 P2-1)', () => {
  for (const [label, scenario] of [
    [
      'finishes only after the approval page’s start-up settled, closes it and opens no browser late',
      shutDownWhilePageStarts,
    ],
    ['finishes only after its pending operations have drained', shutDownWhileDraining],
    [
      'refuses after the browser opener rejects and closes the real approval listener and idle timer at stdin end',
      shutDownAfterOpenerRejects,
    ],
    [
      'restarts an idle-closed approval page and invokes the recovered browser opener',
      (data: string) => recoverAfterIdle(data, true),
    ],
    [
      'restarts an idle-closed approval page after a successful browser opener',
      (data: string) => recoverAfterIdle(data, false),
    ],
  ] as const)
    it(label, async () => {
      const data = await mkdtemp(path.join(os.tmpdir(), 'm124-entry-'))
      try {
        await scenario(data)
      } finally {
        await removeFolder(data)
      }
    })
})
