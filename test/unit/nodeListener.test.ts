import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { chmod, readFile, rm } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { createServer, connect, type Socket } from 'node:net'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'
import type { Duplex } from 'node:stream'
import { afterAll, beforeAll, beforeEach, describe, expect, vi } from 'vitest'
import { NodeListener, type NodeListenerOptions } from '../../src/runtime/node/listener'
import { NodeListenerError } from '../../src/runtime/node/listenerGuard'
import { nodeMethods } from '../../src/shared/hostApi/nodeMethods'
import {
  NODE_HTTP_BODY_BYTES,
  NODE_HTTP_HEADER_BYTES,
  NODE_LISTENER_SOURCE_CONNECTIONS,
} from '../../src/shared/constants'
import { nodeConfig, nodeBearer, nodeHash } from './helpers/node/records'
import { listenerFixture, maskedFrame } from './helpers/node/listener'
import { nodeNativeTest, nodeTempRoot } from './helpers/nodeNative'

const fixture = listenerFixture()
const built: {
  root: string
  certificate: string
  port: number
  listener: NodeListener | undefined
  options: NodeListenerOptions
} = {
  root: '',
  certificate: '',
  port: 0,
  listener: undefined,
  options: { ...fixture.options },
}

async function vacantPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no test address')
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  return address.port
}
beforeAll(async () => {
  if (process.platform === 'win32') return
  built.root = await nodeTempRoot('m110-tls-')
  await chmod(built.root, 0o700)
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-noenc',
    '-days',
    '1',
    '-subj',
    '/CN=home.local',
    '-addext',
    'subjectAltName=DNS:home.local',
    '-addext',
    'basicConstraints=critical,CA:FALSE',
    '-keyout',
    path.join(built.root, 'key.pem'),
    '-out',
    path.join(built.root, 'cert.pem'),
  ])
  await chmod(path.join(built.root, 'key.pem'), 0o600)
  await chmod(path.join(built.root, 'cert.pem'), 0o600)
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-new',
    '-key',
    path.join(built.root, 'key.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=home.local',
    '-addext',
    'subjectAltName=DNS:home.local',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-out',
    path.join(built.root, 'ca.pem'),
  ])
  await chmod(path.join(built.root, 'ca.pem'), 0o600)
  built.certificate = await readFile(path.join(built.root, 'cert.pem'), 'utf8')
  built.port = await vacantPort()
  built.options = {
    ...fixture.options,
    config: { ...nodeConfig(), listener: { address: '127.0.0.1', port: built.port } },
    tls: {
      root: built.root,
      certificateFile: 'cert.pem',
      privateKeyFile: 'key.pem',
      fingerprint: new X509Certificate(built.certificate).fingerprint256
        .replaceAll(':', '')
        .toLowerCase(),
    },
  }
  built.listener = new NodeListener(built.options)
  await built.listener.start()
})
beforeEach(() => {
  fixture.request.reset()
  fixture.methods.calls.length = 0
  fixture.verifier.verifyBearer.calls.length = 0
  fixture.verifier.consumeStepUp.calls.length = 0
})
afterAll(async () => {
  await built.listener?.close()
  if (built.root !== '') await rm(built.root, { recursive: true, force: true })
})

function requestHeaders(port: number, headers: Record<string, string | undefined>) {
  const defaults: Record<string, string | undefined> = {
    Host: `home.local:${String(port)}`,
    Origin: `https://home.local:${String(port)}`,
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    Authorization: `Bearer ${nodeBearer}`,
    'Content-Type': 'application/json',
  }
  return Object.fromEntries(
    Object.entries({ ...defaults, ...headers }).filter(([, value]) => value !== undefined),
  )
}

async function post(
  route: string,
  body = '{}',
  headers: Record<string, string | undefined> = {},
  target = built.port,
  method = 'POST',
) {
  const actual = requestHeaders(target, headers)
  return await new Promise<{
    status: number
    body: string
    headers: Record<string, string | string[] | undefined>
  }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: target,
        servername: 'home.local',
        ca: built.certificate,
        path: route,
        method,
        headers: actual,
        agent: false,
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (part: string) => {
          text += part
        })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: text, headers: response.headers })
        })
        response.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function status(...args: Parameters<typeof post>): Promise<number> {
  const response = await post(...args)
  return response.status
}

// Feeds a huge body in small chunks and stops the moment the server refuses.
// A single 2 MB write fills the client's send buffer while the server is
// already answering 413, which surfaces as EPIPE on smaller loopback
// buffers; chunking observes the same 413 without the write race.
async function postHuge(
  body: string,
  headers: Record<string, string | undefined> = {},
): Promise<number> {
  const actual = requestHeaders(built.port, headers)
  return await new Promise<number>((resolve, reject) => {
    let hasAnswered = false
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: built.port,
        servername: 'home.local',
        ca: built.certificate,
        path: '/node/stop',
        method: 'POST',
        headers: actual,
        agent: false,
      },
      (response) => {
        hasAnswered = true
        response.resume()
        req.destroy()
        resolve(response.statusCode ?? 0)
      },
    )
    req.on('error', (error) => {
      if (!hasAnswered) reject(error)
    })
    const chunk = 64 * 1024
    let offset = 0
    const feed = (): void => {
      if (hasAnswered) return
      if (offset >= body.length) {
        req.end()
        return
      }
      try {
        req.write(body.slice(offset, offset + chunk))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('huge upload failed'))
        return
      }
      offset += chunk
      setImmediate(feed)
    }
    feed()
  })
}

async function terminalSocket(origin: string): Promise<Duplex> {
  return await new Promise<Duplex>((resolve, reject) => {
    const req = httpsRequest({
      host: '127.0.0.1',
      port: built.port,
      servername: 'home.local',
      ca: built.certificate,
      path: '/node/terminal/stream',
      agent: false,
      headers: {
        Host: `home.local:${String(built.port)}`,
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'websocket',
        'Sec-Fetch-Dest': 'websocket',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.alloc(16).toString('base64'),
      },
    })
    req.once('upgrade', (_response, socket) => {
      resolve(socket)
    })
    req.once('error', reject)
    req.end()
  })
}

async function tcpSocket(): Promise<Socket> {
  return await new Promise<Socket>((resolve, reject) => {
    const socket = connect(built.port, '127.0.0.1', () => {
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

describe('M110-N real selected-interface HTTPS listener', () => {
  nodeNativeTest(
    'H09 challenge 429s cannot keep console enrollment behind account backoff',
    async () => {
      const port = await vacantPort()
      const retry = new NodeListener({
        ...built.options,
        clock: { now: () => Date.now(), monotonicMs: () => 0 },
        config: { ...built.options.config, listener: { address: '127.0.0.1', port } },
      })
      await retry.start()
      try {
        const rateLimited = () => Promise.reject(new NodeListenerError('rateLimited'))
        fixture.request.once(rateLimited)
        fixture.request.once(rateLimited)
        fixture.request.once(() =>
          Promise.resolve({
            v: 1,
            id: 'console-enrollment',
            purpose: 'enroll',
            rpId: 'home.local',
            origin: `https://home.local:${String(port)}`,
            challenge: 'a'.repeat(43),
            issuedAt: 0,
            expiresAt: 1000,
          }),
        )
        for (let count = 0; count < 2; count++) {
          const refused = await post('/node/auth/begin', '{"purpose":"signin"}', {}, port)
          expect(refused.status).toBe(429)
        }
        const setup = await post(
          '/node/auth/begin',
          JSON.stringify({ purpose: 'enroll', setupCode: 'b'.repeat(43) }),
          {},
          port,
        )
        expect(setup.status).toBe(200)
        expect(fixture.request.calls).toHaveLength(3)
      } finally {
        await retry.close()
      }
    },
  )
  nodeNativeTest('H09 raw connections are bounded before TLS work', async () => {
    const held: Socket[] = []
    try {
      for (let index = 0; index < NODE_LISTENER_SOURCE_CONNECTIONS; index += 1)
        held.push(await tcpSocket())
      await nextTurn()
      expect(held.every((socket) => !socket.destroyed)).toBe(true)
      const extra = await tcpSocket()
      held.push(extra)
      await new Promise<void>((resolve) => {
        extra.once('close', () => {
          resolve()
        })
      })
      expect(extra.destroyed).toBe(true)
      expect(fixture.request.calls).toHaveLength(0)
    } finally {
      for (const socket of held) socket.destroy()
    }
    await nextTurn()
  })
  nodeNativeTest(
    'H01 null configuration binds no port; each service starts one listener',
    async () => {
      const off = new NodeListener({ ...built.options, config: nodeConfig() })
      await expect(off.start()).rejects.toThrow()
      await off.close()
      await expect(built.listener?.start()).rejects.toThrow()
      const duplicate = new NodeListener(built.options)
      await expect(duplicate.start()).rejects.toThrow()
      await duplicate.close()
      expect(await status('/node/stop')).toBe(200)
    },
  )
  nodeNativeTest(
    'H02 shows the full pin and rejects wrong pin, SAN, CA, expired leaf and private key access',
    async () => {
      expect(fixture.lines).toContain(
        `Certificate fingerprint: ${new X509Certificate(built.certificate).fingerprint256}`,
      )
      const ca = new X509Certificate(await readFile(path.join(built.root, 'ca.pem'), 'utf8'))
      for (const input of [
        { ...built.options, tls: { ...built.options.tls, fingerprint: nodeHash } },
        {
          ...built.options,
          tls: {
            ...built.options.tls,
            certificateFile: 'ca.pem',
            fingerprint: ca.fingerprint256.replaceAll(':', '').toLowerCase(),
          },
        },
        { ...built.options, config: { ...built.options.config, browserNames: ['other.local'] } },
        {
          ...built.options,
          clock: { ...built.options.clock, now: () => Date.now() + 2 * 24 * 60 * 60 * 1000 },
        },
      ]) {
        const bad = new NodeListener({
          ...input,
          config: { ...input.config, listener: { address: '127.0.0.1', port: await vacantPort() } },
        })
        try {
          await expect(bad.start()).rejects.toThrow()
        } finally {
          await bad.close()
        }
      }
      await chmod(path.join(built.root, 'key.pem'), 0o644)
      try {
        await expect(new NodeListener(built.options).start()).rejects.toThrow()
      } finally {
        await chmod(path.join(built.root, 'key.pem'), 0o600)
      }
    },
  )
  nodeNativeTest('H01 plain HTTP receives no response, redirect or dispatch', async () => {
    const received: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const socket = connect(built.port, '127.0.0.1', () =>
        socket.write('GET /node/stop HTTP/1.1\r\nHost: home.local\r\n\r\n'),
      )
      socket.on('data', (bytes: Buffer) => {
        received.push(bytes)
      })
      socket.on('error', reject)
      socket.on('close', () => {
        resolve()
      })
    })
    expect(Buffer.concat(received).toString()).not.toContain('HTTP/')
    expect(fixture.request.calls).toHaveLength(0)
  })
  nodeNativeTest(
    'H06/H07 exact guards refuse before authentication/body parsing and emit no CORS or cookies',
    async () => {
      for (const headers of [
        { Host: 'evil.local' },
        { Origin: 'https://evil.local' },
        { Origin: undefined },
        { 'Sec-Fetch-Site': 'cross-site' },
        { 'Sec-Fetch-Mode': 'no-cors' },
        { 'Sec-Fetch-Dest': 'document' },
        { Cookie: `bearer=${nodeBearer}` },
      ]) {
        const response = await post('/node/stop', 'malformed', headers)
        expect(response.status).toBe(403)
        expect(response.headers['access-control-allow-origin']).toBeUndefined()
        expect(response.headers['set-cookie']).toBeUndefined()
        expect(response.headers['cache-control']).toBe('no-store')
      }
      expect(fixture.verifier.verifyBearer.calls).toHaveLength(0)
      expect(fixture.request.calls).toHaveLength(0)
    },
  )
  nodeNativeTest(
    'H06 authentication precedes params parsing, every privileged route refuses without A1 and tokens never enter URLs or replies',
    async () => {
      expect(await status('/node/stop', 'malformed', { Authorization: undefined })).toBe(401)
      expect(await status('/node/stop', '{}', { Authorization: 'Basic invalid' })).toBe(401)
      expect(await status(`/node/stop?bearer=${nodeBearer}`)).toBe(404)
      const target = await vacantPort()
      const { verifier: _verifier, ...unbound } = built.options
      const closed = new NodeListener({
        ...unbound,
        config: { ...built.options.config, listener: { address: '127.0.0.1', port: target } },
      })
      await closed.start()
      try {
        for (const [method, entry] of Object.entries(nodeMethods)) {
          if (entry.access === 'public') continue
          const response = await post(`/${method}`, 'malformed', {}, target)
          expect(response.status, method).toBe(503)
          expect(response.body).not.toContain(nodeBearer)
        }
      } finally {
        await closed.close()
      }
      expect(fixture.request.calls).toHaveLength(0)
    },
  )
  nodeNativeTest(
    'H09 body/header limits and invalid params/results refuse through the live server',
    async () => {
      expect(
        await status('/node/stop', '{}', { 'Content-Length': String(NODE_HTTP_BODY_BYTES + 1) }),
      ).toBe(413)
      const oversized = await postHuge(`"${'x'.repeat(NODE_HTTP_BODY_BYTES)}"`)
      expect(oversized).toBe(413)
      const chunked = await postHuge(`"${'x'.repeat(NODE_HTTP_BODY_BYTES)}"`, {
        'Transfer-Encoding': 'chunked',
      })
      expect(chunked).toBe(413)
      expect(await status('/node/stop', '{}', { 'Content-Encoding': 'gzip' })).toBe(400)
      expect(await status('/node/stop', '{"extra":1}')).toBe(400)
      expect(await status('/node/stop', 'malformed')).toBe(400)
      const header = await post('/node/stop', '{}', {
        'X-Padding': 'x'.repeat(NODE_HTTP_HEADER_BYTES),
      })
      expect(header.status).toBe(431)
      expect(fixture.request.calls).toHaveLength(0)
      const bad = { done: true } as const
      Object.defineProperty(bad, 'done', { value: false })
      fixture.request.once(() => Promise.resolve(bad))
      expect(await status('/node/stop')).toBe(503)
    },
  )
  nodeNativeTest('validated routes dispatch only through the shared session port', async () => {
    const response = await post('/node/stop')
    expect(response.status).toBe(200)
    expect(response.body).toBe('{"done":true}')
    expect(fixture.request.calls).toContainEqual(['node/stop', {}, expect.any(AbortSignal)])
    expect(fixture.methods.calls).toContainEqual([
      expect.objectContaining({ ownerId: 'owner' }),
      '127.0.0.1',
    ])
    expect(fixture.verifier.consumeStepUp.calls).toHaveLength(0)
    expect(await status('/node/stop', '{}', {}, built.port, 'OPTIONS')).toBe(400)
    expect(await status('/node/stop', '{}', {}, built.port, 'GET')).toBe(400)
  })
  nodeNativeTest(
    'typed method failures keep their catalog code through the live server',
    async () => {
      fixture.request.once(() => Promise.reject(new NodeListenerError('conflict')))
      const conflict = await post('/node/stop')
      expect(conflict.status).toBe(409)
      expect(conflict.body).toBe('{"code":"conflict"}')
      fixture.request.once(() => Promise.reject(new Error('plain failure')))
      const down = await post('/node/stop')
      expect(down.status).toBe(503)
      expect(down.body).toBe('{"code":"unavailable"}')
    },
  )
  nodeNativeTest(
    'H07 the real TLS upgrade refuses foreign Origin and dispatches same-origin first-frame/input through the shared port',
    async () => {
      await expect(terminalSocket('https://evil.local')).rejects.toThrow()
      expect(fixture.request.calls).toHaveLength(0)
      const socket = await terminalSocket(`https://home.local:${String(built.port)}`)
      try {
        socket.write(maskedFrame({ type: 'auth', bearer: nodeBearer, terminalId: 'terminal-1' }))
        await vi.waitFor(() => {
          expect(fixture.request.calls).toContainEqual([
            'node/terminal/attach',
            { terminalId: 'terminal-1' },
            expect.any(AbortSignal),
          ])
        })
        socket.write(maskedFrame({ type: 'input', data: 'synthetic' }))
        await vi.waitFor(() => {
          expect(fixture.request.calls).toContainEqual([
            'node/terminal/write',
            { terminalId: 'terminal-1', data: 'synthetic' },
            expect.any(AbortSignal),
          ])
        })
      } finally {
        socket.destroy()
      }
    },
  )
})
