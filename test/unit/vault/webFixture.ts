import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import {
  type WebBrowserOwnerPort,
  type WebTargetFacts,
  type WebTargetLease,
  type WebUseBrokerPort,
  type WebCookie,
} from '../../../src/core/vault/web/ports'
import { type VaultItem, type VaultTicket } from '../../../src/shared/vault'
import { WebLoginFill } from '../../../src/core/vault/web/webFill'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { metadata, ticket } from '../helpers/vault/fixtures'

function cdpOk(
  _method: string,
  _params?: Readonly<Record<string, unknown>>,
  _session?: string,
): Promise<unknown> {
  return Promise.resolve({})
}
function restoreOk(_origin: string, _cookies: readonly WebCookie[]): Promise<void> {
  return Promise.resolve()
}
export const WEB_ORIGIN = 'https://login.example.test'

/** Observe actual byte owners so removing finally erasure fails a behavioral test. */
export function observeByteOwners() {
  const original = Buffer.alloc
  const buffers: Buffer<ArrayBuffer>[] = []
  const spy = vi.spyOn(Buffer, 'alloc').mockImplementation((size, fill, encoding) => {
    const value = original(size, fill, encoding)
    buffers.push(value)
    return value
  })
  return {
    buffers,
    restore: () => {
      spy.mockRestore()
    },
  }
}
export class TestWebBrowser implements WebBrowserOwnerPort {
  private tail: Promise<unknown> = Promise.resolve()
  readonly browserId = 'a'.repeat(32)
  runtime: WebBrowserOwnerPort['runtime'] = {
    product: 'chrome',
    version: '154.0.8037.92',
    manifestDigest: 'b'.repeat(64),
    executableDigest: 'c'.repeat(64),
    headed: true,
    virtualAuthenticator: false,
  }
  facts: WebTargetFacts = {
    topUrl: `${WEB_ORIGIN}/login`,
    frameUrl: `${WEB_ORIGIN}/frame`,
    frameId: 'frame-1',
    certificateValid: true,
    input: { tag: 'INPUT', type: 'password', autocomplete: '', disabled: false, readOnly: false },
  }
  cookies: WebCookie[] = []
  hasClosed = false
  readonly send = vi.fn(cdpOk)
  readonly readCookies = vi.fn((): Promise<readonly WebCookie[]> => Promise.resolve(this.cookies))
  readonly restoreCookies = vi.fn(restoreOk)
  readonly close = vi.fn((): Promise<void> => {
    this.hasClosed = true
    return Promise.resolve()
  })
  readonly leases: WebTargetLease[] = []

  async withTarget<T>(
    origin: string,
    _field: 'username' | 'password' | 'totp' | null,
    run: (target: WebTargetLease) => Promise<T>,
  ): Promise<T> {
    const prior = this.tail
    const work = (async () => {
      await prior
      if (origin !== WEB_ORIGIN || this.hasClosed) throw new Error('unavailableBrowser')
      const facts = structuredClone(this.facts)
      const target: WebTargetLease = {
        facts,
        sessionId: 'session-1',
        isolatedContextId: 1,
        cdp: { send: this.send },
        assertCurrent: () => {
          if (this.hasClosed || JSON.stringify(facts) !== JSON.stringify(this.facts))
            throw new Error('changedTarget')
        },
        readCookies: this.readCookies,
        restoreCookies: this.restoreCookies,
      }
      this.leases.push(target)
      return await run(target)
    })()
    this.tail = (async () => {
      try {
        await work
      } catch {
        /* The queue continues after a refused operation. */
      }
    })()
    return await work
  }
}

export function webItem(): VaultItem {
  return {
    metadata: {
      ...metadata(),
      kind: 'webLogin',
      bindings: [{ kind: 'origin', origin: WEB_ORIGIN }],
    },
    material: {
      kind: 'webLogin',
      origins: [WEB_ORIGIN],
      username: privateBytes(randomBytes(20).toString('hex')),
      password: privateBytes(randomBytes(32).toString('hex')),
      totpSeed: randomBytes(20),
    },
  }
}

export function webCookie(): WebCookie {
  return {
    origin: WEB_ORIGIN,
    name: 'session',
    value: randomBytes(32),
    path: '/',
    secure: true,
    hostOnly: true,
    httpOnly: true,
    sameSite: 'Strict',
    expiresAt: null,
  }
}

export async function webFixture() {
  const browser = new TestWebBrowser()
  const item = webItem()
  const finish = vi.fn((_ticketId: string, _hasSucceeded: boolean): Promise<void> =>
    Promise.resolve(),
  )
  const read = vi.fn((_ticketId: string, _use: unknown, run: (item: VaultItem) => Promise<void>) =>
    run(item),
  )
  const redeem = vi.fn((ticket: VaultTicket): ReturnType<WebUseBrokerPort['redeem']> =>
    Promise.resolve({ kind: 'ticket', ticket, authority: { kind: 'user' } }),
  )
  const broker: WebUseBrokerPort = { redeem, withApprovedMaterial: read, finish }
  const fill = new WebLoginFill(browser, broker, () => 59_000)
  const use = await fill.describe(WEB_ORIGIN, 'password')
  const approved = { ...ticket(), digest: vaultUseDigest(use), itemId: item.metadata.id }
  const controller = new AbortController()
  return { browser, item, broker, read, redeem, finish, fill, use, approved, controller }
}

export function privateBytes(value: string): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(Buffer.byteLength(value))
  bytes.write(value)
  return bytes
}
