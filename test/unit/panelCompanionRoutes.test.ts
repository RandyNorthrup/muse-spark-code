// M104 lane C: the companion MHP routes over a real server. A real
// transport binds a real connection (real delivery, real surfaces) to the
// routes; a real HTTP client plays the window, and the test plays the
// session's side by emitting the session's own MHP requests through the
// real connection. Views are real: the tasks tab answers without a
// backend, so the suite needs none. (The packed suite proves the real
// session behind the same transport.)
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HTTP_STATUS, MHP, MHP_PANEL, PANEL_COMPANION_LIMITS } from '../../src/shared/constants'
import { fallbackUiCallSchema, fallbackUiReplySchema } from '../../src/shared/hostApi/fallbackUi'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
  panelLifecycleSchema,
  type MhpPanelBinding,
} from '../../src/shared/hostApi/panel'
import type { MhpParams } from '../../src/shared/hostApi/methods'
import type { PanelView } from '../../src/runtime/panel/surfaces'
import { withDeadline } from '../../src/core/timeouts'
import { PanelConnection, MhpServiceError } from '../../src/runtime/panel/connection'
import { agentVersion } from './helpers/agentVersion'
import {
  createPanelCompanionTransport,
  type PanelCompanionTransport,
} from '../../src/runtime/panel/companionTransport'
import { RuntimeTasksTab } from '../../src/runtime/panel/tasksTab'
import { startCompanionServer } from '../../src/runtime/companion/server'
import { renderCompanionPage } from '../../src/runtime/companion/page'
import type { TasksTabView } from '../../src/host/views/tasksTabPort'
import { tasksHostMessageSchema } from '../../src/shared/tasksProtocol'
import { removeFolder } from './helpers/temporaryFolders'

interface HttpReply {
  readonly status: number
  readonly authorization: string | undefined
  readonly body: string
}

function call(
  url: string,
  options: {
    readonly headers?: Record<string, string>
    readonly body?: string
    /** A declared length without its body: the server refuses on the headers alone. */
    readonly contentLength?: number
  } = {},
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const headers = { ...options.headers }
    if (options.contentLength !== undefined)
      headers['Content-Length'] = String(options.contentLength)
    else if (options.body !== undefined && headers['Content-Length'] === undefined)
      headers['Content-Length'] = String(Buffer.byteLength(options.body))
    const request = httpRequest(
      {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          const authorization = response.headers.authorization
          resolve({
            status: response.statusCode ?? 0,
            authorization: Array.isArray(authorization) ? authorization.join(', ') : authorization,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    request.end(options.body)
  })
}

/** Reads data frames from a stream the way the window's bridge does. */
function openStream(
  url: string,
  headers: Record<string, string>,
): {
  readonly opened: Promise<number>
  readonly frames: unknown[]
  readonly closed: Promise<void>
  close(): void
} {
  const frames: unknown[] = []
  let buffer = ''
  const parsed = new URL(url)
  const request = httpRequest({
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    headers,
  })
  const opened = new Promise<number>((resolve) => {
    request.on('response', (response: IncomingMessage) => {
      resolve(response.statusCode ?? 0)
    })
    request.on('error', () => {
      resolve(0)
    })
  })
  const closed = new Promise<void>((resolve) => {
    request.on('response', (response: IncomingMessage) => {
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts)
          for (const line of part.split('\n'))
            if (line.startsWith('data:')) frames.push(JSON.parse(line.slice('data:'.length)))
      })
      // The stream always closes: after its last frame, or when it breaks.
      response.once('close', () => {
        resolve()
      })
    })
    request.on('error', () => {
      resolve()
    })
  })
  request.end('{}')
  return {
    opened,
    frames,
    closed,
    close: () => {
      request.destroy()
    },
  }
}

async function waitFor(frames: readonly unknown[], count: number): Promise<void> {
  const started = Date.now()
  while (frames.length < count) {
    if (Date.now() - started > 4000)
      throw new Error(`only ${String(frames.length)} of ${String(count)} frames arrived`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function envelope(surface: string, payload: unknown): string {
  return JSON.stringify(
    panelEnvelopeSchema.parse({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panel',
      surface,
      seq: 1,
      direction: 'toHost',
      payload,
    }),
  )
}

/** The call's answer marker, or the refusal it rejected with. */
async function outcomeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
    return 'answered'
  } catch (error: unknown) {
    return error
  }
}

/** Every outcome is the session's refusal with its code, never an answer. */
function expectServiceRefusals(outcomes: readonly unknown[], message: string): void {
  for (const outcome of outcomes) {
    if (!(outcome instanceof MhpServiceError) || outcome.message !== message)
      throw new Error(`a call settled past ${message}`)
  }
}

function headers(origin: string, bearer?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: origin,
    'x-muse-panel': '1',
    ...(bearer !== undefined && { Authorization: `Bearer ${bearer}` }),
  }
}

type CompanionServer = Awaited<ReturnType<typeof startCompanionServer>>

/** An open window: the bearer it exchanged, its binding, and the server's origin. */
interface CompanionWindow {
  readonly bearer: string
  readonly binding: MhpPanelBinding
  readonly origin: string
}

/** The guard's refusal: its status, and its code as the whole body. */
function expectGuardRefusal(reply: HttpReply, status: number, code: string): void {
  expect(reply.status).toBe(status)
  expect(reply.body).toBe(JSON.stringify({ error: code }))
}

/** The contract's refusal: its status, and its frame carrying the code. */
function expectPanelRefusal(reply: HttpReply, status: number, code: string): void {
  expect(reply.status).toBe(status)
  const frame = panelErrorSchema.parse(JSON.parse(reply.body))
  expect(frame.code).toBe(code)
}

/** The launch URLs the transport mints through the server, once it starts. */
function launchUrls(): {
  readonly started: { server?: CompanionServer }
  issue(context: string): string
  retire(context: string): void
} {
  const started: { server?: CompanionServer } = {}
  return {
    started,
    issue: (context) => {
      if (started.server === undefined) throw new Error('EPANEL_CLOSED')
      return started.server.launchUrl(context)
    },
    retire: (context) => {
      started.server?.retireContext(context)
    },
  }
}

function lifecycle(binding: MhpPanelBinding, event: 'opened' | 'ready'): string {
  return JSON.stringify(
    panelLifecycleSchema.parse({ mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event }),
  )
}

interface Harness {
  readonly connection: PanelConnection
  readonly transport: PanelCompanionTransport
  readonly server: CompanionServer
  readonly announced: string[]
  readonly errors: string[]
  readonly warns: string[]
  readonly reports: unknown[]
  readonly initialized: MhpParams<'initialize'>[]
  readonly tabs: Map<string, { tab: RuntimeTasksTab; view: TasksTabView }>
  readonly folder: string
  addTasks(sessionId: string, conversation: string): TasksTabView
}

describe('panel companion routes (real server, transport and connection)', () => {
  let harness: Harness | undefined

  beforeEach(async () => {
    const announced: string[] = []
    const errors: string[] = []
    const warns: string[] = []
    const reports: unknown[] = []
    const initialized: MhpParams<'initialize'>[] = []
    const log = {
      error: (message: string) => {
        errors.push(message)
      },
      warn: (message: string) => {
        warns.push(message)
      },
      info: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
    }
    const views = new Map<string, PanelView>()
    const tabs = new Map<string, { tab: RuntimeTasksTab; view: TasksTabView }>()
    const addTasks = (sessionId: string, conversation: string): TasksTabView => {
      const tab = new RuntimeTasksTab({
        openSurfaces: () => [],
        openSurface: () => Promise.resolve(),
        focusSurface: () => Promise.resolve(),
        revealConversation: () => Promise.resolve(),
        log,
      })
      const view: TasksTabView = {
        conversation,
        items: [
          { text: 'Open the window', status: 'completed' },
          { text: 'Chat over the routes', status: 'in_progress' },
        ],
      }
      tab.open(view)
      views.set(sessionId, tab)
      tabs.set(sessionId, { tab, view })
      return view
    }
    addTasks('session-1', 'Companion window')
    const connection = new PanelConnection(
      {
        capabilities: ['lifecycle', 'settings', 'storage'],
        initialize: (params) => {
          initialized.push(params)
          return Promise.resolve()
        },
        initialized: () => undefined,
        request: () => Promise.reject(new Error('the window makes no MHP requests')),
        notify: () => undefined,
        view: (binding) => views.get(binding.sessionId),
        closed: () => undefined,
      },
      log,
    )
    const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'panel-companion-')))
    const launches = launchUrls()
    const transport = createPanelCompanionTransport({
      connection,
      log,
      version: agentVersion(new URL('../../package.json', import.meta.url)),
      locale: 'en',
      workspaceUri: pathToFileURL(folder).href,
      workspaceName: path.basename(folder),
      issueLaunch: launches.issue,
      retireLaunch: launches.retire,
      announce: (url) => {
        announced.push(url)
      },
    })
    const server = await startCompanionServer({
      handler: transport.handler,
      services: transport.services,
      limits: PANEL_COMPANION_LIMITS,
      assets: new Map(),
      renderPage: (nonce) =>
        renderCompanionPage(nonce, {
          locale: 'en',
          title: 'Companion window',
          stylesheets: [],
          modules: [],
          imports: {},
          uiTable: {},
          usageTable: {},
        }),
      report: (error) => {
        reports.push(error)
      },
    })
    launches.started.server = server
    harness = {
      connection,
      transport,
      server,
      announced,
      errors,
      warns,
      reports,
      initialized,
      tabs,
      folder,
      addTasks,
    }
  })

  afterEach(async () => {
    await harness?.server.close()
    if (harness !== undefined) await removeFolder(harness.folder)
    harness = undefined
  })

  function use(): Harness {
    if (harness === undefined) throw new Error('the harness is gone')
    return harness
  }

  /** The handshake, then the session's first window. */
  async function bootWindow(): Promise<CompanionWindow> {
    const { transport } = use()
    transport.handshake()
    return await openWindow()
  }

  /** The session opens a surface; the window exchanges its launch code. */
  async function openWindow(): Promise<CompanionWindow> {
    const { connection, transport, announced } = use()
    // The synthetic handshake lands asynchronously; the refused attempts
    // throw before delivery, so the first accepted call is the open.
    const started = Date.now()
    let opened: Awaited<ReturnType<typeof connection.request<'surfaces/open'>>> | undefined
    while (opened === undefined) {
      try {
        opened = await connection.request('surfaces/open', {
          kind: 'tasks',
          placement: 'window',
          sessionId: 'session-1',
        })
      } catch (error: unknown) {
        // NARROW: the handshake is still landing; any other refusal fails the test.
        if (!(error instanceof MhpServiceError) || error.message !== 'MHP_NOT_INITIALIZED')
          throw error
        if (Date.now() - started > 4000) throw error
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
    if (typeof opened.surfaceId !== 'string') throw new TypeError('the window minted no surface id')
    const surface = opened.surfaceId
    const launched = announced.at(-1) ?? ''
    const code = new URL(launched).hash.slice('#k='.length)
    const origin = new URL(launched).origin
    const exchanged = await call(`${origin}/session`, {
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'x-muse-panel': '1',
      },
      body: JSON.stringify({ code }),
    })
    expect(exchanged.status).toBe(HTTP_STATUS.ok)
    const bearer = (exchanged.authorization ?? '').replace(/^Bearer /, '')
    expect(bearer).toMatch(/^[\da-f]{64}$/)
    const binding = transport.bindingFor(surface)
    if (binding === undefined) throw new Error('the window minted no binding')
    expect(binding).toEqual({ surface, sessionId: 'session-1', surfaceKind: 'tasks' })
    return { bearer, binding, origin }
  }

  it('sends the synthetic handshake the session boots from', () => {
    const { transport, initialized } = use()
    transport.handshake()
    expect(initialized).toHaveLength(1)
    expect(initialized.at(0)).toMatchObject({
      capabilities: ['lifecycle', 'surfaces', 'ui'],
      trusted: false,
    })
  })

  it('opens a tasks surface over the routes and publishes its list', async () => {
    const { tabs } = use()
    const window = await bootWindow()
    const stream = openStream(
      `${window.origin}/panel/events`,
      headers(window.origin, window.bearer),
    )
    expect(await stream.opened).toBe(HTTP_STATUS.ok)
    try {
      const opened = await call(`${window.origin}/panel/surface`, {
        headers: headers(window.origin, window.bearer),
        body: lifecycle(window.binding, 'opened'),
      })
      expect(opened.status).toBe(HTTP_STATUS.noContent)
      const ready = await call(`${window.origin}/panel/surface`, {
        headers: headers(window.origin, window.bearer),
        body: lifecycle(window.binding, 'ready'),
      })
      expect(ready.status).toBe(HTTP_STATUS.noContent)
      await waitFor(stream.frames, 1)
      const published = tasksHostMessageSchema.parse(
        panelEnvelopeSchema.parse(stream.frames.at(0)).payload,
      )
      expect(published.conversation).toBe('Companion window')
      expect(published.items).toEqual(tabs.get('session-1')?.view.items)
      const asked = await call(`${window.origin}/panel/message`, {
        headers: headers(window.origin, window.bearer),
        body: envelope(window.binding.surface, { type: 'tasksReady' }),
      })
      expect(asked.status).toBe(HTTP_STATUS.noContent)
      await waitFor(stream.frames, 2)
      expect(
        tasksHostMessageSchema.parse(panelEnvelopeSchema.parse(stream.frames.at(1)).payload).type,
      ).toBe('tasksState')
    } finally {
      stream.close()
    }
  })

  it('carries a ui question to the window and its answer back', async () => {
    const { connection } = use()
    const window = await bootWindow()
    const asked = connection.request('ui/confirm', {
      title: 'Leave the window',
      message: 'Close this window?',
      choices: [
        { id: 'yes', title: 'Close it' },
        { id: 'no', title: 'Keep it' },
      ],
    })
    const ui = openStream(`${window.origin}/host/events`, headers(window.origin, window.bearer))
    expect(await ui.opened).toBe(HTTP_STATUS.ok)
    try {
      await waitFor(ui.frames, 1)
      const frame = fallbackUiCallSchema.parse(ui.frames.at(0))
      if (frame.method !== 'ui/confirm') throw new Error('the window was asked the wrong question')
      expect(frame.params).toMatchObject({ title: 'Leave the window' })
      const replied = await call(`${window.origin}/host/message`, {
        headers: headers(window.origin, window.bearer),
        body: JSON.stringify(
          fallbackUiReplySchema.parse({
            jsonrpc: MHP.jsonRpcVersion,
            id: frame.id,
            result: 'yes',
          }),
        ),
      })
      expect(replied.status).toBe(HTTP_STATUS.noContent)
      await expect(asked).resolves.toBe('yes')
    } finally {
      ui.close()
    }
  })

  it('retires the live window when the session opens another', async () => {
    const { announced } = use()
    const first = await bootWindow()
    const stream = openStream(`${first.origin}/panel/events`, headers(first.origin, first.bearer))
    expect(await stream.opened).toBe(HTTP_STATUS.ok)
    const second = await openWindow()
    expect(announced).toHaveLength(2)
    expect(second.binding.surface).not.toBe(first.binding.surface)
    await withDeadline(stream.closed, 4000, 'the retired window stayed subscribed')
    const dead = await call(`${first.origin}/panel/message`, {
      headers: headers(first.origin, first.bearer),
      body: envelope(first.binding.surface, { type: 'tasksReady' }),
    })
    expectGuardRefusal(dead, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
    const live = await call(`${second.origin}/panel/surface`, {
      headers: headers(second.origin, second.bearer),
      body: lifecycle(second.binding, 'opened'),
    })
    expect(live.status).toBe(HTTP_STATUS.noContent)
    stream.close()
  })

  it('retires the window on surfaces/close', async () => {
    const { connection, transport } = use()
    const window = await bootWindow()
    await expect(
      connection.request('surfaces/close', { surfaceId: window.binding.surface }),
    ).resolves.toBeNull()
    expect(transport.bindingFor(window.binding.surface)).toBeUndefined()
    const dead = await call(`${window.origin}/panel/message`, {
      headers: headers(window.origin, window.bearer),
      body: envelope(window.binding.surface, { type: 'tasksReady' }),
    })
    expectGuardRefusal(dead, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
  })

  it('ends the connection past MHP’s queue bound while the window is away', async () => {
    const { connection, errors } = use()
    await bootWindow()
    const calls = Array.from({ length: MHP_PANEL.maximumQueuedMessages }, () =>
      outcomeOf(connection.request('ui/notify', { severity: 'information', message: 'queued' })),
    )
    expectServiceRefusals(await Promise.all(calls), 'MHP_CONNECTION_CLOSED')
    expect(errors.join('\n')).toContain('MHP host stopped reading')
    const refused = await outcomeOf(
      connection.request('ui/notify', { severity: 'warning', message: 'one too many' }),
    )
    expectServiceRefusals([refused], 'MHP_NOT_INITIALIZED')
  })

  it('drops queued ui calls the session cancels', async () => {
    const { connection } = use()
    const window = await bootWindow()
    const half = MHP_PANEL.maximumQueuedMessages / 2
    for (let round = 0; round < 3; round += 1) {
      const controllers = Array.from({ length: half }, () => new AbortController())
      const calls = controllers.map((controller) =>
        outcomeOf(
          connection.request(
            'ui/notify',
            { severity: 'information', message: 'queued' },
            controller.signal,
          ),
        ),
      )
      for (const controller of controllers) controller.abort()
      expectServiceRefusals(await Promise.all(calls), 'MHP_CANCELLED')
    }
    const fresh = outcomeOf(
      connection.request('ui/notify', { severity: 'warning', message: 'fresh' }),
    )
    const ui = openStream(`${window.origin}/host/events`, headers(window.origin, window.bearer))
    expect(await ui.opened).toBe(HTTP_STATUS.ok)
    try {
      await waitFor(ui.frames, 1)
      expect(ui.frames).toHaveLength(1)
      expect(fallbackUiCallSchema.parse(ui.frames.at(0))).toMatchObject({
        method: 'ui/notify',
      })
    } finally {
      ui.close()
    }
    connection.close()
    expectServiceRefusals([await fresh], 'MHP_CONNECTION_CLOSED')
  })

  it('refuses a post without the window’s bearer', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/message`, {
      headers: headers(window.origin),
      body: envelope(window.binding.surface, { type: 'tasksReady' }),
    })
    expectGuardRefusal(refused, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
  })

  it('refuses a post from another origin', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/message`, {
      headers: { ...headers(window.origin, window.bearer), Origin: 'http://evil.test' },
      body: envelope(window.binding.surface, { type: 'tasksReady' }),
    })
    expectGuardRefusal(refused, HTTP_STATUS.forbidden, 'EPANEL_ORIGIN')
  })

  it('refuses a post without the panel header', async () => {
    const window = await bootWindow()
    const headed = headers(window.origin, window.bearer)
    delete headed['x-muse-panel']
    const refused = await call(`${window.origin}/panel/message`, {
      headers: headed,
      body: envelope(window.binding.surface, { type: 'tasksReady' }),
    })
    expectGuardRefusal(refused, HTTP_STATUS.forbidden, 'EPANEL_HEADER')
  })

  it('refuses an envelope for a surface the window never opened', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/message`, {
      headers: headers(window.origin, window.bearer),
      body: envelope('no-such-surface', { type: 'tasksReady' }),
    })
    expectPanelRefusal(refused, HTTP_STATUS.notFound, 'MHP_PANEL_UNKNOWN_SURFACE')
  })

  it('refuses lifecycle for a surface the window never opened', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/surface`, {
      headers: headers(window.origin, window.bearer),
      body: lifecycle({ ...window.binding, surface: 'no-such-surface' }, 'opened'),
    })
    expectPanelRefusal(refused, HTTP_STATUS.notFound, 'MHP_PANEL_UNKNOWN_SURFACE')
  })

  it('refuses a body larger than MHP’s envelope', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/message`, {
      headers: headers(window.origin, window.bearer),
      contentLength: PANEL_COMPANION_LIMITS.maxBodyBytes + 1,
    })
    expectPanelRefusal(refused, HTTP_STATUS.requestTooLarge, 'MHP_PANEL_TOO_LARGE')
  })

  it('refuses a malformed envelope aloud', async () => {
    const window = await bootWindow()
    const refused = await call(`${window.origin}/panel/message`, {
      headers: headers(window.origin, window.bearer),
      body: '{}',
    })
    expectPanelRefusal(refused, HTTP_STATUS.badRequest, 'MHP_PANEL_INVALID_PAYLOAD')
  })
})
