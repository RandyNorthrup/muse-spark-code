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

import type { CredentialRecord } from '../../core/providers/credentialRecord'
const { isCredentialBound } = credentialRecord
const { checkEndpointUrl, originOf, verifyRequestAnswers } = endpointPolicy
const { isProviderId, parseModelRef } = modelRef
import type { KeyShape, ProviderPreset } from '../../core/providers/presets'
const { azureOrigin, presetById } = presets
import type {
  ProviderEntry,
  ProviderFormat,
  ProvidersFile,
} from '../../core/providers/providersFile'
const { readProvidersFile } = providersFile
import {
  credentialRecord,
  endpointPolicy,
  modelRef,
  presets,
  providersFile,
} from '../../host/backend/providersEntry'
import type { SecretStore } from '../../host/auth/credentialStore'
import { CREDENTIAL_RECORD_VERSION, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  formatStoredProviderSecret,
  parseStoredProviderSecret,
  providerSecretAccount,
} from '../keyStore'
import { memorySecretStoreFor, type MemorySecretStore } from './keyInput'
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
 * The codec's request path per preset, from the 2026-10-04 captures unless
 * said. Local servers and the custom preset follow the research's official
 * references (research §1); Azure has no capture yet and no path here.
 */
function requestPathFor(preset: ProviderPreset): ProviderRequestPath | undefined {
  switch (preset.id) {
    case 'openai':
    case 'xai': {
      return { rule: { kind: 'exact', path: '/v1/responses' }, source: 'capture' }
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
  if (provider.preset.id !== 'custom') return provider.preset.modelsList.path
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
 * Resolve a provider id against the runner's own user file only. `presets`
 * is the built-in table (lane P's `presetById`); `resolveHost` answers DNS
 * for the address check. A repository file is never read here: callers pass
 * the user file's content, so a workspace's `providers.json` cannot aim a
 * run elsewhere.
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
  } catch {
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
 * The provider's key from the secret store: parsed, present, and bound to
 * the resolved origin. An edited file aiming elsewhere refuses here and the
 * caller asks for the credential again, naming both origins.
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
  } catch {
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

/**
 * The origin pin in front of `fetch`: only `https:` (or `http:` to the
 * pinned loopback origin) on the resolved origin, with no userinfo, query
 * (except the codec's own) or fragment, and only an allowlisted path. A
 * refusal throws before anything is sent.
 */
export function pinProviderFetch(
  fetch: typeof globalThis.fetch,
  provider: ResolvedProvider,
  rules: readonly ProviderPathRule[],
  resolveHost: (hostname: string) => Promise<readonly string[]>,
): typeof globalThis.fetch {
  const pinned = originOf(provider.origin)
  const isLoopback = provider.network === 'local'
  // `originOf` refuses any URL with a query or fragment, but the codec's
  // own query (list filters, Gemini's `alt=sse`) is ruled per path below;
  // compare origins with the query and fragment set aside first.
  const bareOriginOf = (url: URL): string | undefined => {
    const bare = new URL(url.href)
    bare.search = ''
    bare.hash = ''
    return originOf(bare.href)
  }
  return async (url, init) => {
    if (typeof url !== 'string') {
      throw new TypeError('refused')
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('refused')
    }
    if (parsed.username !== '' || parsed.password !== '') {
      throw new Error('refused')
    }
    const origin = bareOriginOf(parsed)
    if (origin === undefined || origin !== pinned) {
      throw new Error('refused')
    }
    if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) {
      throw new Error('refused')
    }
    if (parsed.hash !== '') {
      throw new Error('refused')
    }
    const requestRule = provider.request?.rule
    if (requestRule !== undefined && isPathAllowed(requestRule, parsed)) {
      // The family rule already bounds the query to the codec's own; an
      // exact request path carries none.
      if (requestRule.kind === 'exact' && parsed.search !== '') {
        throw new Error('refused')
      }
    } else if (rules.every((rule) => !(rule.kind === 'exact' && rule.path === parsed.pathname))) {
      // List and key-test paths may carry the provider's own query
      // (`limit`, `zdr`, `supported_parameters`); nothing else passes.
      throw new Error('refused')
    }
    const answers = await resolveHost(parsed.hostname)
    if (!isEndpointBindingCurrent(provider, answers)) throw new Error('rebinding')
    return await fetch(url, { ...init, redirect: 'error' })
  }
}

/** Everything a provider run needs, resolved and checked before it starts. */
export interface AssembledProviderRun {
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
}

export interface ProviderRunInput {
  /** The runner's own user file (never a repository file). */
  readonly filePath: string
  readonly readFile: (path: string) => Promise<string>
  readonly secrets: SecretStore
  readonly resolveHost: (hostname: string) => Promise<readonly string[]>
  /** A provider key from standard input, checked against the preset's shape. */
  readonly readKey: (
    shape: KeyShape,
  ) => Promise<
    { readonly ok: true; readonly key: string } | { readonly ok: false; readonly reason: string }
  >
  readonly providerId: string
  /** The qualified model ref (`parseExec` qualifies a bare id). */
  readonly model: string | undefined
  readonly keyFromStdin: boolean
  readonly baseFetch: typeof fetch
}

export type ProviderAssemblyFailure =
  | { readonly kind: 'usage'; readonly reason: string }
  | { readonly kind: 'auth'; readonly reason: string }

/**
 * Resolve a provider run from the runner's own user file: the provider, a
 * model naming it, a bound credential (standard input or the store), a
 * re-checked endpoint, and the pinned fetch. Usage failures are the
 * caller's mistake; auth failures need a key. The turn itself is lane T/I's
 * `ProviderExecRunner` seam (`runExec.ts`); this function never sends one.
 */
export async function assembleProviderRun(
  input: ProviderRunInput,
): Promise<
  | { readonly ok: true; readonly run: AssembledProviderRun }
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
        : fill(UI_TEXT.providerTestFailed, { reason: read.detail }),
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
  const modelRef = input.model ?? model
  if (modelRef === undefined) {
    // A default that names another provider is the file's choice, not this
    // run's model; only a run with no model anywhere needs --model spelled out.
    return usage(
      fallback === undefined ? UI_TEXT.execProviderModelRequired : UI_TEXT.execUnknownModel,
    )
  }
  const parsedRef = parseModelRef(modelRef)
  if (parsedRef?.providerId !== provider.entry.id) {
    return usage(UI_TEXT.execUnknownModel)
  }
  let key: string | undefined
  let memory: MemorySecretStore | undefined
  if (provider.preset.auth === 'apiKey') {
    const account = providerSecretAccount(provider.entry.id)
    if (account === undefined) {
      return usage(fill(UI_TEXT.providerUnknown, { provider: provider.entry.id }))
    }
    if (input.keyFromStdin) {
      const typed = await input.readKey(provider.preset.keyShape)
      if (!typed.ok) {
        if (typed.reason === 'tty') {
          return auth(UI_TEXT.execKeyStdinTerminal)
        }
        if (typed.reason === 'tooLong') {
          return auth(UI_TEXT.execKeyTooLong)
        }
        return auth(
          fill(UI_TEXT.providerKeyShape, {
            provider: provider.preset.label,
            hint: provider.preset.keyHint,
          }),
        )
      }
      key = typed.key
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
  return {
    ok: true,
    run: {
      provider,
      modelRef,
      fetch: pinProviderFetch(
        input.baseFetch,
        provider,
        allowedProviderPaths(provider),
        input.resolveHost,
      ),
      secrets: memory ?? input.secrets,
      literals: key === undefined ? [] : [key],
      memory,
    },
  }
}
