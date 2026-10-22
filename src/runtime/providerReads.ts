// One pinned provider GET as JSON, with the list helpers behind it: the
// shared read for the free probe (D74) and the provider commands (D119).
// The transport and the entries load lazily, as they did at each call
// site; only leaf modules load statically.
import * as z from 'zod/mini'
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

export function attributionHeaders(preset: ProviderPreset): Record<string, string> {
  return preset.id === 'openrouter'
    ? {
        [OPENROUTER_ATTRIBUTION.refererHeader]: OPENROUTER_ATTRIBUTION.referer,
        [OPENROUTER_ATTRIBUTION.titleHeader]: OPENROUTER_ATTRIBUTION.title,
        [OPENROUTER_ATTRIBUTION.categoriesHeader]: OPENROUTER_ATTRIBUTION.categories,
      }
    : {}
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
): Promise<
  | { readonly status: number; readonly body: unknown }
  | { readonly cause: unknown; readonly signal: AbortSignal }
> {
  const shared = await import('../host/backend/modelApiEntry')
  const auth = await import('../host/backend/configuredProvidersEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  auth.setUiText(UI_TEXT, uiLocale())
  const origin = new URL(url).origin
  const source =
    key === undefined
      ? new auth.NoAuthSource(origin)
      : new auth.ApiKeyAuthSource(
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
