// The DNS-rebinding pin: the name is resolved once through the documented
// `resolveHost` hook, the answers are checked against the saved network,
// and the request dials the checked address itself — never a name looked
// up again at connect time. The name `probe.invalid` never resolves on any
// machine, so any bytes arriving prove the dial used the checked address,
// and the `Host` bytes still carry the original name. Where a real socket
// is needed, a bare TCP acceptor takes the connection, records the peer
// address and the raw request bytes, then answers as told: silence (it
// answers nothing, so it is not a provider) or a bare 302 with no body
// and no provider content (a redirect carries no answer by definition).
// Refusals are proven with silence — the acceptor sees zero connections,
// so nothing was sent.

import { createServer, type Server, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { presetById } from '../../src/core/providers/presets'
import { pinProviderFetch, type ResolvedProvider } from '../../src/runtime/exec/providerExec'

const acceptors: Server[] = []

afterEach(async () => {
  let running = acceptors.pop()
  while (running !== undefined) {
    const closing: Server = running
    await new Promise<void>((done) => {
      closing.close(() => {
        done()
      })
    })
    running = acceptors.pop()
  }
})

interface Acceptor {
  readonly port: number
  readonly connections: () => number
  readonly peerAddresses: () => (string | undefined)[]
  readonly received: () => string
}

/**
 * A bare TCP acceptor on 127.0.0.1: it records each connection's peer
 * address and raw bytes, then answers each request as told once its
 * headers arrive. Silence closes without writing anything — no HTTP
 * status, no headers, no body — so the client's request always fails
 * and the recorded bytes are the proof of where it dialled.
 */
async function listenAcceptor(answer: (socket: Socket) => void): Promise<Acceptor> {
  let connections = 0
  const peerAddresses: (string | undefined)[] = []
  let received = ''
  const server = createServer((socket: Socket) => {
    connections += 1
    peerAddresses.push(socket.remoteAddress)
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8')
      if (received.includes('\r\n\r\n')) answer(socket)
    })
    socket.on('error', () => undefined)
  })
  acceptors.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const bound = server.address()
  if (typeof bound !== 'object' || bound === null) throw new Error('acceptor did not bind')
  return {
    port: bound.port,
    connections: () => connections,
    peerAddresses: () => [...peerAddresses],
    received: () => received,
  }
}

/** An acceptor that answers nothing: every client request must fail. */
function listenSilent(): Promise<Acceptor> {
  return listenAcceptor((socket) => {
    socket.end()
  })
}

function providerFor(port: number): ResolvedProvider {
  const preset = presetById('ollama')
  expect(preset).toBeDefined()
  if (preset === undefined) throw new Error('ollama preset is missing')
  return {
    entry: {
      id: 'probe',
      preset: 'ollama',
      address: `http://probe.invalid:${String(port)}`,
      auth: 'none',
      models: [],
    },
    preset,
    origin: `http://probe.invalid:${String(port)}`,
    network: 'local',
    request: { rule: { kind: 'exact', path: '/api/chat' }, source: 'research' },
  }
}

describe('pinProviderFetch dials the checked address', () => {
  it('reaches the checked loopback address under an unresolvable name with its Host bytes', async () => {
    const target = await listenSilent()
    const provider = providerFor(target.port)
    let resolutions = 0
    const resolveHost = (hostname: string): Promise<readonly string[]> => {
      resolutions += 1
      expect(hostname).toBe('probe.invalid')
      return Promise.resolve(['127.0.0.1'])
    }
    const pinned = pinProviderFetch(provider, [{ kind: 'exact', path: '/api/chat' }], resolveHost)
    // The acceptor closes without answering, so the client's request must
    // fail: the proof is server-side, in the bytes that arrived.
    await expect(
      pinned(`http://probe.invalid:${String(target.port)}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'llama3' }),
      }),
    ).rejects.toThrow()
    // Resolved once, dialled as resolved: no second lookup at connect time.
    expect(resolutions).toBe(1)
    expect(target.connections()).toBe(1)
    expect(target.peerAddresses()).toEqual(['127.0.0.1'])
    expect(target.received()).toContain('POST /api/chat HTTP/1.1')
    // Node sends the header name lowercased; the value must stay the
    // original name, never the dialled address.
    expect(target.received()).toContain(`host: probe.invalid:${String(target.port)}`)
    expect(target.received()).toContain(JSON.stringify({ model: 'llama3' }))
  })

  it('sends nothing when the answers leave the saved network', async () => {
    // A wholly forbidden answer, then one mixed with the loopback
    // address: both refuse before anything is sent, so the acceptor
    // never sees a connection either time.
    const hostileAnswers: (readonly string[])[] = [
      ['169.254.169.254'],
      ['127.0.0.1', '169.254.169.254'],
    ]
    for (const answers of hostileAnswers) {
      const target = await listenSilent()
      const pinned = pinProviderFetch(
        providerFor(target.port),
        [{ kind: 'exact', path: '/api/chat' }],
        () => Promise.resolve(answers),
      )
      await expect(
        pinned(`http://probe.invalid:${String(target.port)}/api/chat`, { method: 'GET' }),
      ).rejects.toThrow('rebinding')
      expect(target.connections()).toBe(0)
    }
  })

  it('refuses a redirect instead of following it', async () => {
    // The acceptor speaks bare framing only: a 302 with no body and no
    // provider content. The pin refuses it like `redirect: 'error'`
    // rather than following the Location answer.
    const redirecting = await listenAcceptor((socket) => {
      socket.end(
        'HTTP/1.1 302 Found\r\nLocation: /api/chat\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      )
    })
    const pinned = pinProviderFetch(
      providerFor(redirecting.port),
      [{ kind: 'exact', path: '/api/chat' }],
      () => Promise.resolve(['127.0.0.1']),
    )
    let failure: unknown
    try {
      await pinned(`http://probe.invalid:${String(redirecting.port)}/api/chat`, { method: 'GET' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(TypeError)
    expect((failure as TypeError).message).toBe('fetch failed')
    // Never followed: the one request arrived and nothing else was sent.
    expect(redirecting.connections()).toBe(1)
  })
})
