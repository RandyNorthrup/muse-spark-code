import * as z from 'zod/mini'
import * as crypto from 'node:crypto'
import { createHmac, randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { request, type IncomingMessage } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { makePrivateFolder, makerTempRoot, runtimeMakerNative } from './helpers/makerTemp'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMakerHost } from '../../src/runtime/maker/runtimeMakerHost'
import { startCompanion } from '../../src/runtime/maker/companionServer'
import { startThonnyServer, type ThonnyPortOwner } from '../../src/runtime/maker/thonnyServer'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { spawn } from 'node:child_process'
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'
import { RUNTIME_MAKER_LAUNCH_CODE_MS } from '../../src/shared/constants'
import { companionLaunchSchema } from '../../src/shared/companionProtocol'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'
import { MakerApproval } from '../../src/core/maker/ports'
import { machineSimulator, makerLimits } from './helpers/makerMachineSimulator'

const secrets = {
  get: () => Promise.resolve(undefined),
  store: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})
async function companion(bind?: string) {
  const directory = await mkdtemp(path.join(makerTempRoot(), 'maker-transport-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const workspace = path.join(directory, 'repo')
  await mkdir(workspace)
  const host = await RuntimeMakerHost.create({
    dataDirectory: path.join(directory, 'data'),
    workspace,
    secrets,
    trusted: () => true,
    flagged: () => true,
    presence: { check: () => Promise.resolve('approved' as const) },
    interactive: () => true,
    auditEnable: () => Promise.resolve(),
  })
  const dispatched: [unknown, AbortSignal][] = []
  const dispatch = (message: unknown, signal: AbortSignal) => {
    dispatched.push([message, signal])
    return Promise.resolve({ stopped: true })
  }
  const server = await startCompanion({
    host,
    dispatch,
    tools: () => [],
    provider: { host: '127.0.0.1', port: 12_345, token: 'panel-provider-only' },
    assets: new Map([['/', { body: '<html></html>', type: 'text/html' }]]),
    ...(bind !== undefined && { bind }),
  })
  cleanups.push(() => server.close())
  const opened = await server.open()
  expect(opened).toBe(`${server.url}/`)
  expect(new URL(opened).hash).toBe('')
  const delivery = await http(server.url, '/launch-code', { Origin: server.url }, '')
  const launch = companionLaunchSchema.parse(JSON.parse(delivery.text)).launch
  return { ...server, dispatched, host, launch }
}
interface HttpReply {
  readonly status: number
  readonly headers: IncomingMessage['headers']
  readonly text: string
}
function readHttpResponse(response: IncomingMessage): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    let text = ''
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      text += chunk
    })
    response.on('end', () => {
      resolve({ status: response.statusCode ?? 0, headers: response.headers, text })
    })
    response.on('error', reject)
  })
}
function workspaceReview(host: RuntimeMakerHost) {
  const snapshot: ApprovalRequest = {
    id: randomUUID(),
    digest: crypto.createHash('sha256').update('payload').digest('hex'),
    expiresAt: Date.now() + 30_000,
    kind: 'command',
    target: { kind: 'workspace', workspace: path.resolve('.') },
    action: 'program',
    payload: 'payload',
  }
  const engine = new MakerApproval(snapshot, () => host.hardwareEnabled())
  const pending = host.confirm(snapshot, (raw) => engine.review(raw))
  const review = JSON.stringify({
    v: 1,
    type: 'makerPayloadReviewed',
    id: snapshot.id,
    digest: snapshot.digest,
    isComplete: true,
  })
  const answer = JSON.stringify({
    v: 1,
    type: 'makerAnswer',
    answer: {
      id: snapshot.id,
      digest: snapshot.digest,
      target: snapshot.target,
      decision: 'allow_once',
    },
  })
  return { engine, pending, review, answer }
}

async function http(
  url: string,
  route: string,
  headers: Record<string, string> = {},
  data?: string,
) {
  return await new Promise<HttpReply>((resolve, reject) => {
    const outgoing = request(
      `${url}${route}`,
      { method: data === undefined ? 'GET' : 'POST', headers },
      (response) => {
        void readHttpResponse(response).then(resolve).catch(reject)
      },
    )
    outgoing.on('error', reject)
    outgoing.end(data)
  })
}
async function status(...args: Parameters<typeof http>) {
  const reply = await http(...args)
  return reply.status
}
async function answerCompanion(
  url: string,
  headers: Record<string, string>,
  answer: string,
): Promise<void> {
  const presence = await http(url, '/presence', headers, answer)
  const grant = z.object({ grant: z.string() }).parse(JSON.parse(presence.text)).grant
  expect(await status(url, '/answer', { ...headers, 'X-Maker-Approval': grant }, answer)).toBe(204)
}
async function session(server: { readonly url: string; readonly launch: string }) {
  const reply = await http(
    server.url,
    '/launch',
    { Origin: server.url },
    JSON.stringify({ launch: server.launch }),
  )
  const cookie = reply.headers['set-cookie']?.[0]?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('no cookie')
  return cookie
}
/** The real service behind a companion; `launched` opens a document and returns its headers. */
async function servedCompanion() {
  const directory = await mkdtemp(path.join(makerTempRoot(), 'maker-review-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const workspace = path.join(directory, 'repo')
  await mkdir(workspace)
  const service = await createRuntimeMakerService({
    dataDirectory: path.join(directory, 'data'),
    workspace,
    lan: { classify: () => 'private', resolve: () => Promise.resolve(['127.0.0.1']) },
    trusted: () => true,
    flagged: () => true,
    presence: { check: () => Promise.resolve('approved' as const) },
    interactive: () => true,
    secrets,
    // Windows lease identity runs SystemRoot's PowerShell; without it the claim fails closed.
    native: runtimeMakerNative(),
  })
  // A host's inherited folder ACL is not under test: the lease folder is private everywhere.
  await makePrivateFolder(path.join(directory, 'data', 'maker', 'leases'))
  // Injected port probe: real discovery needs PowerShell (Windows) or ioreg (macOS).
  service.serial.ports = () => Promise.resolve([])
  cleanups.push(() => service.close())
  await service.host.setHardware(true, 'fake supervised printer')
  const server = await startCompanion({
    host: service.host,
    dispatch: service.dispatch,
    tools: service.tools,
    assets: new Map([['/', { body: '<html></html>', type: 'text/html' }]]),
  })
  cleanups.push(() => server.close())
  const launched = async () => {
    await server.open()
    const delivery = await http(server.url, '/launch-code', { Origin: server.url }, '')
    const launch = companionLaunchSchema.parse(JSON.parse(delivery.text)).launch
    return { Cookie: await session({ ...server, launch }), Origin: server.url }
  }
  return { service, server, launched }
}
/** Reads the replay a new /events subscriber receives, then closes the stream. */
async function replay(url: string, headers: Record<string, string>) {
  return await new Promise<string>((resolve, reject) => {
    const outgoing = request(`${url}/events`, { headers }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        text += chunk
        if (!text.includes('"makerApproval"')) return
        outgoing.destroy()
        resolve(text)
      })
    })
    outgoing.on('error', reject)
    outgoing.end()
  })
}
describe('companion boundary', () => {
  it('delivers a launch code only once over same-origin loopback, never in the opened URL', async () => {
    const server = await companion()
    expect(await status(server.url, '/launch-code', { Origin: server.url }, '')).toBe(401)
    await server.open()
    expect(await status(server.url, '/launch-code', {}, '')).toBe(403)
    expect(
      await status(server.url, '/launch-code', { Origin: 'https://foreign.example' }, ''),
    ).toBe(403)
    const delivery = await http(server.url, '/launch-code', { Origin: server.url }, '')
    expect(delivery.status).toBe(200)
    expect(delivery.headers['cache-control']).toBe('no-store')
    expect(companionLaunchSchema.parse(JSON.parse(delivery.text)).launch).toMatch(/^[a-f0-9]{64}$/)
    expect(await status(server.url, '/launch-code', { Origin: server.url }, '')).toBe(401)
  })
  it('a reloaded document resumes only its own cookie session after the launch code is spent', async () => {
    const server = await companion()
    expect(await status(server.url, '/session', { Origin: server.url }, '')).toBe(401)
    const cookie = await session(server)
    expect(await status(server.url, '/launch-code', { Origin: server.url }, '')).toBe(401)
    expect(await status(server.url, '/session', { Cookie: cookie }, '')).toBe(403)
    const resumed = await http(server.url, '/session', { Origin: server.url, Cookie: cookie }, '')
    expect(resumed.status).toBe(200)
    expect(resumed.headers['set-cookie']).toBeUndefined()
    expect(JSON.parse(resumed.text)).toEqual({
      provider: { host: '127.0.0.1', port: 12_345, token: 'panel-provider-only' },
    })
  })
  it.each(['0.0.0.0', '192.168.1.2', 'localhost'])('refuses bind %s', async (bind) => {
    await expect(companion(bind)).rejects.toThrow('maker-loopback-required')
  })
  it('binds only to a loopback literal and ships a restrictive CSP', async () => {
    const server = await companion()
    const reply = await http(server.url, '/')
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(reply.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(reply.headers['referrer-policy']).toBe('no-referrer')
  })
  it('rejects foreign Host, Origin and unauthenticated commands', async () => {
    const server = await companion()
    expect(await status(server.url, '/', { Host: 'evil.example' })).toBe(403)
    expect(await status(server.url, '/', { Origin: 'https://evil.example' })).toBe(403)
    expect(await status(server.url, '/message', { Origin: server.url }, '{}')).toBe(401)
    expect(server.dispatched).toEqual([])
  })
  it('launch codes are single use, same-origin, and exchanged into an HttpOnly cookie', async () => {
    const server = await companion()
    expect(server.launch).toMatch(/^[a-f0-9]{64}$/)
    const payload = JSON.stringify({ launch: server.launch })
    expect(await status(server.url, '/launch', {}, payload)).toBe(403)
    expect(
      await status(server.url, '/launch', { Origin: server.url }, '{"launch":"foreign"}'),
    ).toBe(401)
    const reply = await http(server.url, '/launch', { Origin: server.url }, payload)
    expect(reply.status).toBe(200)
    expect(reply.headers['set-cookie']?.[0]).toContain('HttpOnly; SameSite=Strict')
    expect(reply.headers['set-cookie']?.[0]).not.toContain('Domain=')
    expect(await status(server.url, '/launch', { Origin: server.url }, payload)).toBe(401)
  })
  it('launch refuses a code at its 60-second expiry', async () => {
    const server = await companion()
    const started = Date.now()
    const nativeDateNow = Date.now
    Date.now = () => started + RUNTIME_MAKER_LAUNCH_CODE_MS + 1000
    try {
      expect(
        await status(
          server.url,
          '/launch',
          { Origin: server.url },
          JSON.stringify({ launch: server.launch }),
        ),
      ).toBe(401)
    } finally {
      Date.now = nativeDateNow
    }
  })
  it('an MCP-only server cannot open a panel without OS presence', async () => {
    const server = await startCompanion({
      dispatch: () => Promise.resolve(undefined),
      tools: () => [],
      assets: new Map(),
    })
    cleanups.push(() => server.close())
    await expect(server.open()).rejects.toThrow()
    expect(await status(server.url, '/launch', { Origin: server.url }, '{"launch":"forged"}')).toBe(
      401,
    )
  })
  it('MCP credentials cannot answer the surface or launch a browser session', async () => {
    const server = await companion()
    const headers = { ...server.mcp.headers, Origin: server.url }
    expect(await status(server.url, '/message', headers, '{"v":1,"type":"makerStop"}')).toBe(401)
    expect(
      await status(server.url, '/mcp', headers, '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'),
    ).toBe(403)
    const result = await http(
      server.url,
      '/mcp',
      server.mcp.headers,
      '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    )
    expect(result.status).toBe(200)
    expect(JSON.parse(result.text)).toMatchObject({ result: { tools: [] } })
  })
  it('binds host-only cookies to each instance and port without panel clobbering', async () => {
    const first = await companion(),
      second = await companion()
    const firstCookie = await session(first),
      secondCookie = await session(second)
    expect(firstCookie.split('=', 1)[0]).not.toBe(secondCookie.split('=', 1)[0])
    expect(firstCookie.split('=', 2)[1]?.split('.', 2)[1]).toBe(new URL(first.url).port)
    const data = '{"v":1,"type":"makerStop"}'
    expect(
      await status(second.url, '/message', { Cookie: firstCookie, Origin: second.url }, data),
    ).toBe(401)
    expect(
      await status(
        first.url,
        '/message',
        { Cookie: `${firstCookie}; ${secondCookie}`, Origin: first.url },
        data,
      ),
    ).toBe(200)
    expect(
      await status(
        second.url,
        '/message',
        { Cookie: `${firstCookie}; ${secondCookie}`, Origin: second.url },
        data,
      ),
    ).toBe(200)
  })
  it('request/session channels cannot self-approve; the page capability answers only once', async () => {
    const server = await companion()
    await server.host.setHardware(true, 'supervised test')
    const bootstrap = await http(
      server.url,
      '/launch',
      { Origin: server.url },
      JSON.stringify({ launch: server.launch }),
    )
    const cookie = bootstrap.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? ''
    expect(JSON.parse(bootstrap.text)).toMatchObject({ provider: { token: 'panel-provider-only' } })
    expect(bootstrap.text).not.toContain('approvalKey')
    const request = {
      id: randomUUID(),
      digest: 'a'.repeat(64),
      expiresAt: Date.now() + 60_000,
      kind: 'command' as const,
      target: { kind: 'workspace' as const, workspace: path.resolve('.') },
      action: 'program' as const,
      payload: 'payload',
    }
    const messages: unknown[] = []
    const off = server.host.subscribe((message) => {
      messages.push(message)
    })
    const pending = server.host.confirm(request)
    const answer = {
      v: 1,
      type: 'makerAnswer',
      answer: {
        id: request.id,
        digest: request.digest,
        target: request.target,
        decision: 'allow_once',
      },
    }
    const data = JSON.stringify(answer)
    const headers = { Cookie: cookie, Origin: server.url }
    try {
      expect(JSON.stringify(messages)).not.toContain('panel-provider-only')
      expect(await status(server.url, '/message', headers, data)).toBe(403)
      expect(await status(server.url, '/answer', headers, data)).toBe(403)
      expect(
        await status(
          server.url,
          '/answer',
          { ...headers, 'X-Maker-Approval': server.launch },
          data,
        ),
      ).toBe(403)
      const oldProof = createHmac('sha256', server.launch).update(request.id).digest('hex')
      expect(
        await status(server.url, '/answer', { ...headers, 'X-Maker-Approval': oldProof }, data),
      ).toBe(403)
      const presence = await http(server.url, '/presence', headers, data)
      const grant = z.object({ grant: z.string() }).parse(JSON.parse(presence.text)).grant
      const pageHeaders = { ...headers, 'X-Maker-Approval': grant }
      expect(await status(server.url, '/answer', pageHeaders, data)).toBe(204)
      expect(await pending).toEqual(answer.answer)
      expect(await status(server.url, '/answer', pageHeaders, data)).toBe(403)
    } finally {
      off()
      server.host.cancelApprovals()
      await pending
    }
  })
  it.each([
    ['launch', false],
    ['session', false],
    ['events', false],
    ['launch', true],
    ['session', true],
    ['events', true],
  ] as const)(
    'RVM103W2 P2 a %s replay starts a new document epoch; the old review never binds (reviewed again: %s)',
    async (route, isReviewedAgain) => {
      const { service, server, launched } = await servedCompanion()
      let headers = await launched()
      const { engine, pending, review, answer } = workspaceReview(service.host)
      const reviewed = () => http(server.url, '/message', headers, review)
      expect(await reviewed()).toMatchObject({ text: 'true' })
      // The replacement document resumes; its makerReady is delayed and never arrives here.
      if (route === 'launch') headers = await launched()
      else if (route === 'session')
        expect(await status(server.url, '/session', headers, '')).toBe(200)
      else {
        const frames = await replay(server.url, { Cookie: headers.Cookie })
        expect(frames.indexOf('"makerState"')).toBeLessThan(frames.indexOf('"makerApproval"'))
      }
      if (isReviewedAgain) expect(await reviewed()).toMatchObject({ text: 'true' })
      await answerCompanion(server.url, headers, answer)
      expect(engine.answer(await pending) !== undefined).toBe(isReviewedAgain)
    },
  )
  it('RVM103W3 P2 a review upload started before a session resume cannot review the new document', async () => {
    const { service, server, launched } = await servedCompanion()
    const headers = await launched()
    const { engine, pending, review, answer } = workspaceReview(service.host)
    // The old document starts its review upload but its final bytes are delayed.
    const held = request(`${server.url}/message`, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(review) },
    })
    const done = new Promise<HttpReply>((resolve, reject) => {
      held.on('response', (response) => {
        void readHttpResponse(response).then(resolve).catch(reject)
      })
      held.on('error', reject)
    })
    held.write(review.slice(0, 8))
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The replacement document resumes before the old upload completes.
    expect(await status(server.url, '/session', headers, '')).toBe(200)
    held.end(review.slice(8))
    await expect(done).resolves.toMatchObject({ status: 403 })
    // The new document reviews again and its exact allow binds.
    expect(await http(server.url, '/message', headers, review)).toMatchObject({ text: 'true' })
    await answerCompanion(server.url, headers, answer)
    expect(engine.answer(await pending)).toBeDefined()
  })
  it.each(['reviewed', 'incomplete', 'other digest', 'other target', 'unreviewed'] as const)(
    'companion approval through the real service dispatches only after an exact review: %s',
    async (variant) => {
      const machine = await machineSimulator()
      cleanups.push(() => machine.close())
      const { service, server: companionServer, launched } = await servedCompanion()
      await service.registry.register({
        id: 'printer',
        name: 'Bench printer',
        kind: 'moonraker',
        category: 'printer',
        endpoint: machine.endpoint,
        limits: makerLimits,
        allowPlainHttp: true,
      })
      const headers = await launched()
      const approval = Promise.withResolvers<ApprovalRequest>()
      const off = service.host.subscribe((message) => {
        if (message.type === 'makerApproval') approval.resolve(message.request)
      })
      cleanups.push(() => {
        off()
        return Promise.resolve()
      })
      const sending = http(
        companionServer.url,
        '/message',
        headers,
        JSON.stringify({
          v: 1,
          type: 'makerSend',
          id: randomUUID(),
          machineId: 'printer',
          payload: 'M104 S100',
        }),
      )
      const request = await approval.promise
      if (variant !== 'unreviewed') {
        const review = await http(
          companionServer.url,
          '/message',
          headers,
          JSON.stringify({
            v: 1,
            type: 'makerPayloadReviewed',
            id: request.id,
            digest: variant === 'other digest' ? 'b'.repeat(64) : request.digest,
            isComplete: variant !== 'incomplete',
          }),
        )
        expect(review).toMatchObject({
          status: 200,
          text: String(variant === 'reviewed' || variant === 'other target'),
        })
      }
      const answer = (decision: string) =>
        JSON.stringify({
          v: 1,
          type: 'makerAnswer',
          answer: {
            id: request.id,
            digest: request.digest,
            target:
              variant === 'other target' && request.target.kind === 'machine'
                ? { ...request.target, name: 'Other printer' }
                : request.target,
            decision,
          },
        })
      const presence = await http(companionServer.url, '/presence', headers, answer('allow_once'))
      expect(presence.status).toBe(variant === 'other target' ? 403 : 200)
      if (presence.status === 200) {
        const grant = z.object({ grant: z.string() }).parse(JSON.parse(presence.text)).grant
        expect(
          await status(
            companionServer.url,
            '/answer',
            { ...headers, 'X-Maker-Approval': grant },
            answer('allow_once'),
          ),
        ).toBe(204)
      } else
        expect(await status(companionServer.url, '/answer', headers, answer('reject_once'))).toBe(
          204,
        )
      const sent = await sending
      const scripts = machine.requests.filter(({ path }) => path === '/printer/gcode/script')
      if (variant === 'reviewed') {
        expect(sent.status).toBe(200)
        expect(JSON.parse(sent.text)).toMatchObject({ type: 'makerResult', outcome: 'sent' })
        expect(scripts).toHaveLength(1)
      } else {
        expect(sent.status).toBe(400)
        expect(scripts).toEqual([])
      }
    },
  )
  it('Stop bypasses disabled admission; malformed messages and large bodies refuse', async () => {
    const server = await companion()
    const Cookie = await session(server)
    const headers = { Cookie, Origin: server.url }
    expect(await status(server.url, '/message', headers, '{"v":1,"type":"makerStop"}')).toBe(200)
    expect(server.dispatched[0]?.[0]).toEqual({ v: 1, type: 'makerStop' })
    expect(server.dispatched[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(
      await status(server.url, '/message', headers, '{"v":1,"type":"makerStop","confirm":true}'),
    ).toBe(400)
    expect(
      await status(
        server.url,
        '/message',
        headers,
        ' '.repeat(70_000) + '{"v":1,"type":"makerStop"}',
      ),
    ).toBe(400)
    expect(server.dispatched).toHaveLength(1)
  })
})
function lines(socket: Socket) {
  let buffered = ''
  const queue: unknown[] = []
  let waiter: ReturnType<typeof Promise.withResolvers<unknown>> | undefined
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffered += chunk
    while (buffered.includes('\n')) {
      const end = buffered.indexOf('\n')
      const raw: unknown = JSON.parse(buffered.slice(0, end))
      buffered = buffered.slice(end + 1)
      if (waiter === undefined) queue.push(raw)
      else {
        const done = waiter
        waiter = undefined
        done.resolve(raw)
      }
    }
  })
  return () =>
    queue.length > 0
      ? Promise.resolve(queue.shift())
      : (() => {
          waiter = Promise.withResolvers<unknown>()
          return waiter.promise
        })()
}
async function connect(input?: ThonnyPortOwner) {
  let acquires = 0
  const inner: ThonnyPortOwner = input ?? {
    acquire: () => Promise.resolve(() => Promise.resolve()),
  }
  const owner: ThonnyPortOwner = {
    acquire: (port, signal) => {
      acquires += 1
      return inner.acquire(port, signal)
    },
  }
  const server = await startThonnyServer(owner)
  cleanups.push(() => server.close())
  const socket = createConnection(server.port, server.host)
  const next = lines(socket)
  socket.write(
    `${JSON.stringify({ v: 2, type: 'hello', provider: 'thonny', token: server.token })}\n`,
  )
  expect(await next()).toEqual({ v: 2, type: 'welcome', ok: true })
  return { server, socket, next, owner, acquires: () => acquires }
}

describe('Thonny v2 ownership', () => {
  it('refuses a same-length foreign Thonny token before accepting the provider', async () => {
    const server = await startThonnyServer({
      acquire: () => Promise.reject(new Error('must-not-acquire')),
    })
    cleanups.push(() => server.close())
    const socket = createConnection(server.port, server.host)
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve()
      })
    })
    socket.on('error', () => {
      /* Close is asserted below. */
    })
    socket.write(
      `${JSON.stringify({ v: 2, type: 'hello', provider: 'thonny', token: 'x'.repeat(server.token.length) })}\n`,
    )
    await closed
    expect(socket.destroyed).toBe(true)
  })
  it.each(['wrong-token', 'oversized'])('closes %s before acquiring a port', async (kind) => {
    let acquires = 0
    const owner: ThonnyPortOwner = {
      acquire: () => {
        acquires += 1
        return Promise.resolve(() => Promise.resolve())
      },
    }
    const server = await startThonnyServer(owner)
    cleanups.push(() => server.close())
    const socket = createConnection(server.port, server.host)
    socket.on('error', () => {
      socket.destroy()
    })
    const hello = JSON.stringify({
      v: 2,
      type: 'hello',
      provider: 'thonny',
      token: kind === 'wrong-token' ? 'foreign' : server.token,
    })
    socket.write((kind === 'oversized' ? ' '.repeat(70_000) : '') + hello + '\n')
    await vi.waitFor(() => {
      expect(socket.destroyed).toBe(true)
    })
    expect(acquires).toBe(0)
  })
  it('interoperates with the real Python v2 provider over a fake owned port', async () => {
    let closes = 0
    let acquires = 0
    const closed = () => {
      closes += 1
      return Promise.resolve()
    }
    const acquire: ThonnyPortOwner['acquire'] = () => {
      acquires += 1
      return Promise.resolve(closed)
    }
    const server = await startThonnyServer({ acquire })
    cleanups.push(() => server.close())
    const child = spawn(
      process.platform === 'win32' ? 'python' : 'python3',
      ['test/fixtures/maker/thonny-provider.py'],
      {
        env: {
          ...withoutKeyringRoutes(withoutCredentials(process.env)),
          PYTHONDONTWRITEBYTECODE: '1',
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    const ready = Promise.withResolvers<undefined>()
    let output = ''
    let errors = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      if (output.includes('READY\n') || output.includes('READY\r\n')) ready.resolve(undefined)
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      errors += chunk
    })
    const ended = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    child.stdin.end(
      JSON.stringify({ host: server.host, port: server.port, token: server.token }) + '\n',
    )
    try {
      await Promise.race([ready.promise, ended])
      expect(await server.context(AbortSignal.timeout(10_000))).toEqual({
        text: 'fake shell ready\n',
        connected: true,
      })
      expect(await ended).toBe(0)
      expect(errors).toBe('')
      expect(acquires).toBe(1)
      expect(closes).toBe(1)
      const capture: unknown = JSON.parse(output.trim().split('\n').at(-1) ?? '')
      expect(JSON.stringify(capture)).toContain('device_response')
      expect(JSON.stringify(capture)).not.toContain(server.token)
    } finally {
      child.kill()
      await ended
    }
  })
  it('acknowledges acquire only when the lane P session is open; release waits for closure', async () => {
    const opened = Promise.withResolvers<() => Promise<void>>()
    let closes = 0
    let acquires = 0
    const closed = () => {
      closes += 1
      return Promise.resolve()
    }
    const acquire: ThonnyPortOwner['acquire'] = () => {
      acquires += 1
      return opened.promise
    }
    const { socket, next } = await connect({ acquire })
    socket.write('{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7"}\n')
    await vi.waitFor(() => {
      expect(acquires).toBe(1)
    })
    opened.resolve(closed)
    expect(await next()).toMatchObject({ id: 'a', ok: true, owner: 'runtime', port: 'COM7' })
    socket.write('{"v":2,"type":"port_request","id":"b","op":"release","port":"COM7"}\n')
    expect(await next()).toMatchObject({ id: 'b', ok: true, owner: 'released' })
    expect(closes).toBe(1)
  })
  it('disconnection cancels uncertain acquisition and releases before replacement', async () => {
    let closes = 0
    let acquires = 0
    const closed = () => {
      closes += 1
      return Promise.resolve()
    }
    let signal: AbortSignal | undefined
    const finished = Promise.withResolvers<() => Promise<void>>()
    const acquire: ThonnyPortOwner['acquire'] = (_port, current) => {
      acquires += 1
      signal = current
      return finished.promise
    }
    const { server, socket } = await connect({ acquire })
    socket.write('{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7"}\n')
    await vi.waitFor(() => {
      expect(acquires).toBe(1)
    })
    socket.destroy()
    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
    })
    finished.resolve(closed)
    await vi.waitFor(() => {
      expect(closes).toBe(1)
    })
    const replacement = createConnection(server.port, server.host)
    const next = lines(replacement)
    replacement.write(
      `${JSON.stringify({ v: 2, type: 'hello', provider: 'thonny', token: server.token })}\n`,
    )
    expect(await next()).toMatchObject({ ok: true })
  })
  it('never accepts payloads or approvals on the handover channel', async () => {
    const { socket, acquires } = await connect()
    const ended = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve()
      })
    })
    socket.write(
      '{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7","payload":"G1 X1"}\n',
    )
    await ended
    expect(acquires()).toBe(0)
  })
})
describe('runtime maker arguments', () => {
  it.each([
    ['hardware', 'enable', '--trust-workspace', '--reason', 'bench'],
    ['hardware', 'disable'],
    ['hardware', 'status'],
    ['machines', 'list'],
    ['machines', 'remove', 'printer'],
    ['machines', 'add', '--registration', '{}', '--key-stdin'],
    ['stop-machine', '--all'],
    ['stop-machine', 'printer'],
    ['machines', 'panel'],
    // A bare panel is the MHP host's (M104 lane B), never the maker's.
  ])('parses %j', (...args) => {
    expect(parseCommandLine(args)).toMatchObject({ command: 'maker' })
  })
  it.each([
    ['hardware', 'auto'],
    ['machines', 'add'],
    ['machines', 'remove'],
    ['machines', 'add', '--key', 'never'],
    ['stop-machine', 'printer', '--all'],
    ['hardware', 'status', '--key-stdin'],
    ['machines', 'panel', 'extra'],
  ])('rejects %j', (...args) => {
    expect(parseCommandLine(args)).toMatchObject({ command: 'invalid' })
  })
  it('requires an explicit hardware flag on ACP; exec cannot accept it', () => {
    expect(parseCommandLine([])).toMatchObject({
      command: 'serve',
      options: expect.not.objectContaining({ hardware: true }),
    })
    expect(parseCommandLine(['--hardware'])).toMatchObject({
      command: 'serve',
      options: { hardware: true },
    })
    expect(parseCommandLine(['exec', '--hardware', 'do it'])).toMatchObject({ command: 'invalid' })
  })
})
