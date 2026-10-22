// The provider's own model list (D119): the ids as the provider lists
// them, read with the pinned, authenticated transport. The probe, the
// panel's refresh and headless refresh on use share this one read, so the
// list keeps a single parser and a single request shape.
import * as z from 'zod/mini'
import type { TransportDeps } from '../../core/backends/modelapi/transport'
import type { ProviderPreset } from '../../core/providers/presets'
import { presets } from '../../host/backend/providersEntry'
import {
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  PROVIDER_PROBE_MODEL_IDS_MAX,
  PROVIDER_PROBE_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import {
  allowedProviderPaths,
  pinProviderFetch,
  providerModelsPath,
  type ResolvedProvider,
} from './providerExec'

const { OPENROUTER_ATTRIBUTION } = presets

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

function attributionHeaders(preset: ProviderPreset): Record<string, string> {
  return preset.id === 'openrouter'
    ? {
        [OPENROUTER_ATTRIBUTION.refererHeader]: OPENROUTER_ATTRIBUTION.referer,
        [OPENROUTER_ATTRIBUTION.titleHeader]: OPENROUTER_ATTRIBUTION.title,
        [OPENROUTER_ATTRIBUTION.categoriesHeader]: OPENROUTER_ATTRIBUTION.categories,
      }
    : {}
}

function ignoreProbeLog(): void {
  // Callers return fixed probe outcomes; transport details never reach terminal logs.
}

/**
One pinned, authenticated provider GET as JSON: the shared read behind
`getProviderJson` (D119) and `probeProvider` (D74). It answers the status
with its parsed body, or the raw transport error with its signal for the
caller to map; transport detail never reaches the terminal.
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
  | { readonly error: unknown; readonly signal: AbortSignal }
> {
  const shared = await import('../../host/backend/modelApiEntry')
  const auth = await import('../../host/backend/configuredProvidersEntry')
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
    // Callers report fixed probe outcomes; transport detail is never logged.
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
        method: 'GET',
        headers,
        accept: 'application/json',
        retries: 'rateLimitOnly',
      },
      signal,
    )
  } catch (error: unknown) {
    return { error, signal }
  }
  try {
    return {
      status: result.response.status,
      body: await shared.parseJsonResponse(result, (value) => value),
    }
  } catch {
    return { status: result.response.status, body: undefined }
  }
}

/** One pinned, authenticated provider read (D119): the status with its parsed body, an HTTP status alone, or the transport failure. */
async function getProviderJson(
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  headers: Readonly<Record<string, string>>,
  url: string,
  transport?: typeof fetch,
): Promise<
  | { readonly status: number; readonly body: unknown }
  | { readonly transport: 'rebinding' | 'unreachable' }
> {
  const shared = await import('../../host/backend/modelApiEntry')
  const via =
    transport ?? pinProviderFetch(fetch, provider, allowedProviderPaths(provider), resolveHost)
  const read = await readProviderJson(via, provider, key, url, headers, {})
  if ('error' in read) {
    const error = read.error
    if (error instanceof shared.ModelApiError && error.status !== 0) {
      return { status: error.status, body: undefined }
    }
    return {
      transport:
        error instanceof Error && error.message === 'rebinding' ? 'rebinding' : 'unreachable',
    }
  }
  return read
}

/** The request headers behind a provider's list read. */
export function providerListHeaders(provider: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = { ...attributionHeaders(provider.preset) }
  if ((provider.entry.format ?? provider.preset.format) === 'anthropic') {
    // Both captured Anthropic list requests carry this exact version.
    headers['anthropic-version'] = '2023-06-01'
  }
  return headers
}

/**
The provider's own model list (D119): the ids as the provider lists them,
or undefined where the list cannot be read with the stored key (no key,
no free check, unreachable, unparseable). Nothing is billed.
*/
export async function listProviderModels(
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<readonly string[] | undefined> {
  if (provider.preset.keyTest.kind === 'paid-token') return undefined
  if (key === undefined && provider.preset.auth === 'apiKey') return undefined
  const listed = await getProviderJson(
    fetch,
    provider,
    key,
    resolveHost,
    providerListHeaders(provider),
    `${provider.origin}${providerModelsPath(provider)}`,
  )
  return !('status' in listed) || listed.status !== HTTP_STATUS.ok
    ? undefined
    : listModelIds(listed.body, provider.preset)
}
