// A BYO provider run in headless exec (M95, PLAN.md D74): resolving the
// provider, pinning the origin and allowlisting the codec's paths.
//
// Only a provider from the runner's own user file (`providers.json` beside,
// never inside, Muse Code's config folder) or a built-in preset's fixed
// origin may run; a repository file is never consulted, so a workspace
// cannot aim a run at its own address. The resolved origin pins every
// request the run makes, and only the codec's own paths pass: the models
// list (the free key test), the provider-key check where one exists, and
// the codec's request path. Anything else is refused before it is sent.
//
// Request paths come from the live captures
// (`docs/certification/m95-captures.md`, 2026-10-04) where a preset has
// one, else from the research's official API references
// (`docs/certification/m95-research.md` §1); a preset without either has no
// request path and refuses to run until its capture is recorded (rule 13).

import * as z from 'zod/mini'
import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { CredentialRecord } from '../../core/providers/credentialRecord'
const { isCredentialBound } = credentialRecord
const { checkEndpointUrl, originOf, verifyRequestAnswers } = endpointPolicy
const { isProviderId, parseModelRef } = modelRef
import type { ProviderPreset } from '../../core/providers/presets'
const { azureOrigin, inspectProviderKey, presetById, providerKeyNoticeText } = presets
import type {
  ProviderEntry,
  ProviderFormat,
  ProvidersFile,
} from '../../core/providers/providersFile'
const { readProvidersFile, refusalDetail } = providersFile
import { UserRefusalError } from '../../core/refusal'
import { unlessAborted } from '../../core/timeouts'
import {
  credentialRecord,
  endpointPolicy,
  modelRef,
  presets,
  providersFile,
  setUiText as setProvidersUiText,
} from '../../host/backend/providersEntry'
import type { SecretStore } from '../../host/auth/credentialStore'
import {
  ADDRESS_FAMILIES,
  CREDENTIAL_RECORD_VERSION,
  HTTP_REDIRECT_STATUSES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, uiLocale } from '../../shared/l10n/text'
import { listModelsRemedy, unknownProviderModelText } from '../../core/unknownModel'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from '../keyStore'
import {
  memorySecretStoreFor,
  providerKeyFailureText,
  type KeyLineResult,
  type MemorySecretStore,
} from './keyInput'
/** Where a request path came from (AGENTS.md rule 13). */
export type PathSource = 'capture' | 'research'

/** One allowed path on the pinned origin: exact, or a prefix with a suffix. */
export type ProviderPathRule =
  | { readonly kind: 'exact'; readonly path: string }
  | { readonly kind: 'family'; readonly prefix: string; readonly suffix: string }

export interface ProviderRequestPath {
  readonly rule: ProviderPathRule
  readonly source: PathSource
}

/**
The codec's request path per preset, from the 2026-10-04 captures unless
said. Local servers, the custom preset and Azure follow the research's
official references (research §1); a preset without either has no
request path and refuses to run until its capture is recorded (rule 13).
*/
function requestPathFor(preset: ProviderPreset): ProviderRequestPath | undefined {
  switch (preset.id) {
    case 'openai':
    case 'xai': {
      return { rule: { kind: 'exact', path: '/v1/responses' }, source: 'capture' }
    }
    case 'azure': {
      // No capture yet: the v1 API is Responses as OpenAI's, rooted at the
      // entry's `/openai/v1` address (research §1.2 [AZ1, AZ3, AZ6]).
      return { rule: { kind: 'exact', path: '/openai/v1/responses' }, source: 'research' }
    }
    case 'anthropic': {
      return { rule: { kind: 'exact', path: '/v1/messages' }, source: 'capture' }
    }
    case 'openrouter': {
      return { rule: { kind: 'exact', path: '/api/v1/chat/completions' }, source: 'capture' }
    }
    case 'groq': {
      return { rule: { kind: 'exact', path: '/openai/v1/chat/completions' }, source: 'capture' }
    }
    case 'mistral':
    case 'together': {
      return { rule: { kind: 'exact', path: '/v1/chat/completions' }, source: 'capture' }
    }
    case 'fireworks': {
      return { rule: { kind: 'exact', path: '/inference/v1/chat/completions' }, source: 'capture' }
    }
    case 'deepseek': {
      return { rule: { kind: 'exact', path: '/chat/completions' }, source: 'capture' }
    }
    case 'huggingface': {
      return { rule: { kind: 'exact', path: '/v1/chat/completions' }, source: 'capture' }
    }
    case 'zai': {
      return { rule: { kind: 'exact', path: '/api/paas/v4/chat/completions' }, source: 'capture' }
    }
    case 'gemini': {
      // Captured as `POST …/v1beta/models/{m}:streamGenerateContent?alt=sse`.
      return {
        rule: { kind: 'family', prefix: '/v1beta/models/', suffix: ':streamGenerateContent' },
        source: 'capture',
      }
    }
    case 'ollama': {
      return { rule: { kind: 'exact', path: '/api/chat' }, source: 'research' }
    }
    case 'lmstudio':
    case 'vllm':
    case 'llamacpp': {
      return { rule: { kind: 'exact', path: '/v1/chat/completions' }, source: 'research' }
    }
    default: {
      return undefined
    }
  }
}

/** The request path for a custom server's format (research §1's defaults). */
function customBasePath(entry: ProviderEntry, format: ProviderFormat): string {
  const path = new URL(entry.address ?? '').pathname.replace(/\/+$/u, '')
  if (path !== '') return path
  if (format === 'gemini') return '/v1beta'
  return format === 'ollama' ? '/api' : '/v1'
}

/** Custom addresses name the API base, including its version/prefix. */
export function providerModelsPath(provider: ResolvedProvider): string {
  if (provider.preset.id !== 'custom') {
    // Below the address root: bare origins join nothing, while an Azure
    // entry lists below its `/openai/v1` root (research §1.2 [AZ6]).
    const base = new URL(provider.entry.address ?? '').pathname.replace(/\/+$/u, '')
    return `${base}${provider.preset.modelsList.path}`
  }
  const format = provider.entry.format ?? provider.preset.format
  return `${customBasePath(provider.entry, format)}/${format === 'ollama' ? 'tags' : 'models'}`
}

function customRequestPath(format: ProviderFormat, base: string): ProviderPathRule {
  switch (format) {
    case 'responses': {
      return { kind: 'exact', path: `${base}/responses` }
    }
    case 'anthropic': {
      return { kind: 'exact', path: `${base}/messages` }
    }
    case 'ollama': {
      return { kind: 'exact', path: `${base}/chat` }
    }
    case 'gemini': {
      return { kind: 'family', prefix: `${base}/models/`, suffix: ':streamGenerateContent' }
    }
    case 'chat': {
      return { kind: 'exact', path: `${base}/chat/completions` }
    }
    default: {
      const exhaustive: never = format
      throw new Error(`unknown custom format: ${String(exhaustive)}`)
    }
  }
}

/** Whether the URL's path (and, for families, the model call's query) may go. */
export function isPathAllowed(rule: ProviderPathRule, url: URL): boolean {
  return rule.kind === 'exact'
    ? url.pathname === rule.path
    : url.pathname.startsWith(rule.prefix) &&
        url.pathname.endsWith(rule.suffix) &&
        (url.search === '' || url.search === '?alt=sse')
}

export type ProviderResolveError =
  'unknown-provider' | 'unknown-preset' | 'bad-address' | 'endpoint-refused' | 'no-request-path'

const catalogPresenceSchema = z.object({
  providers: z.record(z.string(), z.object({ models: z.record(z.string(), z.unknown()) })),
  unpriced: z.optional(z.record(z.string(), z.record(z.string(), z.unknown()))),
})

/** D4: the catalogue presence the CLI warnings read (a subset of the priced catalogue). */
export type CatalogPresence = z.infer<typeof catalogPresenceSchema>

/** D4: the CLI's presence read of the priced catalogue; undefined never blocks add/test/list. */
export function parseCatalogPresence(value: unknown): CatalogPresence | undefined {
  const parsed = catalogPresenceSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/**
D4: whether a configured model has no price card anywhere. Mirrors the
pricing half of `core/providers/configured.ts`, which stays the pricing
source of truth; this copy only warns at add/test/list time, never
refuses. An `unpriced` catalogue entry is capability evidence, not price
evidence — configured resolution still leaves that model unpriced and an
exec run refuses it — so only a priced catalogue record or a user-entered
price suppresses the warning. A plan-key preset never warns: configured
resolution assigns its models `{ kind: 'plan' }`, so the run is not
refused as unpriced.
*/
export function isModelUnpriced(
  catalog: CatalogPresence,
  presetId: string,
  entry: Pick<ProviderEntry, 'auth' | 'prices'>,
  nativeModel: string,
): boolean {
  if (presets.planKeyPresetById(presetId) !== undefined) return false
  const base = presetId.replace('-plan', '')
  const isPriced = catalog.providers[base]?.models[nativeModel] !== undefined
  return (
    !isPriced &&
    presetId !== 'custom' &&
    entry.auth !== 'none' &&
    entry.prices?.[nativeModel] === undefined
  )
}

export interface ResolvedProvider {
  readonly entry: ProviderEntry
  readonly preset: ProviderPreset
  /** The exact origin every request must go to. */
  readonly origin: string
  /** `local` for loopback, `private` once confirmed, else `public`. */
  readonly network: 'local' | 'private' | 'public'
  /** The codec's request path on that origin (absent until captured). */
  readonly request: ProviderRequestPath | undefined
}

/**
Resolve a provider id against the runner's own user file only. `presets`
is the built-in table (lane P's `presetById`); `resolveHost` answers DNS
for the address check. A repository file is never read here: callers pass
the user file's content, so a workspace's `providers.json` cannot aim a
run elsewhere.
*/
export async function resolveProvider(
  file: ProvidersFile,
  providerId: string,
  presets: (id: string) => ProviderPreset | undefined,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): Promise<
  | { readonly ok: true; readonly provider: ResolvedProvider }
  | { readonly ok: false; readonly error: ProviderResolveError }
> {
  if (!isProviderId(providerId)) {
    return { ok: false, error: 'unknown-provider' }
  }
  const entry = file.providers.find((candidate) => candidate.id === providerId)
  if (entry === undefined) {
    return { ok: false, error: 'unknown-provider' }
  }
  const preset = presets(entry.preset)
  if (preset === undefined) {
    return { ok: false, error: 'unknown-preset' }
  }
  const address =
    entry.address ?? (preset.origin.kind === 'fixed' ? preset.origin.origin : undefined)
  if (address === undefined || address.trim() === '') {
    return { ok: false, error: 'bad-address' }
  }
  let url: URL
  try {
    const azure = preset.origin.kind === 'azure-resource' ? azureOrigin(address) : undefined
    url = new URL(azure ?? address)
  } catch (error) {
    // Only an invalid address fails here; anything else is not this resolution's answer.
    if (!(error instanceof TypeError)) throw error
    return { ok: false, error: 'bad-address' }
  }
  const answers = await resolveHost(url.hostname)
  const verdict = checkEndpointUrl(url.href, answers)
  if (verdict.kind === 'refused') {
    return { ok: false, error: 'endpoint-refused' }
  }
  if (verdict.kind === 'confirm-private' && entry.privateNetwork !== true) {
    return { ok: false, error: 'endpoint-refused' }
  }
  const network = verdict.kind === 'confirm-private' ? 'private' : verdict.network
  const request =
    preset.id === 'custom'
      ? {
          rule: customRequestPath(
            entry.format ?? preset.format,
            customBasePath(entry, entry.format ?? preset.format),
          ),
          source: 'research' as const,
        }
      : requestPathFor(preset)
  return request === undefined
    ? { ok: false, error: 'no-request-path' }
    : { ok: true, provider: { entry, preset, origin: verdict.origin, network, request } }
}

/** The allowlisted paths for a resolved provider: its request, list and key-test paths. */
export function allowedProviderPaths(provider: ResolvedProvider): readonly ProviderPathRule[] {
  const rules: ProviderPathRule[] = [provider.request?.rule].filter(
    (rule): rule is ProviderPathRule => rule !== undefined,
  )
  const listPath = providerModelsPath(provider)
  rules.push({ kind: 'exact', path: listPath })
  const test = provider.preset.keyTest
  const extraPath =
    test.kind === 'provider-key' && (test.origin === undefined || test.origin === provider.origin)
      ? test.path
      : undefined
  if (
    extraPath !== undefined &&
    rules.every((rule) => rule.kind !== 'exact' || rule.path !== extraPath)
  ) {
    rules.push({ kind: 'exact', path: extraPath })
  }
  return rules
}

/** Whether the saved endpoint's answers still hold before a request (DNS rebinding). */
export function isEndpointBindingCurrent(
  provider: ResolvedProvider,
  answers: readonly string[],
): boolean {
  return verifyRequestAnswers(provider.network, answers).ok
}

export type ProviderCredentialError = 'no-secret' | 'unparseable' | 'origin-mismatch'

/**
The provider's key from the secret store: parsed, present, and bound to
the resolved origin. An edited file aiming elsewhere refuses here and the
caller asks for the credential again, naming both origins.
*/
export async function readProviderKey(
  secrets: { get(key: string): PromiseLike<string | undefined> },
  provider: ResolvedProvider,
): Promise<
  | { readonly ok: true; readonly key: string; readonly record: CredentialRecord }
  | {
      readonly ok: false
      readonly error: ProviderCredentialError
      readonly record?: CredentialRecord
    }
> {
  if (provider.preset.auth === 'none' && provider.entry.auth === 'none') {
    return { ok: false, error: 'no-secret' }
  }
  const account = providerSecretAccount(provider.entry.id)
  if (account === undefined) {
    return { ok: false, error: 'no-secret' }
  }
  const stored = await secrets.get(account)
  if (stored === undefined || stored === '') {
    return { ok: false, error: 'no-secret' }
  }
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error) {
    // Only malformed text fails here; anything else is not this parse's answer.
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, error: 'unparseable' }
  }
  const parsed = parseStoredProviderSecret(value)
  if (parsed === undefined) {
    return { ok: false, error: 'unparseable' }
  }
  return isCredentialBound(parsed.record, provider.origin)
    ? { ok: true, key: parsed.key, record: parsed.record }
    : { ok: false, error: 'origin-mismatch', record: parsed.record }
}

/** A streamed upload forwarded chunk by chunk; anything else is sent whole. */
function endPinnedBody(
  outgoing: {
    write(chunk: Uint8Array, callback: () => void): void
    end(body?: Uint8Array | string): void
  },
  body: RequestInit['body'],
  reject: (error: unknown) => void,
): void {
  if (body === undefined || body === null) {
    outgoing.end()
    return
  }
  if (typeof body === 'string' || body instanceof Uint8Array) {
    outgoing.end(body)
    return
  }
  if (body instanceof ArrayBuffer) {
    outgoing.end(new Uint8Array(body))
    return
  }
  if (body instanceof ReadableStream) {
    const reader = body.getReader()
    const pump = (): void => {
      void reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            reader.releaseLock()
            outgoing.end()
            return
          }
          if (!(value instanceof Uint8Array)) {
            reader.releaseLock()
            reject(new TypeError('refused'))
            return
          }
          outgoing.write(value, pump)
        })
        .catch((error: unknown) => {
          reader.releaseLock()
          reject(error)
        })
    }
    pump()
    return
  }
  reject(new TypeError('refused'))
}

/**
Whether an answer's status refuses the request instead of being
followed: redirects are refused like `redirect: 'error'`, never
followed. Pure — `sendPinned` calls this on every answer's status — so
the refusal is provable with statuses as plain input and nothing
answering; the end-to-end behaviour is proven by the real-life run
through the packed product (docs/certification/auditsec0190b.md).
*/
export function isRedirectRefusal(statusCode: number | undefined): boolean {
  return statusCode !== undefined && HTTP_REDIRECT_STATUSES.has(statusCode)
}

/**
One request to the checked address: Node's HTTP stack dials it through a
`lookup` that answers that address only, so the address checked is the
address dialled even when DNS changes in between (DNS rebinding). TLS
still sends and verifies the original name (`servername` defaults to it)
and the `Host` header carries it, as web fetch's pinned transport does
(`src/host/web/pinnedRequest.ts`). Answers a fetch `Response`; redirects
are refused like `redirect: 'error'`.
*/
function sendPinned(url: URL, init: RequestInit | undefined, address: string): Promise<Response> {
  const isTls = url.protocol === 'https:'
  const headers = new Headers(init?.headers ?? {})
  headers.set('host', url.host)
  const payload = init?.body
  if (typeof payload === 'string') headers.set('content-length', String(Buffer.byteLength(payload)))
  else if (payload instanceof Uint8Array || payload instanceof ArrayBuffer)
    headers.set('content-length', String(payload.byteLength))
  const family =
    isIP(address) === ADDRESS_FAMILIES.ipv6 ? ADDRESS_FAMILIES.ipv6 : ADDRESS_FAMILIES.ipv4
  const options: RequestOptions = {
    method: init?.method ?? 'GET',
    host: url.hostname,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(headers.entries()),
    family,
    lookup: (_hostname, _lookupOptions, callback) => {
      callback(null, address, family)
    },
    signal: init?.signal ?? undefined,
  }
  return new Promise<Response>((resolve, reject) => {
    const outgoing = (isTls ? httpsRequest : httpRequest)(options, (incoming) => {
      if (isRedirectRefusal(incoming.statusCode)) {
        incoming.destroy()
        outgoing.destroy()
        reject(new TypeError('fetch failed'))
        return
      }
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue
        const items = Array.isArray(value) ? value : [value]
        for (const item of items) responseHeaders.append(name, item)
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          incoming.on('data', (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
          })
          incoming.on('end', () => {
            controller.close()
          })
          incoming.on('error', (error: unknown) => {
            controller.error(error)
          })
        },
        cancel() {
          incoming.destroy()
        },
      })
      resolve(
        new Response(body, {
          status: incoming.statusCode ?? 0,
          statusText: incoming.statusMessage ?? '',
          headers: responseHeaders,
        }),
      )
    })
    outgoing.on('error', reject)
    endPinnedBody(outgoing, payload ?? undefined, reject)
  })
}

/**
The origin pin in front of the provider: only `https:` (or `http:` to the
pinned loopback origin) on the resolved origin, with no userinfo, query
(except the codec's own) or fragment, and only an allowlisted path. The
name is resolved once per request, the answers are checked against the
saved network, and the request dials the checked address itself — never a
name looked up again at connect time. A refusal throws before anything is
sent.
*/
function bareOriginOf(url: URL): string | undefined {
  // `originOf` refuses any URL with a query or fragment, but the codec's
  // own query (list filters, Gemini's `alt=sse`) is ruled per path below;
  // compare origins with the query and fragment set aside first.
  const bare = new URL(url.href)
  bare.search = ''
  bare.hash = ''
  return originOf(bare.href)
}

/**
A provider request URL through the origin pin and path allowlist, or
undefined when it fails the pin: a non-string, an unparsable address,
userinfo, a foreign origin, a scheme other than `https:` (`http:` only
to the pinned loopback origin), a fragment, or a path outside the
allowlist. Shared by both pin shapes below; each names the refusal its
own way.
*/
function parsePinnedUrl(
  provider: ResolvedProvider,
  rules: readonly ProviderPathRule[],
  url: unknown,
): URL | undefined {
  if (typeof url !== 'string') return undefined
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (error) {
    // Only an invalid address fails here; anything else is not this pin's answer.
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  if (parsed.username !== '' || parsed.password !== '') return undefined
  const origin = bareOriginOf(parsed)
  if (origin === undefined || origin !== originOf(provider.origin)) return undefined
  const isLoopback = provider.network === 'local'
  if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) return undefined
  if (parsed.hash !== '') return undefined
  const requestRule = provider.request?.rule
  if (requestRule !== undefined && isPathAllowed(requestRule, parsed)) {
    // The family rule already bounds the query to the codec's own; an
    // exact request path carries none.
    if (requestRule.kind === 'exact' && parsed.search !== '') return undefined
  } else if (rules.every((rule) => !(rule.kind === 'exact' && rule.path === parsed.pathname))) {
    // List and key-test paths may carry the provider's own query
    // (`limit`, `zdr`, `supported_parameters`); nothing else passes.
    return undefined
  }
  return parsed
}

/** The pin over an injected fetch (the exec tests' seam): typed refusals, abortable resolve, mapped connect failures. */
function pinProviderFetchViaFetch(
  fetch: typeof globalThis.fetch,
  ...rest: PinnedDialArgs
): typeof globalThis.fetch {
  const [provider, rules, resolveHost, onDispatch] = rest
  return async (url, init) => {
    const parsed = parsePinnedUrl(provider, rules, url)
    if (parsed === undefined) throw new UserRefusalError(UI_TEXT.providerProbeRebinding, 'not_sent')
    let answers: readonly string[]
    try {
      answers =
        (await unlessAborted(
          resolveHost(parsed.hostname),
          init?.signal ?? new AbortController().signal,
        )) ?? []
      if (init?.signal?.aborted === true) init.signal.throwIfAborted()
    } catch (error: unknown) {
      throw new UserRefusalError(UI_TEXT.providerProbeUnreachable, 'not_sent', error)
    }
    if (!isEndpointBindingCurrent(provider, answers))
      throw new UserRefusalError(UI_TEXT.providerProbeRebinding, 'not_sent')
    init?.signal?.throwIfAborted()
    onDispatch?.()
    try {
      return await fetch(url, { ...init, redirect: 'error' })
    } catch (error: unknown) {
      // A refused connection reads as unreachable with nothing sent; any
      // other dispatch failure stays what it is.
      if (
        error instanceof Error &&
        typeof error.cause === 'object' &&
        error.cause !== null &&
        'code' in error.cause &&
        error.cause.code === 'ECONNREFUSED'
      )
        throw new UserRefusalError(UI_TEXT.providerProbeUnreachable, 'not_sent', error)
      throw error
    }
  }
}

/** The pin over the checked address itself (the audit's DNS-rebinding dial): refused answers and redirects never connect. */
function pinProviderFetchViaDial(...args: PinnedDialArgs): typeof globalThis.fetch {
  const [provider, rules, resolveHost, onDispatch] = args
  return async (url, init) => {
    const parsed = parsePinnedUrl(provider, rules, url)
    if (parsed === undefined) throw new Error('refused')
    // Resolved once here, and dialled as resolved below: the address
    // checked is the address dialled, so a forbidden answer that arrives
    // after the check cannot be connected to.
    const answers = await resolveHost(parsed.hostname)
    if (!isEndpointBindingCurrent(provider, answers)) throw new Error('rebinding')
    const address = answers[0]
    if (address === undefined) throw new Error('rebinding')
    onDispatch?.()
    return await sendPinned(parsed, init, address)
  }
}

type FetchSeamArgs = [
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  rules: readonly ProviderPathRule[],
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  onDispatch?: () => void,
]

type PinnedDialArgs = [
  provider: ResolvedProvider,
  rules: readonly ProviderPathRule[],
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  onDispatch?: () => void,
]

export function pinProviderFetch(...args: FetchSeamArgs): typeof globalThis.fetch
export function pinProviderFetch(...args: PinnedDialArgs): typeof globalThis.fetch
export function pinProviderFetch(...args: FetchSeamArgs | PinnedDialArgs): typeof globalThis.fetch {
  // Two contracts share this name: the fetch seam names a fetch first (the
  // exec tests), the pinned dial names the provider first (the audit proof
  // and production). The first argument tells them apart; each tuple casts
  // exactly once below because positional typing cannot follow it.
  return typeof args[0] === 'function'
    ? pinProviderFetchViaFetch(...(args as FetchSeamArgs))
    : pinProviderFetchViaDial(...(args as PinnedDialArgs))
}

/** Everything a provider run needs, resolved and checked before it starts. */
export interface AssembledProviderRun {
  readonly resolveHost: (hostname: string) => Promise<readonly string[]>
  readonly provider: ResolvedProvider
  /** The qualified `<provider>/<model>` ref the run uses. */
  readonly modelRef: string
  /** The transport's fetch behind the origin pin and path allowlist. */
  readonly fetch: typeof fetch
  /** The run's secrets: the provider's envelope in memory, or the store when keyless. */
  readonly secrets: SecretStore
  /** Key material for the run's redactor. */
  readonly literals: readonly string[]
  /** The memory secrets, for the runner's cleanup. */
  readonly memory: MemorySecretStore | undefined
  /** One headless run owns its synchronous final dispatch fence. */
  readonly dispatch?: { onRequestStarted?: () => void }
}

export interface ProviderRunInput {
  /** The runner's own user file (never a repository file). */
  readonly filePath: string
  readonly readFile: (path: string) => Promise<string>
  readonly secrets: SecretStore
  readonly resolveHost: (hostname: string) => Promise<readonly string[]>
  /** A provider key from standard input: any non-blank value, judged by the provider. */
  readonly readKey: () => Promise<KeyLineResult>
  readonly providerId: string
  /** The qualified model ref (`parseExec` qualifies a bare id). */
  readonly model: string | undefined
  readonly keyFromStdin: boolean
}

export type ProviderAssemblyFailure =
  | { readonly kind: 'usage'; readonly reason: string }
  | { readonly kind: 'auth'; readonly reason: string }

/**
Resolve a provider run from the runner's own user file: the provider, a
model naming it, a bound credential (standard input or the store), a
re-checked endpoint, and the pinned fetch. Usage failures are the
caller's mistake; auth failures need a key. The turn itself is lane T/I's
`ProviderExecRunner` seam (`runExec.ts`); this function never sends one.
*/
export async function assembleProviderRun(input: ProviderRunInput): Promise<
  | {
      readonly ok: true
      readonly run: AssembledProviderRun
      /** A wrong-looking stdin key's question, printed before the run starts. */
      readonly notice: string | undefined
    }
  | { readonly ok: false; readonly failure: ProviderAssemblyFailure }
> {
  const usage = (
    reason: string,
  ): { readonly ok: false; readonly failure: ProviderAssemblyFailure } => ({
    ok: false,
    failure: { kind: 'usage', reason },
  })
  const auth = (
    reason: string,
  ): { readonly ok: false; readonly failure: ProviderAssemblyFailure } => ({
    ok: false,
    failure: { kind: 'auth', reason },
  })
  const read = await readProvidersFile(input.filePath, input.readFile)
  if (!read.ok) {
    return usage(
      read.reason === 'missing'
        ? fill(UI_TEXT.providerUnknown, { provider: input.providerId })
        : fill(UI_TEXT.providerTestFailed, { detail: refusalDetail(read) }),
    )
  }
  const resolved = await resolveProvider(read.file, input.providerId, presetById, input.resolveHost)
  if (!resolved.ok) {
    return resolved.error === 'unknown-provider' || resolved.error === 'unknown-preset'
      ? usage(fill(UI_TEXT.providerUnknown, { provider: input.providerId }))
      : usage(
          resolved.error === 'no-request-path'
            ? fill(UI_TEXT.providerNoRequestPath, { provider: input.providerId })
            : fill(UI_TEXT.providerEndpointRefused, { reason: resolved.error }),
        )
  }
  const { provider } = resolved
  const fallback = read.file.defaultModel
  const model = (fallback?.startsWith(`${provider.entry.id}/`) ?? false) ? fallback : undefined
  const requested = input.model ?? model
  if (requested === undefined) {
    // A default that names another provider is the file's choice, not this
    // run's model: the sentence names that default and the entry it cannot
    // run on. Only a run with no model anywhere needs --model spelled out.
    return usage(
      fallback === undefined
        ? UI_TEXT.execProviderModelRequired
        : unknownProviderModelText(fallback, provider.entry.id, UI_TEXT.execProviderModelRequired),
    )
  }
  const matches = provider.entry.models.filter(
    (id) => requested === id || requested === `${provider.entry.id}/${id}`,
  )
  if (matches.length > 1) return usage(UI_TEXT.execUnknownModel)
  // D4: a model that is not on this provider names what is, instead of the
  // generic sentence (which stays for a truly ambiguous id).
  if (matches.length === 0)
    return usage(
      fill(UI_TEXT.execModelNotOnProvider, {
        model: requested,
        provider: provider.entry.id,
        available: provider.entry.models.map((id) => `${provider.entry.id}/${id}`).join(', '),
      }),
    )
  const modelRef = `${provider.entry.id}/${matches[0] ?? ''}`
  const parsedRef = parseModelRef(modelRef)
  if (parsedRef?.providerId !== provider.entry.id) {
    // --model names another entry (or nothing parsable): the sentence names
    // the id as typed, this entry, and the command listing what it offers.
    return usage(unknownProviderModelText(modelRef, provider.entry.id, listModelsRemedy()))
  }
  if (provider.entry.models.length > 0 && !provider.entry.models.includes(parsedRef.modelId)) {
    // The entry does not offer this id: refuse before any request is sent.
    // An empty list judges nothing (unprobed entry); a listed one does.
    return usage(unknownProviderModelText(modelRef, provider.entry.id, listModelsRemedy()))
  }
  let key: string | undefined
  let memory: MemorySecretStore | undefined =
    provider.preset.auth === 'none' ? memorySecretStoreFor({}) : undefined
  let notice: string | undefined
  if (provider.preset.auth === 'apiKey') {
    const account = providerSecretAccount(provider.entry.id)
    if (account === undefined) {
      return usage(fill(UI_TEXT.providerUnknown, { provider: provider.entry.id }))
    }
    if (input.keyFromStdin) {
      // Any non-blank stdin key is used: the provider judges it, never
      // its shape. Headless input cannot answer a wrong-thing question,
      // so a value that looks like the wrong thing is named and the run
      // continues.
      const typed = await input.readKey()
      if (!typed.ok) {
        return auth(providerKeyFailureText(typed.reason))
      }
      key = typed.key
      // The notice is formatted in the providers bundle, which keeps its
      // own installed language: install this run's table before reading it.
      setProvidersUiText(UI_TEXT, uiLocale())
      const inspection = inspectProviderKey(key)
      notice =
        inspection === 'ok' || inspection === 'empty'
          ? undefined
          : providerKeyNoticeText(inspection)
      memory = memorySecretStoreFor({
        [account]: formatStoredProviderSecret(
          { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: provider.origin },
          key,
        ),
      })
    } else {
      const stored = await readProviderKey(input.secrets, provider)
      if (!stored.ok) {
        if (stored.error === 'no-secret') {
          return auth(fill(UI_TEXT.providerKeyNeeded, { provider: provider.entry.id }))
        }
        if (stored.error === 'origin-mismatch') {
          return auth(
            fill(UI_TEXT.providerOriginMismatch, {
              provider: provider.entry.id,
              stored: stored.record?.origin ?? '?',
              current: provider.origin,
            }),
          )
        }
        return auth(fill(UI_TEXT.providerSecretUnreadable, { provider: provider.entry.id }))
      }
      key = stored.key
      memory = memorySecretStoreFor({
        [account]: formatStoredProviderSecret(stored.record, key),
      })
    }
  }
  const answers = await input.resolveHost(new URL(provider.origin).hostname)
  if (!isEndpointBindingCurrent(provider, answers)) {
    return usage(fill(UI_TEXT.providerEndpointRefused, { reason: UI_TEXT.providerProbeRebinding }))
  }
  const dispatch: { onRequestStarted?: () => void } = {}
  return {
    ok: true,
    run: {
      dispatch,
      resolveHost: input.resolveHost,
      provider,
      modelRef,
      fetch: pinProviderFetch(provider, allowedProviderPaths(provider), input.resolveHost, () =>
        dispatch.onRequestStarted?.(),
      ),
      secrets: memory ?? input.secrets,
      literals: key === undefined ? [] : [key],
      memory,
    },
    notice,
  }
}
