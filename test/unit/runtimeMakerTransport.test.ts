import * as crypto from 'node:crypto'
import { createHmac, randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { request } from 'node:http'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeMakerHost } from '../../src/runtime/maker/runtimeMakerHost'
import { startCompanion } from '../../src/runtime/maker/companionServer'
import { startThonnyServer, type ThonnyPortOwner } from '../../src/runtime/maker/thonnyServer'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { spawn } from 'node:child_process'
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'
import {
  RUNTIME_MAKER_LAUNCH_CODE_MS,
  RUNTIME_MAKER_LAUNCH_MAX_ATTEMPTS,
} from '../../src/shared/constants'

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>()
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})
async function companion(bind?: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'maker-transport-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const workspace = path.join(directory, 'repo')
  await mkdir(workspace)
  const host = await RuntimeMakerHost.create({
    dataDirectory: path.join(directory, 'data'),
    workspace,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    trusted: () => true,
    flagged: () => true,
    interactive: () => true,
    auditEnable: () => Promise.resolve(),
  })
  const dispatch = vi.fn().mockResolvedValue({ stopped: true })
  const server = await startCompanion({
    host,
    dispatch,
    tools: () => [],
    provider: { host: '127.0.0.1', port: 12_345, token: 'panel-provider-only' },
    assets: new Map([['/', { body: '<html></html>', type: 'text/html' }]]),
    ...(bind !== undefined && { bind }),
  })
  cleanups.push(() => server.close())
  return { ...server, dispatch, host }
}
async function http(
  url: string,
  route: string,
  headers: Record<string, string> = {},
  data?: string,
) {
  return await new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
    text: string
  }>((resolve, reject) => {
    const outgoing = request(
      `${url}${route}`,
      { method: data === undefined ? 'GET' : 'POST', headers },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          text += chunk
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text })
        })
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
async function session(server: Awaited<ReturnType<typeof companion>>) {
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
describe('companion boundary', () => {
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
    expect(server.dispatch).not.toHaveBeenCalled()
  })
  it('launch codes are single use, same-origin, and exchanged into an HttpOnly cookie', async () => {
    const server = await companion()
    expect(server.launch).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
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
    const started = Date.now()
    const server = await companion()
    const now = vi.spyOn(Date, 'now').mockReturnValue(started + RUNTIME_MAKER_LAUNCH_CODE_MS + 100)
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
      now.mockRestore()
    }
  })
  it('launch rate-limits guesses and cannot mint a key after exhausting its attempt allowance', async () => {
    const server = await companion()
    for (let count = 0; count < RUNTIME_MAKER_LAUNCH_MAX_ATTEMPTS; count += 1)
      expect(
        await status(server.url, '/launch', { Origin: server.url }, '{"launch":"wrong"}'),
      ).toBe(401)
    const reply = await http(
      server.url,
      '/launch',
      { Origin: server.url },
      JSON.stringify({ launch: server.launch }),
    )
    expect(reply.status).toBe(429)
    expect(reply.headers['set-cookie']).toBeUndefined()
    expect(reply.text).not.toContain('approvalKey')
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
    const key: unknown = JSON.parse(bootstrap.text)
    if (
      typeof key !== 'object' ||
      key === null ||
      !('approvalKey' in key) ||
      typeof key.approvalKey !== 'string'
    )
      throw new Error('bootstrap')
    expect(key.approvalKey).toMatch(/^[\da-f]{64}$/)
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
      expect(JSON.stringify(messages)).not.toContain(key.approvalKey)
      expect(JSON.stringify(messages)).not.toContain('panel-provider-only')
      expect(await status(server.url, '/message', headers, data)).toBe(403)
      expect(await status(server.url, '/answer', headers, data)).toBe(403)
      expect(
        await status(
          server.url,
          '/answer',
          { ...headers, 'X-Maker-Approval': key.approvalKey },
          data,
        ),
      ).toBe(403)
      const pageHeaders = {
        ...headers,
        'X-Maker-Approval': createHmac('sha256', key.approvalKey).update(request.id).digest('hex'),
      }
      expect(await status(server.url, '/answer', pageHeaders, data)).toBe(204)
      expect(await pending).toEqual(answer.answer)
      expect(await status(server.url, '/answer', pageHeaders, data)).toBe(409)
    } finally {
      off()
      server.host.cancelApprovals()
      await pending
    }
  })
  it('Stop bypasses disabled admission; malformed messages and large bodies refuse', async () => {
    const server = await companion()
    const Cookie = await session(server)
    const headers = { Cookie, Origin: server.url }
    expect(await status(server.url, '/message', headers, '{"v":1,"type":"makerStop"}')).toBe(200)
    expect(server.dispatch).toHaveBeenCalledWith(
      { v: 1, type: 'makerStop' },
      expect.any(AbortSignal),
    )
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
    expect(server.dispatch).toHaveBeenCalledTimes(1)
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
  const owner = input ?? {
    acquire: vi
      .fn<ThonnyPortOwner['acquire']>()
      .mockResolvedValue(vi.fn<() => Promise<void>>().mockResolvedValue(undefined)),
  }
  const server = await startThonnyServer(owner)
  cleanups.push(() => server.close())
  const socket = createConnection(server.port, server.host)
  const next = lines(socket)
  socket.write(
    `${JSON.stringify({ v: 2, type: 'hello', provider: 'thonny', token: server.token })}\n`,
  )
  expect(await next()).toEqual({ v: 2, type: 'welcome', ok: true })
  return { server, socket, next, owner }
}

describe('Thonny v2 ownership', () => {
  it('compares same-length Thonny tokens with timingSafeEqual before accepting the provider', async () => {
    const compare = vi.mocked(crypto.timingSafeEqual)
    compare.mockClear()
    const server = await startThonnyServer({ acquire: vi.fn() })
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
    try {
      await closed
      expect(compare).toHaveBeenCalledTimes(1)
    } finally {
      compare.mockClear()
    }
  })
  it.each(['wrong-token', 'oversized'])('closes %s before acquiring a port', async (kind) => {
    const owner = { acquire: vi.fn<ThonnyPortOwner['acquire']>() }
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
    expect(owner.acquire).not.toHaveBeenCalled()
  })
  it('interoperates with the real Python v2 provider over a fake owned port', async () => {
    const closed = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const acquire = vi.fn<ThonnyPortOwner['acquire']>().mockResolvedValue(closed)
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
      expect(acquire).toHaveBeenCalledTimes(1)
      expect(closed).toHaveBeenCalledTimes(1)
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
    const closed = vi.fn().mockResolvedValue(undefined)
    const acquire = vi.fn(() => opened.promise)
    const { socket, next } = await connect({ acquire })
    socket.write('{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7"}\n')
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalledTimes(1)
    })
    opened.resolve(closed)
    expect(await next()).toMatchObject({ id: 'a', ok: true, owner: 'runtime', port: 'COM7' })
    socket.write('{"v":2,"type":"port_request","id":"b","op":"release","port":"COM7"}\n')
    expect(await next()).toMatchObject({ id: 'b', ok: true, owner: 'released' })
    expect(closed).toHaveBeenCalledTimes(1)
  })
  it('disconnection cancels uncertain acquisition and releases before replacement', async () => {
    const closed = vi.fn().mockResolvedValue(undefined)
    let signal: AbortSignal | undefined
    const finished = Promise.withResolvers<() => Promise<void>>()
    const acquire = vi.fn((_port: string, current: AbortSignal) => {
      signal = current
      return finished.promise
    })
    const { server, socket } = await connect({ acquire })
    socket.write('{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7"}\n')
    await vi.waitFor(() => {
      expect(acquire).toHaveBeenCalled()
    })
    socket.destroy()
    await vi.waitFor(() => {
      expect(signal?.aborted).toBe(true)
    })
    finished.resolve(closed)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledTimes(1)
    })
    const replacement = createConnection(server.port, server.host)
    const next = lines(replacement)
    replacement.write(
      `${JSON.stringify({ v: 2, type: 'hello', provider: 'thonny', token: server.token })}\n`,
    )
    expect(await next()).toMatchObject({ ok: true })
  })
  it('never accepts payloads or approvals on the handover channel', async () => {
    const { socket, owner } = await connect()
    const ended = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve()
      })
    })
    socket.write(
      '{"v":2,"type":"port_request","id":"a","op":"acquire","port":"COM7","payload":"G1 X1"}\n',
    )
    await ended
    expect(owner.acquire).not.toHaveBeenCalled()
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
    ['panel'],
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
    ['panel', 'extra'],
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
