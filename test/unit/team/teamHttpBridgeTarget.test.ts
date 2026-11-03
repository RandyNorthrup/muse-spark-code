import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { readIncomingBody } from '../helpers/incomingBody'
import {
  BRIDGE_HEADERS_ENV,
  BRIDGE_LOOPBACK_REFUSAL,
  BRIDGE_URL_ENV,
  BridgeEndpointError,
  bridgeAnswer,
  bridgeEndpoint,
} from '../../../src/host/team/teamHttpBridge'

const REQUEST = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })

function refusalOf(answer: string | undefined): string {
  if (answer === undefined) throw new Error('expected a refusal')
  const parsed = JSON.parse(answer) as { error?: { message?: string } }
  return parsed.error?.message ?? ''
}

describe('the team bridge endpoint', () => {
  it('refuses a public URL before any request and does not repeat it', async () => {
    const secret = 'bearer-secret-value'
    const answer = await bridgeAnswer(REQUEST, {
      // eslint-disable-next-line unicorn/prefer-https -- the refusal under test is this plain-http URL; rewriting it to https would not reach the loopback check
      [BRIDGE_URL_ENV]: `http://example.com/mcp?token=${secret}`,
      [BRIDGE_HEADERS_ENV]: JSON.stringify({ Authorization: `Bearer ${secret}` }),
    })
    expect(refusalOf(answer)).toBe(BRIDGE_LOOPBACK_REFUSAL)
    expect(answer).not.toContain('example.com')
    expect(answer).not.toContain(secret)
  })

  it('refuses https on the loopback address before any request', async () => {
    const answer = await bridgeAnswer(REQUEST, {
      [BRIDGE_URL_ENV]: 'https://127.0.0.1/mcp',
    })
    expect(refusalOf(answer)).toBe(BRIDGE_LOOPBACK_REFUSAL)
    expect(answer).not.toContain('127.0.0.1')
  })

  it('refuses a loopback name and a numeric address that are not the literal', async () => {
    for (const url of [
      'http://localhost/mcp',
      // eslint-disable-next-line unicorn/prefer-https -- the refusal under test is this plain-http URL; rewriting it to https would not reach the loopback check
      'http://127.0.0.1.evil/mcp',
      'http://0x7f000001/mcp',
      'http://2130706433/mcp',
    ]) {
      const answer = await bridgeAnswer(REQUEST, { [BRIDGE_URL_ENV]: url })
      expect(refusalOf(answer)).toBe(BRIDGE_LOOPBACK_REFUSAL)
      expect(answer).not.toContain('localhost')
      expect(answer).not.toContain('evil')
    }
  })

  it('refuses a header block that does not parse, without repeating it', () => {
    const secret = 'bearer-secret-value'
    let thrown: unknown
    try {
      bridgeEndpoint({
        [BRIDGE_URL_ENV]: 'http://127.0.0.1:9/mcp',
        [BRIDGE_HEADERS_ENV]: `{"Authorization": "${secret}"`,
      })
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(BridgeEndpointError)
    expect(thrown instanceof Error ? thrown.message : '').toBe(BRIDGE_LOOPBACK_REFUSAL)
    expect(thrown instanceof Error ? thrown.message : '').not.toContain(secret)
  })

  it('accepts literal loopback HTTP, including an upper-case scheme and ::1', () => {
    const v4 = bridgeEndpoint({ [BRIDGE_URL_ENV]: 'HTTP://127.0.0.1:9/mcp' })
    expect(v4.url.protocol).toBe('http:')
    expect(v4.url.hostname).toBe('127.0.0.1')
    const v6 = bridgeEndpoint({ [BRIDGE_URL_ENV]: 'http://[::1]:9/mcp' })
    expect(v6.url.hostname === '::1' || v6.url.hostname === '[::1]').toBe(true)
  })

  it('says when the endpoint variable is missing', () => {
    expect(() => bridgeEndpoint({})).toThrow(/MUSE_TEAM_BRIDGE_URL is not set/)
  })

  it('posts a literal loopback URL and forwards the bearer', async () => {
    const seen: { authorization: string | undefined; body: string } = {
      authorization: undefined,
      body: '',
    }
    const server = createServer((request, response) => {
      void readIncomingBody(request).then((body) => {
        seen.authorization = request.headers.authorization
        seen.body = body
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }))
      })
    })
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', () => {
        resolveListen()
      })
    })
    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const answer = await bridgeAnswer(REQUEST, {
        [BRIDGE_URL_ENV]: `http://127.0.0.1:${String(port)}/mcp`,
        [BRIDGE_HEADERS_ENV]: JSON.stringify({ Authorization: 'Bearer test-bearer' }),
      })
      expect(JSON.parse(answer ?? '')).toMatchObject({ result: { ok: true } })
      expect(seen.authorization).toBe('Bearer test-bearer')
      expect(seen.body).toBe(REQUEST)
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose()
        })
      })
    }
  })

  it('answers a notification that names a public URL with silence and does not post', async () => {
    const answer = await bridgeAnswer(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }), {
      // eslint-disable-next-line unicorn/prefer-https -- the refusal under test is this plain-http URL; rewriting it to https would not reach the loopback check
      [BRIDGE_URL_ENV]: 'http://example.com/mcp',
    })
    expect(answer).toBeUndefined()
  })
})
