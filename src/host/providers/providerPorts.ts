// Lane K's seams to the parallel M95 lanes (PLAN.md M95, lanes table).
// Lane P (`src/core/providers/**`) owns the providers file, the presets, the
// PKCE pair, the wizard state machine, the suggestion engine and the
// models-list parsers; lane T owns the shared transport the key tests and
// scans call through. Until those merge, every member below is an injected
// dependency: production code never fakes one, and the composition in
// `src/host/models/modelsPanelEntry.ts` takes each from its owning lane's
// real module (through `dist/providers.js`, PLAN.md D6). Tests hand in
// fixtures from `test/**`.
//
// Each interface names the plan section that defines its contract, so lane
// P's merge reconciles names instead of behaviour.

import type { CustomCompat } from '../../core/providers/providersFile'

/** How a provider proves its calls (D74: `apiKey`, `none`, `subscription`). */
export type ProviderAuthMode = 'apiKey' | 'none'

/**
 * Lane K's view of one configured provider: the non-secret entry D74 keeps
 * in `providers.json` (ids, presets, addresses, chosen models, the default
 * model). Lane P's `providersFile.ts` owns the schema and must satisfy this.
 */
export interface ProviderEntry {
  readonly id: string
  readonly preset: string
  readonly address: string
  readonly auth: ProviderAuthMode
  readonly models: readonly string[]
  readonly format?: 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama' | undefined
  readonly compat?: CustomCompat | undefined
  readonly modelLimits?:
    | Readonly<Record<string, { readonly contextTokens: number; readonly outputTokens: number }>>
    | undefined
  readonly pinned?: readonly string[] | undefined
  readonly prices?:
    | Readonly<
        Record<
          string,
          {
            readonly input: number
            readonly output: number
            readonly cachedInput?: number | undefined
            readonly cacheWrite?: number | undefined
            readonly cacheWrite1h?: number | undefined
            readonly request?: number | undefined
            readonly image?: number | undefined
          }
        >
      >
    | undefined
  readonly routing?:
    | {
        readonly privacy: 'zdr' | 'no-training' | 'any'
        readonly order?: readonly string[] | undefined
        readonly allowFallbacks?: boolean | undefined
      }
    | undefined
  readonly numCtx?: Readonly<Record<string, number>> | undefined
  /** A private-network address the user confirmed once (D74). */
  readonly privateNetwork?: boolean | undefined
}

/**
 * The configured providers, without their credentials (D74: written only by
 * the panel, the quick pick and `muse-spark-code-acp providers`). Lane P's
 * `providersFile.ts` implements this with its zod schema and atomic write.
 */
export interface ProvidersStore {
  /** Every configured provider, in the file's order. */
  list(): Promise<readonly ProviderEntry[]>
  /** Adds a provider saved by the wizard; rejects a duplicate id. */
  add(entry: ProviderEntry): Promise<void>
  /** Removes a provider; the removed entry, or undefined when absent. */
  remove(id: string): Promise<ProviderEntry | undefined>
  /** Puts back an entry `remove` took (Undo). */
  restore(entry: ProviderEntry): Promise<void>
  /** Replaces the whole file (a confirmed import); the file's previous entries. */
  replaceAll(entries: readonly ProviderEntry[]): Promise<readonly ProviderEntry[]>
  /** Names the composer's default model (`providers.json`'s `defaultModel`). */
  setDefaultModel(ref: string | undefined): Promise<void>
  /** The default model reference, or undefined when none is set. */
  defaultModel(): Promise<string | undefined>
}

/** The dropdown's filter chips (D74). */
export type PresetKind = 'cloud' | 'local' | 'subscription' | 'aggregator'

/** One loopback address Scan this computer probes (D74: preset data). */
export interface LocalProbeTarget {
  readonly host: string
  readonly port: number
  readonly path: string
}

/**
 * What the panel prefills from a preset (D74): address, wire format, auth
 * mode, the key's shape as a hint, the docs and data-use links, the privacy
 * note, Get a key, the free key test, and the local probe targets.
 */
export interface PresetInfo {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kind: PresetKind
  /** The fixed origin, or '' when the user gives the address (Azure, custom, local). */
  readonly origin: string
  readonly format: string
  readonly auth: ProviderAuthMode
  /** The key's documented shape, shown in the password box (never validated here). */
  readonly keyHint: string
  /** The provider's key page (Get a key). */
  readonly keyPage: string
  /** The preset's live shape check (run as the key is typed). */
  isKeyShape(value: string): boolean
  /** Whether a free check exists, or a one-token request must be asked first. */
  readonly freeTest: 'modelsList' | 'oneToken' | 'none'
  /**
   * The account-connect choice (OpenRouter's "Connect {provider} account",
   * filled) offered beside pasting a key; undefined for key-only presets.
   */
  readonly connectLabel?: string | undefined
  /** Where Scan this computer looks for this preset; empty for non-local ones. */
  readonly localProbes: readonly LocalProbeTarget[]
  /** OpenRouter's privacy routing lives on its preset only; undefined elsewhere. */
  readonly privacyChoices?: readonly string[] | undefined
}

/** Lane P's `presets.ts`, by preset id. */
export interface PresetCatalog {
  get(id: string): PresetInfo | undefined
  has(id: string): boolean
  ids(): readonly string[]
}

/**
 * One scanned model row: what the Models table, badges, filters and
 * suggestions read. Prices stay behind `priceFingerprint` (lane P's price
 * card computes it): a changed fingerprint is a repriced model, and lane K
 * never prices.
 */
export interface ProviderModelRow {
  readonly id: string
  readonly label: string
  readonly toolCapable: boolean
  readonly vision: boolean
  readonly reasoning: boolean
  readonly context: number | undefined
  readonly priceFingerprint: string
  readonly isFree: boolean
  readonly isLocal: boolean
  readonly family?: string | undefined
  readonly inputPerMillion?: number | undefined
  readonly outputPerMillion?: number | undefined
  readonly cachedPerMillion?: number | undefined
  readonly recommended?: boolean | undefined
  readonly serverless?: boolean | undefined
}

/**
 * Lists a provider's models (lane P's models-list parser over lane T's
 * transport, from the captures). Lane K caches, diffs and reuses the rows.
 */
export interface ModelFetcher {
  fetchModels(
    entry: ProviderEntry,
    credential: string | undefined,
    signal?: AbortSignal,
  ): Promise<{
    readonly rows: readonly ProviderModelRow[]
  }>
}

/** The Test step's answer (D74: the free check, or the one-token cost asked first). */
export type KeyTestResult =
  | { readonly kind: 'ok'; readonly models: number }
  | { readonly kind: 'failed'; readonly detail: string }
  | { readonly kind: 'paid'; readonly cost: string }

/**
 * Tests a credential (lane P's key test over lane T's transport). With
 * `isPaidAllowed` false a provider without a free check answers `paid` and
 * sends nothing; with true it sends the one-token request the user confirmed.
 */
export interface KeyTester {
  test(entry: ProviderEntry, credential: string, isPaidAllowed: boolean): Promise<KeyTestResult>
}

/** The endpoint policy's answer for an address (lane P's `endpointPolicy.ts`). */
export type AddressCheck =
  | { readonly kind: 'ok' }
  | { readonly kind: 'private'; readonly address: string }
  | { readonly kind: 'refused'; readonly detail: string }

/** Lane P's `endpointPolicy.ts`: URL rules and the address classifier. */
export interface AddressPolicy {
  check(address: string): AddressCheck
}

/** PKCE S256 pair for an OAuth connect (lane P's `pkce.ts`). */
export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
}

/** Makes a PKCE S256 pair with a fresh `state` (lane P's `pkce.ts`). */
export interface PkceSource {
  create(): PkcePair
  /** A fresh unguessable `state` for the callback. */
  newState(): string
}

/**
 * Exchanges an OAuth code for a key (lane T's transport, from the capture).
 * The key is returned, never stored here: the caller binds it to its origin.
 */
export interface CodeExchanger {
  /**
   * Exchanges one code once. `redirectUri` repeats the callback the code
   * was authorized with ('' when none was: a remote window).
   */
  exchange(request: {
    readonly code: string
    readonly verifier: string
    readonly redirectUri: string
  }): Promise<string>
}

/**
 * What Account & usage shows for an OpenRouter key (`GET /api/v1/key`: D74,
 * `limit`, `limit_remaining` and `usage` with its daily, weekly and monthly
 * parts; research §1.8). Lane T parses the body from the capture; lane K
 * validates the numbers (finite, non-negative) before they are shown.
 */
export interface KeyUsageSnapshot {
  readonly usedToday: number
  readonly usedThisWeek: number
  readonly usedThisMonth: number
  readonly limit: number | undefined
  readonly remaining: number | undefined
}

/** Reads an OpenRouter key's usage and limit (lane T's transport, from the capture). */
export interface KeyUsageReader {
  read(credential: string): Promise<KeyUsageSnapshot>
}

/** One suggestion with its reason (lane P's `suggest.ts`). */
export interface ModelSuggestion {
  readonly value: string
  readonly reason: string
}

/** Lane P's local suggestion engine: values from local facts only, each with its reason. */
export interface SuggestionEngine {
  defaultModel(candidates: readonly ProviderModelRow[]): ModelSuggestion | undefined
  sessionBudget(modelPrices: readonly string[]): ModelSuggestion | undefined
}
