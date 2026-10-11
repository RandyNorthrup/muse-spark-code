import {
  type VaultStorePort,
  vaultItemSchema,
  type VaultItemMetadata,
  type VaultTicket,
} from '../../../shared/vault'
import { assertWebTarget, webOrigin } from './origin'
import {
  decodeCookies,
  encodeCookies,
  eraseCookies,
  sessionCookies,
  sessionDeadline,
} from './cookies'
import {
  type HeadedWebBrowserPort,
  type WebBrowserOwnerPort,
  type WebUseBrokerPort,
  type WebSessionUse,
} from './ports'
import { withWebTicket } from './ticket'
import { webItemMetadata } from './items'

export interface WebSessionDeps {
  readonly headed: HeadedWebBrowserPort
  readonly pin: {
    readonly version: string
    readonly manifestDigest: string
    readonly executableDigest: string
  }
  readonly store: VaultStorePort
  readonly now: () => number
  readonly randomId: () => string
}

/** This entry is a trusted user's action; models and third-party browser MCPs cannot reach it. */
async function captureSession(
  originInput: string,
  signal: AbortSignal,
  deps: WebSessionDeps,
): Promise<VaultItemMetadata> {
  const origin = webOrigin(originInput)
  let browser: WebBrowserOwnerPort | undefined
  let saved: VaultItemMetadata | undefined
  let hasClosed = false
  let closing: Promise<void> | undefined
  const close = (): void => {
    hasClosed = true
    if (browser === undefined) {
      return
    }

    const owned = browser
    closing ??= (async () => {
      await owned.close()
    })()
    void closing.catch(() => {
      /* Cleanup is awaited below. */
    })
  }
  signal.addEventListener('abort', close, { once: true })
  const check = (): void => {
    if (hasClosed || signal.aborted) throw new Error('useChanged')
  }
  try {
    check()
    browser = await deps.headed.open({ origin, explicitHosts: [new URL(origin).hostname], signal })
    check()
    const runtime = browser.runtime
    if (
      !runtime.headed ||
      runtime.product !== 'chrome' ||
      runtime.virtualAuthenticator ||
      runtime.version !== deps.pin.version ||
      runtime.manifestDigest !== deps.pin.manifestDigest ||
      runtime.executableDigest !== deps.pin.executableDigest
    )
      throw new Error('useChanged')
    const owned = browser
    await deps.headed.captureOnUserClose(owned, signal, async () => {
      check()
      await owned.withTarget(origin, null, async (target) => {
        assertWebTarget(target, origin)
        const raw = await target.readCookies(origin)
        let bytes: Uint8Array | undefined
        let rows: ReturnType<typeof sessionCookies> = []
        try {
          check()
          assertWebTarget(target, origin)
          const now = deps.now()
          rows = sessionCookies(raw, origin, now)
          if (rows.length === 0) throw new Error('useChanged')
          bytes = encodeCookies(rows)
          const expiresAt = Math.max(...rows.map((row) => row.expiresAt ?? now))
          const id = deps.randomId()
          const metadata = webItemMetadata('session', id, origin, now, expiresAt)
          check()
          assertWebTarget(target, origin)
          await deps.store.write(
            vaultItemSchema.parse({
              metadata,
              material: { kind: 'session', origin, cookies: bytes, expiresAt },
            }),
          )
          check()
          saved = metadata
        } finally {
          eraseCookies(raw)
          eraseCookies(rows)
          bytes?.fill(0)
        }
      })
    })
    check()
    if (saved === undefined) throw new Error('useChanged')
    return saved
  } finally {
    signal.removeEventListener('abort', close)
    close()
    await closing
  }
}

export async function signInYourself(
  ...args: Parameters<typeof captureSession>
): Promise<VaultItemMetadata> {
  try {
    return await captureSession(...args)
  } catch {
    throw new Error('useChanged')
  }
}

/** Session restore is a brokered use, with exactly the same policy and revocation path as fill. */
export async function restoreWebSession(
  browser: WebBrowserOwnerPort,
  broker: WebUseBrokerPort,
  ticket: VaultTicket,
  use: WebSessionUse,
  signal: AbortSignal,
  now: () => number,
): Promise<void> {
  await withWebTicket(browser, broker, ticket, use, signal, async (target, check) => {
    await broker.withApprovedMaterial(ticket.id, use, async (raw) => {
      const item = vaultItemSchema.parse(raw)
      const material = item.material
      const time = now()
      if (
        material.kind !== 'session' ||
        material.origin !== use.origin ||
        material.expiresAt <= time ||
        item.metadata.dates.createdAt > time ||
        material.expiresAt !== item.metadata.dates.expiresAt ||
        material.expiresAt > sessionDeadline(item.metadata.dates.createdAt)
      )
        throw new Error('useChanged')
      const rows = decodeCookies(material.cookies, use.origin, time)
      try {
        if (
          rows.length === 0 ||
          rows.some((row) => row.expiresAt === null || row.expiresAt > material.expiresAt)
        )
          throw new Error('useChanged')
        check()
        await target.restoreCookies(use.origin, rows)
        check()
      } finally {
        eraseCookies(rows)
      }
    })
  })
}
