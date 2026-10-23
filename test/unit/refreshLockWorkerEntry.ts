// The cross-surface refresh drill's worker bundle entry: the real runtime
// refresh locks, the real runtime Grok host and the real Grok core, plus
// the drill's file-backed secret store and token fetch, so a child process
// refreshes exactly like the runtime CLI. Bundled with esbuild by
// test/unit/crossSurfaceRefreshLock.test.ts (knip does not trace that).
import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import type { FetchCall } from './helpers/grokDiscoveryFetch'

export { GrokSignIn } from '../../src/core/providers/subscriptions/grok'
export { createRuntimeGrokHost } from '../../src/runtime/grokHost'
export {
  withChatGptRefreshLock,
  withGrokRefreshLock,
} from '../../src/runtime/subscriptionRefreshLock'

/** A secret store shared across processes through one JSON file, written atomically. */
export function fileSecrets(storeFile: string): SecretStore {
  const readAll = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(storeFile, 'utf8')) as Record<string, string>
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
      throw error
    }
  }
  const writeAll = (entries: Record<string, string>): void => {
    const tmp = `${storeFile}.${String(process.pid)}.tmp`
    writeFileSync(tmp, JSON.stringify(entries))
    renameSync(tmp, storeFile)
  }
  return {
    get: (key: string) => Promise.resolve(readAll()[key]),
    store: (key: string, value: string) => {
      const entries = readAll()
      entries[key] = value
      writeAll(entries)
      return Promise.resolve()
    },
    delete: (key: string) => {
      const entries = readAll()
      const kept: Record<string, string> = Object.fromEntries(
        Object.entries(entries).filter(([name]) => name !== key),
      )
      writeAll(kept)
      return Promise.resolve()
    },
  }
}

export interface DrillFetchOptions {
  /** The recorded discovery document; the test reads it from the fixture. */
  readonly discovery: unknown
  readonly discoveryUrl: string
  readonly tokenUrl: string
  /** The seeded refresh token the drill answers; any other refresh refuses. */
  readonly seedRefreshToken: string
  /**
  How long a token answer waits before landing: on split locks the loser
  must still be in flight when the winner's rotation lands, or the red
  drill cannot show both refreshing.
  */
  readonly tokenDelayMs: number
  readonly calls?: FetchCall[]
}

/**
A fetch that answers the recorded discovery document and one standard-OAuth
refresh answer (RFC 6749 section 5.1: opaque access and refresh tokens, a
Bearer type, an expiry and the granted scopes; no identity token, so no
identity path runs). Anything else refuses like the discovery-only fetch:
xAI's other answers are never invented here.
*/
export function drillFetch(options: DrillFetchOptions): typeof fetch {
  const stub: typeof fetch = async (url, init) => {
    const href = url instanceof Request ? url.url : String(url)
    const method = init?.method ?? (url instanceof Request ? url.method : 'GET')
    const body = init?.body
    let form: URLSearchParams | undefined
    if (typeof body === 'string') form = new URLSearchParams(body)
    else if (body instanceof URLSearchParams) form = body
    options.calls?.push({ url: href, method, form })
    if (method === 'GET' && href === options.discoveryUrl)
      return Response.json(options.discovery, { status: 200 })
    if (
      method === 'POST' &&
      href === options.tokenUrl &&
      form?.get('grant_type') === 'refresh_token' &&
      form.get('refresh_token') === options.seedRefreshToken
    ) {
      await delay(options.tokenDelayMs)
      return Response.json(
        {
          access_token: randomBytes(24).toString('hex'),
          refresh_token: randomBytes(24).toString('hex'),
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid offline_access',
        },
        { status: 200 },
      )
    }
    throw new Error(`no recorded answer for ${method} ${href}`)
  }
  return stub
}
