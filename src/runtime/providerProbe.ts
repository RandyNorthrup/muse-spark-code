// Free provider checks load with configuredProviders, outside headless preflight.
import { ApiKeyAuthSource, NoAuthSource } from '../core/backends/modelapi/authSource'
import { isUnreachableSend } from '../core/unreachableSend'
import { HTTP_STATUS, UI_TEXT } from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'
import {
  allowedProviderPaths,
  pinProviderFetch,
  providerModelsPath,
  type ResolvedProvider,
} from './exec/providerExec'
import { attributionHeaders, listModelIds, readProviderJson } from './providerReads'

export type ProbeOutcome =
  | { readonly ok: true; readonly modelCount: number | undefined }
  | { readonly ok: false; readonly paid: boolean; readonly reason: string }

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
    const read = await readProviderJson(
      transport,
      provider,
      key,
      url,
      headers,
      {},
      {
        noAuth: NoAuthSource,
        apiKey: ApiKeyAuthSource,
      },
    )
    if (!('cause' in read)) return read
    const error = read.cause
    if (error instanceof shared.ModelApiError && error.status !== 0) {
      return { status: error.status, body: undefined }
    }
    // A send that never got an answer reads as unreachable (or the
    // pin's rebinding); anything else is not this probe's answer to give.
    if (!isUnreachableSend(error)) throw error
    failureReason =
      error instanceof Error && error.message === 'rebinding' ? 'rebinding' : 'unreachable'
    return undefined
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
