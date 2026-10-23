// The provider's own model list (D119): the ids as the provider lists
// them, read with the pinned, authenticated transport. The probe, the
// panel's refresh and headless refresh on use share this one read, so the
// list keeps a single parser and a single request shape.
import { HTTP_STATUS } from '../../shared/constants'
import { listModelIds, providerListHeaders, readProviderJson } from '../providerReads'
import {
  allowedProviderPaths,
  pinProviderFetch,
  providerModelsPath,
  type ResolvedProvider,
} from './providerExec'

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
  const auth = await import('../../host/backend/configuredProvidersEntry')
  const via =
    transport ?? pinProviderFetch(fetch, provider, allowedProviderPaths(provider), resolveHost)
  const read = await readProviderJson(
    via,
    provider,
    key,
    url,
    headers,
    {},
    { noAuth: auth.NoAuthSource, apiKey: auth.ApiKeyAuthSource },
  )
  if ('cause' in read) {
    const error = read.cause
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
