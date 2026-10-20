// The IDE tool server re-presents a session's loaded secret on every resume:
// a fresh secret per resume is rejected by Muse Code when the session is
// already loaded in the same serve life ("session MCP configuration conflicts
// with the loaded session runtime"). Proven against the real server over real
// loopback HTTP: the Bearer a resume would send is read back from the bound
// endpoint, and every authentication check goes through the server's own
// request path.
import { describe, expect, it } from 'vitest'
import { IdeMcpServer } from '../../src/host/ide/ideMcpServer'

const log = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
const resolve = () => ({ isReady: true })

function secretOf(endpoint: { readonly headers: Readonly<Record<string, string>> }): string {
  const header = endpoint.headers['Authorization'] ?? endpoint.headers['authorization']
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new Error('expected a Bearer endpoint')
  }
  return header.slice('Bearer '.length)
}

async function statusWith(server: IdeMcpServer, secret: string | undefined): Promise<number> {
  const current = server.current
  if (current === undefined) throw new Error('the server is not listening')
  const response = await fetch(current.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret !== undefined && { authorization: `Bearer ${secret}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
  })
  return response.status
}

describe('IdeMcpServer session endpoints', () => {
  it('re-presents the recorded secret on every bind for one session', async () => {
    const server = new IdeMcpServer(() => [], log)
    try {
      const first = await server.bindCaller(resolve, 'session-a')
      const second = await server.bindCaller(resolve, 'session-a')
      expect(secretOf(second.endpoint)).toBe(secretOf(first.endpoint))
      expect(second.endpoint.url).toBe(first.endpoint.url)
      const other = await server.bindCaller(resolve, 'session-b')
      expect(secretOf(other.endpoint)).not.toBe(secretOf(first.endpoint))
      const fresh = await server.bindCaller(resolve)
      expect(secretOf(fresh.endpoint)).not.toBe(secretOf(first.endpoint))
      first.dispose()
      second.dispose()
      other.dispose()
      fresh.dispose()
    } finally {
      server.close()
    }
  })

  it('keeps presenting the recorded secret after its bindings are dropped', async () => {
    const server = new IdeMcpServer(() => [], log)
    try {
      const first = await server.bindCaller(resolve, 'session-a')
      const recorded = secretOf(first.endpoint)
      first.dispose()
      const second = await server.bindCaller(resolve, 'session-a')
      expect(secretOf(second.endpoint)).toBe(recorded)
      // The re-registered secret authenticates on the real request path.
      expect(await statusWith(server, recorded)).not.toBe(401)
      expect(await statusWith(server, 'wrong-secret')).toBe(401)
      second.dispose()
    } finally {
      server.close()
    }
  })

  it('records a start through noteSessionSecret for the later resume', async () => {
    const server = new IdeMcpServer(() => [], log)
    try {
      // A start binds before its session id exists, so nothing is recorded yet.
      const started = await server.bindCaller(resolve)
      const startedSecret = secretOf(started.endpoint)
      expect(await statusWith(server, startedSecret)).not.toBe(401)
      server.noteSessionSecret('session-new', started.endpoint)
      started.dispose()
      // Dropping the start must not lose the loaded secret: the resume
      // re-registers the same one instead of minting fresh.
      const resumed = await server.bindCaller(resolve, 'session-new')
      expect(secretOf(resumed.endpoint)).toBe(startedSecret)
      expect(await statusWith(server, startedSecret)).not.toBe(401)
      resumed.dispose()
    } finally {
      server.close()
    }
  })

  it('ignores the shared server token and unknown secrets when noting', async () => {
    const server = new IdeMcpServer(() => [], log)
    try {
      await server.start()
      const shared = server.current
      if (shared === undefined) throw new Error('the server is not listening')
      server.noteSessionSecret('session-shared', shared)
      const bound = await server.bindCaller(resolve, 'session-shared')
      // The server token is stable and needs no record: a session bind mints fresh.
      expect(secretOf(bound.endpoint)).not.toBe(secretOf(shared))
      bound.dispose()
    } finally {
      server.close()
    }
  })

  it('mints fresh after close drops the window', async () => {
    const server = new IdeMcpServer(() => [], log)
    try {
      const first = await server.bindCaller(resolve, 'session-a')
      const recorded = secretOf(first.endpoint)
      first.dispose()
      server.close()
      const second = await server.bindCaller(resolve, 'session-a')
      expect(secretOf(second.endpoint)).not.toBe(recorded)
      second.dispose()
    } finally {
      server.close()
    }
  })
})
