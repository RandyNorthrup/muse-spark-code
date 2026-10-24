// The real configured-provider request builder, up to the socket (M95c):
// a real providers file, the vendored models.dev snapshot as the
// catalogue, the real record resolution, codec, credential and header
// reads and the real pinned transport. Only the socket outcome is
// injected, as a failure after the request was captured, so no request
// leaves the machine and no answer is invented. DNS is answered with a
// public address literal that is never dialled.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createConfiguredProviderServices,
  type ConfiguredProviderOptions,
} from '../../../src/core/providers/configured'
import { noRetryBudget } from '../../../src/core/backends/modelapi/transport'
import type { CreateResponseBody } from '../../../src/core/backends/modelapi/schemas'
import type { ProviderEntry } from '../../../src/core/providers/providersFile'
import { PROVIDERS_FILE_VERSION } from '../../../src/shared/constants'

/** One request as the transport handed it to the socket. */
export interface WireRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
}

/** The vendored catalogue snapshot the build ships (real data, never invented). */
export const VENDORED_CATALOGUE = path.resolve('vendor/models-dev/snapshot.json')

/** A stored key record, bound to `origin`, as the panel and `providers add` write it. */
export function storedKey(origin: string, secret: string): string {
  return JSON.stringify({ v: 1, auth: 'apiKey', origin, secret })
}

/**
Configured services over one providers file holding `entries`, with
`secrets` as the credential store and every send captured into
`captured`. Extra options (a setting reader) ride as given.
*/
export function wireServices(
  entries: readonly ProviderEntry[],
  secrets: Readonly<Record<string, string>>,
  captured: WireRequest[],
  extra: Partial<ConfiguredProviderOptions> = {},
): ReturnType<typeof createConfiguredProviderServices> {
  const directory = mkdtempSync(path.join(tmpdir(), 'provider-wire-'))
  const configFile = path.join(directory, 'providers.json')
  writeFileSync(configFile, JSON.stringify({ v: PROVIDERS_FILE_VERSION, providers: entries }))
  return createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: VENDORED_CATALOGUE,
    secrets: { get: (key) => Promise.resolve(secrets[key]) },
    resolve: () => Promise.resolve(['8.8.8.8']),
    send: (target, body, headers) => {
      captured.push({
        url: target.url.href,
        headers,
        body: body === undefined ? undefined : JSON.parse(body),
      })
      return Promise.reject(new Error('the injected socket failed after dispatch'))
    },
    ...extra,
  })
}

/** The one turn request `body` makes for `ref`, as it reached the socket. */
export async function turnRequest(
  services: ReturnType<typeof createConfiguredProviderServices>,
  captured: WireRequest[],
  ref: string,
  body: CreateResponseBody,
): Promise<WireRequest> {
  const registry = services.registry
  if (registry.list === undefined) throw new TypeError('Expected a listing registry')
  await registry.list()
  const resolved = await registry.resolve(ref)
  const before = captured.length
  const stream = resolved.client.streamResponse(
    body,
    new AbortController().signal,
    undefined,
    noRetryBudget(),
  )
  try {
    await stream.next()
  } catch (error: unknown) {
    // The injected socket's failure is the expected end; a failure before
    // any request reached it is the test's own and is rethrown.
    if (captured.length === before) throw error
  }
  const request = captured.at(-1)
  if (request === undefined || captured.length !== before + 1)
    throw new Error(`Expected exactly one request, saw ${String(captured.length - before)}`)
  return request
}
