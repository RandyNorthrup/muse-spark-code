// The estimator price port's host side (M117 C-M117-4R2, PLAN.md D97.6):
// the catalog GET goes through the report network reader's own transport and
// cache — no second transport. The reader checks the host allowlist (with
// prices.azure.com) and the empty port before the socket; its transport
// refuses redirects and sends no credentials; persistence is the shared
// ReportResponseCache over reports/v1/cache/index.json, whose merge runs
// inside ReportStorage's cross-process lock with exclusive no-follow staging
// writes. Only pinned catalog URLs are ever fetched; anything else refuses
// before any network access. Dates come from the estimate's asOf through
// prices.ts, never a second clock: the reader's own observation clock only
// feeds its internal age math, while every estimate-visible date is the
// adapter's dated evidence stamped with asOf.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { EstimateCatalogAdapter } from '../../core/estimator/priceCatalogs'
import type { EstimatePricePort } from '../../core/estimator/prices'
import { reportWorkspaceKey } from '../../core/reporting/sources/local'
import {
  ReportNetworkFailure,
  ReportNetworkReader,
  publicReportTransport,
  type ReportNetworkPolicy,
  type ReportNetworkTransport,
} from '../../core/reporting/sources/cache'
import type { SourceReadContext } from '../../core/reporting/sources/types'
import { redactSecrets } from '../../shared/redact'
import { reportingResponseCache } from '../../runtime/reporting/network'
import { fill, UI_TEXT, uiLocale } from '../../shared/l10n/text'
import { ESTIMATE_PRICE_MAX_BYTES, ESTIMATE_SOURCE_TIMEOUT_MS } from '../../shared/constants'

export interface PriceCatalogSourceDeps {
  readonly storageRoot: string
  readonly workspaceRoot: string
  readonly policy: ReportNetworkPolicy
  readonly transport?: ReportNetworkTransport | undefined
  readonly adapters: ReadonlyMap<string, EstimateCatalogAdapter>
  readonly now?: (() => string) | undefined
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

function key(catalogUrl: string): string {
  return createHash('sha256').update(`estimate-price-catalog/v1:${catalogUrl}`).digest('hex')
}

// The reader's secret refusal rides the shared registry-backed redactor (the
// same primitive the export scrub is built on). Workspace-path folding stays
// with the report scrubber: catalog answers are vendor-fixed JSON with no
// local paths (zero replacements across the three captures), and the report
// scrubber's module carries model text this lazy bundle must not (PLAN.md
// D6). Anything secret-looking still refuses before the socket.
function catalogScrub(text: string): string {
  return redactSecrets(text)
}

/** The price port: the report reader for the GET, the shared cache for persistence. */
export function createPriceCatalogPort(deps: PriceCatalogSourceDeps): EstimatePricePort {
  const cache = reportingResponseCache(deps.storageRoot)
  const inner = deps.transport ?? publicReportTransport(globalThis.fetch)
  // Redirects refuse (P1, RVCM1174): the WHATWG serialization percent-encodes
  // (a real fetch returns `%27` where the pinned URL has `'`), so parsed URLs
  // are compared in normalised form, never as strings.
  const transport: ReportNetworkTransport = async (request, etag, signal) => {
    // The reader awaits its cache after initial admission. Ask the same live
    // host policy again at the socket, then reread its live mode/sign-in.
    if (
      !(await deps.policy.allowEgress(request.url, signal)) ||
      deps.policy.mode === 'off' ||
      (deps.policy.mode === 'whenSignedIn' && !deps.policy.githubSignedIn)
    )
      throw new ReportNetworkFailure('catalog-egress-refused')
    signal.throwIfAborted()
    const response = await inner(request, etag, signal)
    if (new URL(response.url).href !== new URL(request.url).href)
      throw new ReportNetworkFailure('catalog-redirect-refused')
    return response
  }
  const reader = new ReportNetworkReader({
    policy: deps.policy,
    transport,
    cache,
    now: deps.now ?? (() => new Date().toISOString()),
    scrub: catalogScrub,
    maxBytes: ESTIMATE_PRICE_MAX_BYTES,
    maxPages: 1,
  })
  const workspaceKey = reportWorkspaceKey(deps.workspaceRoot, process.platform)
  const readContext = (signal: AbortSignal): SourceReadContext => ({
    // The reader's age math needs an asOf; estimate-visible dates still come
    // from prices.ts (asOf) and the adapter, never from this clock.
    reportText: UI_TEXT,
    locale: uiLocale(),
    asOf: (deps.now ?? (() => new Date().toISOString()))(),
    workspaceKey,
    options: {
      kind: 'session',
      asOf: (deps.now ?? (() => new Date().toISOString()))(),
      scope: 'estimate-prices',
      full: false,
      network: true,
      failOn: [],
    },
    signal,
  })
  return {
    cached: async (catalogUrl) => {
      const entry = await cache.get(key(catalogUrl), new AbortController().signal)
      if (entry === undefined) return
      // The stored shape is revalidated by prices.ts on every read; an
      // unexpected shape here passes through and fails closed there.
      const data = z.object({ catalogDate: z.unknown(), rows: z.unknown() }).safeParse(entry.data)
      const fields = data.success ? data.data : { catalogDate: undefined, rows: undefined }
      return {
        retrievedAt: entry.observedAt,
        catalogDate: fields.catalogDate,
        ...(typeof entry.etag === 'string' && entry.etag !== '' && { etag: entry.etag }),
        rows: fields.rows,
      }
    },
    store: async (catalogUrl, document) => {
      await cache.set(
        {
          key: key(catalogUrl),
          etag: document.etag ?? null,
          observedAt: document.retrievedAt,
          data: { catalogDate: document.catalogDate, rows: document.rows },
        },
        new AbortController().signal,
      )
    },
    fetchPublic: async (catalogUrl) => {
      const adapter = deps.adapters.get(catalogUrl)
      if (adapter === undefined) refuse('unknown-catalog')
      // One deadline covers the admission, the GET and the parse; the reader
      // carries its own bound as well and the earlier timeout wins.
      const timeout = AbortSignal.timeout(ESTIMATE_SOURCE_TIMEOUT_MS)
      const result = await reader.read(
        readContext(timeout),
        'estimate-prices',
        z.unknown(),
        async (query) => ({
          data: await query({ url: catalogUrl }, z.unknown()),
          reason: null,
        }),
      )
      // The reader never throws: anything it could not fetch (refused host or
      // port, denied egress, redirect, rate limit, oversize, timeout) arrives
      // as no data and refuses here without exposing transport text.
      if (result.data === null) refuse('catalog-unavailable')
      // The adapter runs outside the reader so a paged or drifted answer
      // refuses here instead of being cached as prices.
      const catalog = adapter(result.data, { catalogUrl })
      return {
        status: 'modified',
        catalogDate: catalog.catalogDate,
        rows: catalog.rows,
      }
    },
  }
}
