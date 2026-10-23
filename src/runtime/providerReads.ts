// One pinned provider GET as JSON, with the list helpers behind it: the
// shared read for the free probe (D74) and the provider commands (D119).
// The transport loads lazily, as it did at each call site; the providers
// entry is already in both chunks, and only leaf modules load statically.
import * as z from 'zod/mini'
import type { ApiKeyAuthSource, NoAuthSource } from '../core/backends/modelapi/authSource'
import { resolveAttemptBillingRoute } from '../core/backends/modelapi/billingRoute'
import type { TransportDeps } from '../core/backends/modelapi/transport'
import type { ProviderPreset } from '../core/providers/presets'
import { presets } from '../host/backend/providersEntry'
import type { ResolvedProvider } from './exec/providerExec'
import {
  CREDENTIAL_RECORD_VERSION,
  PROVIDER_PROBE_MODEL_IDS_MAX,
  PROVIDER_PROBE_TIMEOUT_MS,
  UI_TEXT,
} from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'

const { OPENROUTER_ATTRIBUTION } = presets

function attributionHeaders(preset: ProviderPreset): Record<string, string> {
  return preset.id === 'openrouter'
    ? {
        [OPENROUTER_ATTRIBUTION.refererHeader]: OPENROUTER_ATTRIBUTION.referer,
        [OPENROUTER_ATTRIBUTION.titleHeader]: OPENROUTER_ATTRIBUTION.title,
        [OPENROUTER_ATTRIBUTION.categoriesHeader]: OPENROUTER_ATTRIBUTION.categories,
      }
    : {}
}

/** The request headers behind a provider's list read. */
export function providerListHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = { ...attributionHeaders(provider.preset) }
  if ((provider.entry.format ?? provider.preset.format) === 'anthropic') {
    // The 2026-10-04 captured list requests carry 2023-06-01; the current
    // version is 2026-10-21 (platform.claude.com/docs/en/api/versioning).
    headers['anthropic-version'] = '2026-10-21'
  }
  return headers
}

/**
The free key test's refusals before any request (D74): a paid-token test
asks its price in the panel first, and a keyed preset without a key has
nothing to test. Undefined lets the probe read.
*/
export function freeProbeRefusal(
  provider: ResolvedProvider,
  key: string | undefined,
): { readonly ok: false; readonly paid: boolean; readonly reason: string } | undefined {
  if (provider.preset.keyTest.kind === 'paid-token')
    return { ok: false, paid: true, reason: 'paid' }
  return key === undefined && provider.preset.auth === 'apiKey'
    ? { ok: false, paid: false, reason: 'no-key' }
    : undefined
}

/** Model ids from a list body: OpenAI's `{data: [{id}]}` or Gemini's `{models: [{name}]}`. */
const modelId = z.string().check(z.minLength(1))
const modelRows = z
  .array(z.object({ id: modelId }))
  .check(z.maxLength(PROVIDER_PROBE_MODEL_IDS_MAX))
const modelsBody = z.union([
  z.object({ data: modelRows }),
  z.object({
    models: z.array(z.object({ name: modelId })).check(z.maxLength(PROVIDER_PROBE_MODEL_IDS_MAX)),
  }),
])

export function listModelIds(body: unknown, preset: ProviderPreset): readonly string[] | undefined {
  // Only Together has the captured top-level array (free list, zero model attempts).
  const parsed = z.safeParse(preset.id === 'together' ? modelRows : modelsBody, body)
  if (!parsed.success) return undefined
  if (Array.isArray(parsed.data)) return parsed.data.map((row) => row.id)
  return 'data' in parsed.data
    ? parsed.data.data.map((row) => row.id)
    : parsed.data.models.map((row) =>
        row.name.startsWith('models/') ? row.name.slice('models/'.length) : row.name,
      )
}

function ignoreProbeLog(): void {
  // Commands return fixed probe outcomes; transport details never reach terminal logs.
}

/**
The auth-source classes behind a provider read. Passed by the caller:
the probe chunk carries the core classes (their only declared home),
while command paths reuse the entries they already load.
*/
export interface ProviderReadSources {
  readonly noAuth: typeof NoAuthSource
  readonly apiKey: typeof ApiKeyAuthSource
}

/**
One pinned, authenticated provider GET as JSON: the shared read behind
`getProviderJson` (D119) and `probeProvider` (D74). It answers the status
with its parsed body, or the raw transport failure as `cause` with its
signal for the caller to map; transport detail never reaches the terminal.
*/
export async function readProviderJson(
  fetchImpl: typeof fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  url: string,
  headers: Readonly<Record<string, string>>,
  failures: Pick<TransportDeps, 'parseError' | 'sendFailure'>,
  sources: ProviderReadSources,
): Promise<
  | { readonly status: number; readonly body: unknown }
  | { readonly cause: unknown; readonly signal: AbortSignal }
> {
  const shared = await import('../host/backend/modelApiEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  const origin = new URL(url).origin
  const source =
    key === undefined
      ? new sources.noAuth(origin)
      : new sources.apiKey(
          () =>
            Promise.resolve({
              record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
              key,
            }),
          provider.preset.id === 'custom' && provider.entry.format === 'anthropic'
            ? 'x-api-key'
            : (provider.preset.authHeader ?? 'bearer'),
        )
  const client = new shared.RequestTransport({
    baseUrl: origin,
    auth: source,
    // pinProviderFetch rechecks DNS and the saved path/network at every dispatch.
    verifyEndpoint: async (requestUrl) => {
      await source.headers(requestUrl)
    },
    fetch: fetchImpl,
    // Optional with exactOptionalPropertyTypes: an explicit undefined does
    // not typecheck, so each reader stays out unless it is defined — the
    // list read sends none, the key test sends the provider's own.
    ...(failures.parseError !== undefined && { parseError: failures.parseError }),
    ...(failures.sendFailure !== undefined && { sendFailure: failures.sendFailure }),
    now: Date.now,
    random: Math.random,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // Commands report fixed probe outcomes; transport detail is never logged.
    log: {
      info: ignoreProbeLog,
      warn: ignoreProbeLog,
      error: ignoreProbeLog,
      trace: ignoreProbeLog,
    },
  })
  const signal = AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS)
  let result: Awaited<ReturnType<typeof client.request>>
  try {
    result = await client.request(
      url.slice(origin.length),
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'catalogue',
          isMetaDirect: false,
        }),
        method: 'GET',
        headers,
        accept: 'application/json',
        retries: 'rateLimitOnly',
      },
      signal,
    )
  } catch (error: unknown) {
    return { cause: error, signal }
  }
  try {
    return {
      status: result.response.status,
      body: await shared.parseJsonResponse(result, (value) => value),
    }
  } catch (error: unknown) {
    // The shared reader wraps a damaged body as the transport's own
    // error; anything else is not this read's answer to give.
    if (!(error instanceof shared.ModelApiError)) throw error
    return { status: result.response.status, body: undefined }
  }
}
