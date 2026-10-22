// Free provider checks load with configuredProviders, outside headless preflight.
import * as z from 'zod/mini'
import { resolveAttemptBillingRoute } from '../core/backends/modelapi/billingRoute'
import { ApiKeyAuthSource, NoAuthSource } from '../core/backends/modelapi/authSource'
import type { ProviderPreset } from '../core/providers/presets'
import { presets } from '../host/backend/providersEntry'
const { OPENROUTER_ATTRIBUTION } = presets
import {
  CREDENTIAL_RECORD_VERSION,
  HTTP_STATUS,
  PROVIDER_PROBE_MODEL_IDS_MAX,
  PROVIDER_PROBE_TIMEOUT_MS,
  UI_TEXT,
} from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'
import {
  allowedProviderPaths,
  pinProviderFetch,
  providerModelsPath,
  type ResolvedProvider,
} from './exec/providerExec'

function attributionHeaders(preset: ProviderPreset): Record<string, string> {
  return preset.id === 'openrouter'
    ? {
        [OPENROUTER_ATTRIBUTION.refererHeader]: OPENROUTER_ATTRIBUTION.referer,
        [OPENROUTER_ATTRIBUTION.titleHeader]: OPENROUTER_ATTRIBUTION.title,
        [OPENROUTER_ATTRIBUTION.categoriesHeader]: OPENROUTER_ATTRIBUTION.categories,
      }
    : {}
}

export type ProbeOutcome =
  | { readonly ok: true; readonly modelCount: number | undefined }
  | { readonly ok: false; readonly paid: boolean; readonly reason: string }

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

function listModelIds(body: unknown, preset: ProviderPreset): readonly string[] | undefined {
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
The free check that proves a key works (D74): the preset's models list,
or its provider-key path where the list is public. Nothing is billed.
Azure's `paid-token` test has no free check and stays in the panel, where
its cost is asked first.
*/
export async function probeProvider(
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  key: string | undefined,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<ProbeOutcome> {
  const test = provider.preset.keyTest
  if (test.kind === 'paid-token') {
    return { ok: false, paid: true, reason: 'paid' }
  }
  const headers: Record<string, string> = { ...attributionHeaders(provider.preset) }
  if ((provider.entry.format ?? provider.preset.format) === 'anthropic') {
    // Both captured Anthropic list requests carry this exact version.
    headers['anthropic-version'] = '2023-06-01'
  }
  if (key === undefined && provider.preset.auth === 'apiKey') {
    return { ok: false, paid: false, reason: 'no-key' }
  }
  const shared = await import('../host/backend/modelApiEntry')
  shared.setUiText(UI_TEXT, uiLocale())
  const pinned = pinProviderFetch(fetch, provider, allowedProviderPaths(provider), resolveHost)
  let failureReason = 'unreachable'
  const get = async (
    url: string,
    transport: typeof fetch = pinned,
  ): Promise<{ readonly status: number; readonly body: unknown } | undefined> => {
    const origin = new URL(url).origin
    const source =
      key === undefined
        ? new NoAuthSource(origin)
        : new ApiKeyAuthSource(
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
      fetch: transport,
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
        AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
      )
    } catch (error: unknown) {
      if (error instanceof shared.ModelApiError && error.status !== 0) {
        return { status: error.status, body: undefined }
      }
      failureReason =
        error instanceof Error && error.message === 'rebinding' ? 'rebinding' : 'unreachable'
      return undefined
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
  if (test.kind === 'provider-key') {
    const base = test.origin ?? provider.origin
    const keyFetch =
      base === provider.origin
        ? pinned
        : pinProviderFetch(
            fetch,
            { ...provider, origin: base, network: 'public', request: undefined },
            [{ kind: 'exact', path: test.path }],
            resolveHost,
          )
    const checked = await get(`${base}${test.path}`, keyFetch)
    if (checked === undefined) {
      return { ok: false, paid: false, reason: failureReason }
    }
    if (checked.status !== HTTP_STATUS.ok) {
      return { ok: false, paid: false, reason: `HTTP ${String(checked.status)}` }
    }
  }
  const listUrl =
    test.kind === 'provider-key' && test.origin !== undefined && test.origin !== provider.origin
      ? undefined
      : `${provider.origin}${providerModelsPath(provider)}`
  if (listUrl === undefined) {
    return { ok: true, modelCount: undefined }
  }
  const listed = await get(listUrl)
  if (listed === undefined) {
    return { ok: false, paid: false, reason: failureReason }
  }
  if (listed.status !== HTTP_STATUS.ok) {
    return { ok: false, paid: false, reason: `HTTP ${String(listed.status)}` }
  }
  const ids = listModelIds(listed.body, provider.preset)
  return ids === undefined
    ? { ok: false, paid: false, reason: 'unparseable' }
    : { ok: true, modelCount: ids.length }
}
