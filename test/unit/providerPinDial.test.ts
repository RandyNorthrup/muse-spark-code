// The DNS-rebinding pin: the name is resolved once, the answers are
// checked against the saved network, and the request dials the checked
// address itself — never a name looked up again at connect time. Over a
// real loopback socket with a real resolver function returning a fixed
// address list (the documented hook, not a stand-in for our code): the
// name `probe.invalid` never resolves on any machine, so an answer proves
// the dial used the checked address, and the `Host` header still carries
// the original name.

import { afterEach, describe, expect, it } from 'vitest'
import { presetById } from '../../src/core/providers/presets'
import { pinProviderFetch, type ResolvedProvider } from '../../src/runtime/exec/providerExec'
import { closeLoopbackServers, listenLoopback } from './helpers/loopbackServer'

afterEach(closeLoopbackServers)

interface Seen {
  readonly url: string
  readonly host: string | undefined
  readonly remote: string | undefined
}

async function listen(): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  const target = await listenLoopback((request, reply) => {
    seen.push({
      url: request.url ?? '',
      host: request.headers.host,
      remote: request.socket.remoteAddress,
    })
    if (request.url === '/redirect') {
      reply(302, '', { location: '/api/chat' })
      return
    }
    let text = ''
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    request.on('end', () => {
      reply(200, JSON.stringify({ heard: text }), { 'content-type': 'application/json' })
    })
  })
  return { port: target.port, seen }
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
  it('reaches the checked loopback address under an unresolvable name with its Host header', async () => {
    const target = await listen()
    const provider = providerFor(target.port)
    let resolutions = 0
    const resolveHost = (hostname: string): Promise<readonly string[]> => {
      resolutions += 1
      expect(hostname).toBe('probe.invalid')
      return Promise.resolve(['127.0.0.1'])
    }
    const pinned = pinProviderFetch(provider, [{ kind: 'exact', path: '/api/chat' }], resolveHost)
    const response = await pinned(`http://probe.invalid:${String(target.port)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'llama3' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ heard: JSON.stringify({ model: 'llama3' }) })
    // Resolved once, dialled as resolved: no second lookup at connect time.
    expect(resolutions).toBe(1)
    expect(target.seen).toHaveLength(1)
    expect(target.seen[0]?.host).toBe(`probe.invalid:${String(target.port)}`)
    expect(target.seen[0]?.remote).toBe('127.0.0.1')
  })

  it('sends nothing when the answers move to a forbidden address', async () => {
    const target = await listen()
    const provider = providerFor(target.port)
    const pinned = pinProviderFetch(provider, [{ kind: 'exact', path: '/api/chat' }], () =>
      Promise.resolve(['169.254.169.254']),
    )
    await expect(
      pinned(`http://probe.invalid:${String(target.port)}/api/chat`, { method: 'GET' }),
    ).rejects.toThrow('rebinding')
    expect(target.seen).toHaveLength(0)
  })

  it('sends nothing on mixed answers either', async () => {
    const target = await listen()
    const provider = providerFor(target.port)
    const pinned = pinProviderFetch(provider, [{ kind: 'exact', path: '/api/chat' }], () =>
      Promise.resolve(['127.0.0.1', '169.254.169.254']),
    )
    await expect(
      pinned(`http://probe.invalid:${String(target.port)}/api/chat`, { method: 'GET' }),
    ).rejects.toThrow('rebinding')
    expect(target.seen).toHaveLength(0)
  })

  it('refuses redirects like redirect error', async () => {
    const target = await listen()
    const provider = providerFor(target.port)
    const pinned = pinProviderFetch(
      provider,
      [
        { kind: 'exact', path: '/api/chat' },
        { kind: 'exact', path: '/redirect' },
      ],
      () => Promise.resolve(['127.0.0.1']),
    )
    await expect(
      pinned(`http://probe.invalid:${String(target.port)}/redirect`, { method: 'GET' }),
    ).rejects.toThrow(TypeError)
  })
})
