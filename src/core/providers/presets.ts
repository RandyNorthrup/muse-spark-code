// The provider presets (M95, PLAN.md D74): each provider the panel lists
// is a preset here — its format, fixed origin (or the fields the user
// gives), auth header, key page and key shape, the free key test, the
// models-list parser, and the format's quirks as data (the output-cap
// parameter, `parallel_tool_calls`, `tool_choice`, the reasoning field and
// replay rule, usage in the stream, the cached-token field, the empty-tools
// rule). **Custom server** and the local servers are presets too, with
// Zed's conservative defaults. OpenRouter's routing and attribution live
// here as well. A preset is listed by the panel only once its own wire
// capture is recorded (`wireCapture`, AGENTS.md rule 13); the captures are
// in `docs/certification/m95-captures.md`. Pure data plus pure helpers.

import { ZAI_KEY_PATTERN } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import type { ProviderFormat } from './providersFile'

/** The panel's filter chips (D74): Cloud, On this computer, Aggregator. */
export type PresetCategory = 'cloud' | 'local' | 'aggregator' | 'custom'

/** Where a preset's endpoint comes from. */
export type PresetOrigin =
  | { readonly kind: 'fixed'; readonly origin: string }
  | { readonly kind: 'azure-resource' }
  | { readonly kind: 'loopback'; readonly defaultPort: number }
  | { readonly kind: 'custom' }

/** The authorization header a preset sends (captured 2026-10-04). */
export type AuthHeader = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'api-key'

/** What a pasted key looks like, checked as it is typed. */
export type KeyShape =
  | { readonly kind: 'prefix'; readonly prefix: string; readonly minLength: number }
  | { readonly kind: 'zai' }
  | { readonly kind: 'any'; readonly minLength: number }

/**
 * Whether a pasted key is shaped like the preset's. A shape check never
 * proves a key works: the free key test does. Unknown shapes (`any`) accept
 * any non-blank key of the minimum length.
 */
export function isKeyShape(shape: KeyShape, key: string): boolean {
  const trimmed = key.trim()
  if (trimmed === '') {
    return false
  }
  switch (shape.kind) {
    case 'prefix': {
      return trimmed.startsWith(shape.prefix) && trimmed.length >= shape.minLength
    }
    case 'any': {
      return trimmed.length >= shape.minLength
    }
    case 'zai': {
      return ZAI_KEY_PATTERN.test(trimmed)
    }
  }
}

/** The free check that proves a key works (nothing billed). */
export type KeyTest =
  | { readonly kind: 'models-list' }
  | { readonly kind: 'provider-key'; readonly path: string; readonly origin?: string }
  | { readonly kind: 'paid-token' }

/** Where a scan reads models, windows and prices. */
export type ListPriceSource = 'list' | 'catalogue' | 'user' | 'none-local'

export interface ModelsListSpec {
  readonly path: string
  /** The field carrying the context window where the list gives one. */
  readonly windowField?: string | undefined
  /** Where prices come from for this preset (D74's source order). */
  readonly priceSource: ListPriceSource
}

/** One wire format's quirks as data (D74; the codecs read these). */
export interface FormatQuirks {
  /** The output-cap parameter the codec sends. */
  readonly outputCapParam:
    'max_output_tokens' | 'max_completion_tokens' | 'max_tokens' | 'maxOutputTokens' | 'num_predict'
  /** Which `tool_choice` the codec sends. */
  readonly toolChoice: 'auto' | 'omit' | 'string-only'
  /** Whether the codec sends `parallel_tool_calls` where it matters. */
  readonly sendsParallelToolCalls: boolean
  /** The field reasoning arrives in and replays under. */
  readonly reasoningField:
    | 'encrypted'
    | 'reasoning'
    | 'reasoning_content'
    | 'reasoning_details'
    | 'thoughtSignature'
    | 'thinking'
    | 'content-list'
    | 'none'
  /**
   * Reasoning goes back only to its own provider, in its own form, to the
   * same model; any other provider's turn drops it.
   */
  readonly reasoningReplay: 'same-model' | 'none'
  /** Usage may share the finish chunk (read deltas and usage from every chunk). */
  readonly usageOnFinishChunk: boolean
  /** The stream must ask for usage (`stream_options.include_usage` et al). */
  readonly usageNeedsOptIn: boolean
  /** The usage fields carrying cached tokens where the provider reports them. */
  readonly cachedUsageFields: readonly string[]
  /** An empty tool list is never sent (vLLM refuses it; OpenRouter wants tools). */
  readonly neverSendEmptyTools: true
  /** Compaction keeps the turn's tools with `tool_choice: auto`. */
  readonly keepToolsWithHistory: true
}

/** The five formats' defaults; presets override per provider. */
export const FORMAT_QUIRKS: Record<ProviderFormat, FormatQuirks> = {
  responses: {
    outputCapParam: 'max_output_tokens',
    toolChoice: 'auto',
    sendsParallelToolCalls: true,
    reasoningField: 'encrypted',
    reasoningReplay: 'same-model',
    usageOnFinishChunk: false,
    usageNeedsOptIn: false,
    cachedUsageFields: [
      'input_tokens_details.cached_tokens',
      'input_tokens_details.cache_write_tokens',
    ],
    neverSendEmptyTools: true,
    keepToolsWithHistory: true,
  },
  chat: {
    outputCapParam: 'max_completion_tokens',
    toolChoice: 'auto',
    sendsParallelToolCalls: true,
    reasoningField: 'reasoning',
    reasoningReplay: 'same-model',
    usageOnFinishChunk: true,
    usageNeedsOptIn: true,
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
    neverSendEmptyTools: true,
    keepToolsWithHistory: true,
  },
  anthropic: {
    outputCapParam: 'max_tokens',
    toolChoice: 'auto',
    sendsParallelToolCalls: false,
    reasoningField: 'thinking',
    reasoningReplay: 'same-model',
    usageOnFinishChunk: false,
    usageNeedsOptIn: false,
    cachedUsageFields: ['cache_read_input_tokens', 'cache_creation_input_tokens'],
    neverSendEmptyTools: true,
    keepToolsWithHistory: true,
  },
  gemini: {
    outputCapParam: 'maxOutputTokens',
    toolChoice: 'auto',
    sendsParallelToolCalls: false,
    reasoningField: 'thoughtSignature',
    reasoningReplay: 'same-model',
    usageOnFinishChunk: false,
    usageNeedsOptIn: false,
    cachedUsageFields: ['cachedContentTokenCount'],
    neverSendEmptyTools: true,
    keepToolsWithHistory: true,
  },
  ollama: {
    outputCapParam: 'num_predict',
    toolChoice: 'omit',
    sendsParallelToolCalls: false,
    reasoningField: 'thinking',
    reasoningReplay: 'same-model',
    usageOnFinishChunk: false,
    usageNeedsOptIn: false,
    cachedUsageFields: ['prompt_eval_cached_count'],
    neverSendEmptyTools: true,
    keepToolsWithHistory: true,
  },
}

export interface ProviderPreset {
  readonly id: string
  /** The provider's own label, always shown beside its models. */
  readonly label: string
  /** One line for the searchable provider dropdown. */
  readonly description: string
  readonly category: PresetCategory
  readonly format: ProviderFormat
  readonly origin: PresetOrigin
  readonly auth: 'apiKey' | 'none'
  /** A local server whose key, when set, rides a Bearer [REDACTED] */
  readonly optionalKey?: boolean | undefined
  readonly authHeader?: AuthHeader | undefined
  /** The provider's key page (**Get a key**); absent where none is known. */
  readonly keyPage?: string | undefined
  readonly docsUrl?: string | undefined
  readonly keyShape: KeyShape
  /** The shape as a hint beside the key field (never a key's characters). */
  readonly keyHint: string
  readonly keyTest: KeyTest
  readonly modelsList: ModelsListSpec
  readonly quirks: Partial<FormatQuirks>
  /** The preset's own wire capture is recorded (rule 13). */
  readonly wireCapture: boolean
}

/** A preset's effective quirks: its format's defaults plus its overrides. */
export function quirksOf(preset: ProviderPreset): FormatQuirks {
  return { ...FORMAT_QUIRKS[preset.format], ...preset.quirks }
}

// The presets. Origins, headers, key shapes, key tests and quirks are from
// the research (`docs/certification/m95-research.md`) and the live captures
// (`docs/certification/m95-captures.md`, 2026-10-04). A preset without its
// own capture (`wireCapture: false`) stays out of the panel (rule 13).

const OPENAI_PRESET: ProviderPreset = {
  id: 'openai',
  label: 'OpenAI',
  get description() {
    return UI_TEXT.providerText.descriptions.openai
  },
  category: 'cloud',
  format: 'responses',
  origin: { kind: 'fixed', origin: 'https://api.openai.com' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://platform.openai.com/api-keys',
  docsUrl: 'https://platform.openai.com/docs',
  keyShape: { kind: 'prefix', prefix: 'sk-', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'sk-', site: 'platform.openai.com' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', priceSource: 'catalogue' },
  quirks: {},
  wireCapture: true,
}

const AZURE_PRESET: ProviderPreset = {
  id: 'azure',
  label: 'Azure OpenAI',
  get description() {
    return UI_TEXT.providerText.descriptions.azure
  },
  category: 'cloud',
  format: 'responses',
  origin: { kind: 'azure-resource' },
  auth: 'apiKey',
  authHeader: 'api-key',
  keyShape: { kind: 'any', minLength: 16 },
  get keyHint() {
    return UI_TEXT.providerText.hints.azure
  },
  keyTest: { kind: 'paid-token' },
  modelsList: { path: '/openai/v1/models', priceSource: 'catalogue' },
  quirks: {},
  wireCapture: false,
}

const XAI_PRESET: ProviderPreset = {
  id: 'xai',
  label: 'xAI',
  get description() {
    return UI_TEXT.providerText.descriptions.xai
  },
  category: 'cloud',
  format: 'responses',
  origin: { kind: 'fixed', origin: 'https://api.x.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://console.x.ai',
  keyShape: { kind: 'prefix', prefix: 'xai-', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'xai-', site: 'console.x.ai' })
  },
  keyTest: { kind: 'models-list' },
  // Integer prices in 1e-10 USD per token, with the long-context threshold.
  modelsList: { path: '/v1/models', windowField: 'context_length', priceSource: 'list' },
  quirks: {
    reasoningField: 'encrypted',
    cachedUsageFields: ['input_tokens_details.cached_tokens'],
  },
  wireCapture: true,
}

const ANTHROPIC_PRESET: ProviderPreset = {
  id: 'anthropic',
  label: 'Anthropic',
  get description() {
    return UI_TEXT.providerText.descriptions.anthropic
  },
  category: 'cloud',
  format: 'anthropic',
  origin: { kind: 'fixed', origin: 'https://api.anthropic.com' },
  auth: 'apiKey',
  // Captured: the documented `Authorization: Bearer` is accepted.
  authHeader: 'bearer',
  keyPage: 'https://console.anthropic.com/settings/keys',
  docsUrl: 'https://docs.anthropic.com',
  keyShape: { kind: 'prefix', prefix: 'sk-ant-', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, {
      prefix: 'sk-ant-',
      site: 'console.anthropic.com',
    })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', windowField: 'max_input_tokens', priceSource: 'catalogue' },
  quirks: {},
  wireCapture: true,
}

const GEMINI_PRESET: ProviderPreset = {
  id: 'gemini',
  label: 'Google Gemini',
  get description() {
    return UI_TEXT.providerText.descriptions.gemini
  },
  category: 'cloud',
  format: 'gemini',
  origin: { kind: 'fixed', origin: 'https://generativelanguage.googleapis.com' },
  auth: 'apiKey',
  authHeader: 'x-goog-api-key',
  keyPage: 'https://aistudio.google.com/apikey',
  docsUrl: 'https://ai.google.dev/gemini-api/docs',
  keyShape: { kind: 'prefix', prefix: 'AIza', minLength: 30 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'AIza', site: 'AI Studio' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1beta/models', windowField: 'inputTokenLimit', priceSource: 'catalogue' },
  quirks: {},
  wireCapture: true,
}

const OPENROUTER_PRESET: ProviderPreset = {
  id: 'openrouter',
  label: 'OpenRouter',
  get description() {
    return UI_TEXT.providerText.descriptions.openrouter
  },
  category: 'aggregator',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://openrouter.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://openrouter.ai/keys',
  docsUrl: 'https://openrouter.ai/docs',
  keyShape: { kind: 'prefix', prefix: 'sk-or-', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.router, { prefix: 'sk-or-', site: 'openrouter.ai' })
  },
  // `/models` is public, so `/key` is the test: free and spends no credits.
  keyTest: { kind: 'provider-key', path: '/api/v1/key' },
  modelsList: { path: '/api/v1/models', windowField: 'context_length', priceSource: 'list' },
  quirks: {
    // "The `tools` parameter must be included in every request."
    reasoningField: 'reasoning_details',
    cachedUsageFields: [
      'prompt_tokens_details.cached_tokens',
      'prompt_tokens_details.cache_write_tokens',
    ],
  },
  wireCapture: true,
}

const GROQ_PRESET: ProviderPreset = {
  id: 'groq',
  label: 'Groq',
  get description() {
    return UI_TEXT.providerText.descriptions.groq
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.groq.com' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://console.groq.com/keys',
  keyShape: { kind: 'prefix', prefix: 'gsk_', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'gsk_', site: 'console.groq.com' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/openai/v1/models', windowField: 'context_window', priceSource: 'list' },
  quirks: {
    outputCapParam: 'max_completion_tokens',
    cachedUsageFields: [],
  },
  wireCapture: true,
}

const DEEPSEEK_PRESET: ProviderPreset = {
  id: 'deepseek',
  label: 'DeepSeek',
  get description() {
    return UI_TEXT.providerText.descriptions.deepseek
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.deepseek.com' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://platform.deepseek.com/api_keys',
  keyShape: { kind: 'prefix', prefix: 'sk-', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'sk-', site: 'platform.deepseek.com' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/models', windowField: 'context_window', priceSource: 'catalogue' },
  quirks: {
    reasoningField: 'reasoning_content',
    cachedUsageFields: ['prompt_tokens_details.cached_tokens', 'prompt_cache_hit_tokens'],
  },
  wireCapture: true,
}

const MISTRAL_PRESET: ProviderPreset = {
  id: 'mistral',
  label: 'Mistral',
  get description() {
    return UI_TEXT.providerText.descriptions.mistral
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.mistral.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://console.mistral.ai/api-keys',
  keyShape: { kind: 'any', minLength: 16 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.site, { site: 'console.mistral.ai' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', windowField: 'max_context_length', priceSource: 'catalogue' },
  quirks: {
    reasoningField: 'content-list',
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
  },
  wireCapture: true,
}

const TOGETHER_PRESET: ProviderPreset = {
  id: 'together',
  label: 'Together',
  get description() {
    return UI_TEXT.providerText.descriptions.together
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.together.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://api.together.ai/settings/api-keys',
  keyShape: { kind: 'any', minLength: 16 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.site, { site: 'api.together.ai' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', windowField: 'context_length', priceSource: 'list' },
  quirks: {
    outputCapParam: 'max_tokens',
    sendsParallelToolCalls: false,
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
  },
  wireCapture: true,
}

const FIREWORKS_PRESET: ProviderPreset = {
  id: 'fireworks',
  label: 'Fireworks',
  get description() {
    return UI_TEXT.providerText.descriptions.fireworks
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.fireworks.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyShape: { kind: 'prefix', prefix: 'fw_', minLength: 20 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'fw_', site: 'fireworks.ai' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: {
    path: '/inference/v1/models',
    windowField: 'context_length',
    priceSource: 'catalogue',
  },
  quirks: {
    outputCapParam: 'max_tokens',
    reasoningField: 'reasoning_content',
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
  },
  wireCapture: true,
}

const HUGGINGFACE_PRESET: ProviderPreset = {
  id: 'huggingface',
  label: 'Hugging Face',
  get description() {
    return UI_TEXT.providerText.descriptions.huggingface
  },
  category: 'aggregator',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://router.huggingface.co' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyPage: 'https://huggingface.co/settings/tokens',
  keyShape: { kind: 'prefix', prefix: 'hf_', minLength: 10 },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.prefix, { prefix: 'hf_', site: 'huggingface.co' })
  },
  // `whoami-v2` on huggingface.co proves the token; the router has no key test.
  keyTest: { kind: 'provider-key', path: '/api/whoami-v2', origin: 'https://huggingface.co' },
  // Prices and windows are per upstream; reservations take the highest.
  modelsList: { path: '/v1/models', windowField: 'context_length', priceSource: 'list' },
  quirks: {
    cachedUsageFields: [],
  },
  wireCapture: true,
}

const ZAI_PRESET: ProviderPreset = {
  id: 'zai',
  label: 'Z.ai',
  get description() {
    return UI_TEXT.providerText.descriptions.zai
  },
  category: 'cloud',
  format: 'chat',
  origin: { kind: 'fixed', origin: 'https://api.z.ai' },
  auth: 'apiKey',
  authHeader: 'bearer',
  // Captured shape: `<32 hex>.<16>`.
  keyShape: { kind: 'zai' },
  get keyHint() {
    return fill(UI_TEXT.providerText.hints.site, { site: 'Z.ai' })
  },
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/api/paas/v4/models', priceSource: 'catalogue' },
  quirks: {
    reasoningField: 'reasoning_content',
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
  },
  wireCapture: true,
}

const OLLAMA_PRESET: ProviderPreset = {
  id: 'ollama',
  label: 'Ollama',
  get description() {
    return UI_TEXT.providerText.descriptions.ollama
  },
  category: 'local',
  format: 'ollama',
  origin: { kind: 'loopback', defaultPort: 11_434 },
  auth: 'none',
  keyShape: { kind: 'any', minLength: 1 },
  keyHint: '',
  // `/api/tags` is free; `/api/show` gives capabilities per model.
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/api/tags', priceSource: 'none-local' },
  quirks: {},
  wireCapture: false,
}

const LMSTUDIO_PRESET: ProviderPreset = {
  id: 'lmstudio',
  label: 'LM Studio',
  get description() {
    return UI_TEXT.providerText.descriptions.lmstudio
  },
  category: 'local',
  format: 'chat',
  origin: { kind: 'loopback', defaultPort: 1234 },
  auth: 'none',
  optionalKey: true,
  keyShape: { kind: 'any', minLength: 1 },
  keyHint: '',
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', windowField: 'max_context_length', priceSource: 'none-local' },
  quirks: {
    outputCapParam: 'max_tokens',
    sendsParallelToolCalls: false,
    reasoningField: 'reasoning',
    cachedUsageFields: [],
  },
  wireCapture: false,
}

const VLLM_PRESET: ProviderPreset = {
  id: 'vllm',
  label: 'vLLM',
  get description() {
    return UI_TEXT.providerText.descriptions.vllm
  },
  category: 'local',
  format: 'chat',
  origin: { kind: 'loopback', defaultPort: 8000 },
  auth: 'none',
  optionalKey: true,
  keyShape: { kind: 'any', minLength: 1 },
  keyHint: '',
  keyTest: { kind: 'models-list' },
  modelsList: { path: '/v1/models', windowField: 'max_model_len', priceSource: 'none-local' },
  quirks: {
    outputCapParam: 'max_completion_tokens',
    sendsParallelToolCalls: false,
    reasoningField: 'reasoning',
    cachedUsageFields: ['created_cache_tokens'],
  },
  wireCapture: false,
}

const LLAMACPP_PRESET: ProviderPreset = {
  id: 'llamacpp',
  label: 'llama.cpp',
  get description() {
    return UI_TEXT.providerText.descriptions.llamacpp
  },
  category: 'local',
  format: 'chat',
  origin: { kind: 'loopback', defaultPort: 8080 },
  auth: 'none',
  keyShape: { kind: 'any', minLength: 1 },
  keyHint: '',
  keyTest: { kind: 'models-list' },
  // `/props` gives `n_ctx`; `/v1/models` gives `meta.n_ctx_train`.
  modelsList: { path: '/v1/models', windowField: 'n_ctx', priceSource: 'none-local' },
  quirks: {
    outputCapParam: 'max_tokens',
    toolChoice: 'string-only',
    sendsParallelToolCalls: false,
    reasoningField: 'reasoning_content',
    cachedUsageFields: ['prompt_tokens_details.cached_tokens'],
  },
  wireCapture: false,
}

const CUSTOM_PRESET: ProviderPreset = {
  id: 'custom',
  get label() {
    return UI_TEXT.providerText.labels.custom
  },
  get description() {
    return UI_TEXT.providerText.descriptions.custom
  },
  category: 'custom',
  format: 'chat',
  origin: { kind: 'custom' },
  auth: 'apiKey',
  authHeader: 'bearer',
  keyShape: { kind: 'any', minLength: 1 },
  get keyHint() {
    return UI_TEXT.providerText.hints.custom
  },
  keyTest: { kind: 'models-list' },
  // The window is required for an unknown model (Zed's rule); prices are
  // the user's or the model stays unpriced, never assumed free.
  modelsList: { path: '/v1/models', priceSource: 'user' },
  quirks: {},
  wireCapture: false,
}

/** Every preset, in panel order: cloud, aggregators, local, custom. */
export const PRESETS: readonly ProviderPreset[] = [
  OPENAI_PRESET,
  AZURE_PRESET,
  XAI_PRESET,
  ANTHROPIC_PRESET,
  GEMINI_PRESET,
  OPENROUTER_PRESET,
  GROQ_PRESET,
  DEEPSEEK_PRESET,
  MISTRAL_PRESET,
  TOGETHER_PRESET,
  FIREWORKS_PRESET,
  HUGGINGFACE_PRESET,
  ZAI_PRESET,
  OLLAMA_PRESET,
  LMSTUDIO_PRESET,
  VLLM_PRESET,
  LLAMACPP_PRESET,
  CUSTOM_PRESET,
]

/** The preset with an id, or undefined. */
export function presetById(id: string): ProviderPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** The presets the panel lists today: captured wires only (rule 13). */
export function listedPresets(): ProviderPreset[] {
  return PRESETS.filter((preset) => preset.wireCapture)
}

/** The presets of one filter chip. */
export function presetsByCategory(category: PresetCategory): ProviderPreset[] {
  return PRESETS.filter((preset) => preset.category === category)
}

/** Whether the address is the user's to give (Azure's resource, a loopback port, a custom server). */
export function isUserSuppliedOrigin(preset: ProviderPreset): boolean {
  return preset.origin.kind !== 'fixed'
}

// Azure OpenAI (v1 API): `https://{resource}.openai.azure.com/openai/v1/`
// (or `{resource}.services.ai.azure.com`). The wizard asks for the
// resource, the deployment and the model family behind it: names are the
// user's, so caching and reasoning gates cannot be read from them.
const AZURE_RESOURCE_PATTERN = /^[a-z0-9-]{3,24}$/
const AZURE_ORIGIN_SUFFIX = '.openai.azure.com'
const AZURE_API_PATH = '/openai/v1'

/** The origin for an Azure resource name, or undefined for a bad name. */
export function azureOrigin(resource: string): string | undefined {
  const name = resource.trim().toLowerCase()
  return AZURE_RESOURCE_PATTERN.test(name)
    ? `https://${name}${AZURE_ORIGIN_SUFFIX}${AZURE_API_PATH}`
    : undefined
}

// --- OpenRouter as a first-class provider (D74) ---

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
export const OPENROUTER_TOKEN_URL = 'https://openrouter.ai/api/v1/auth/keys'
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys'

/** The key's own page, deep-linked by the key's SHA-256 (spend limit and revocation live there). */
export function openRouterKeyPage(keyHashHex: string): string {
  return `${OPENROUTER_KEYS_URL}/${keyHashHex}`
}

/** The attribution on every OpenRouter request: the public name and repository, nothing about the user. */
export const OPENROUTER_ATTRIBUTION = {
  refererHeader: 'HTTP-Referer',
  referer: 'https://github.com/RandyNorthrup/muse-spark-code',
  titleHeader: 'X-OpenRouter-Title',
  title: 'Muse Spark Code (Unofficial)',
  categoriesHeader: 'X-OpenRouter-Categories',
  categories: 'ide-extension',
} as const

/** The panel's privacy choice: **No data retention** is the default. */
export type OpenRouterPrivacy = 'zdr' | 'no-training' | 'any'

export interface OpenRouterPrivacyChoice {
  readonly id: OpenRouterPrivacy
  /** The routing object sent on every request (fixed per provider). */
  readonly request: {
    readonly provider?: { readonly zdr?: true; readonly data_collection?: 'deny' }
  }
  /** One plain sentence saying what the choice means. */
  readonly blurb: string
}

export const OPENROUTER_PRIVACY_CHOICES: readonly OpenRouterPrivacyChoice[] = [
  {
    id: 'zdr',
    request: { provider: { zdr: true } },
    get blurb() {
      return UI_TEXT.providerText.privacy.zdr
    },
  },
  {
    id: 'no-training',
    request: { provider: { data_collection: 'deny' } },
    get blurb() {
      return UI_TEXT.providerText.privacy['no-training']
    },
  },
  {
    id: 'any',
    request: {},
    get blurb() {
      return UI_TEXT.providerText.privacy.any
    },
  },
]

/** The routing object for a privacy choice, with an optional provider order and fallback. */
export function openRouterRoutingRequest(
  privacy: OpenRouterPrivacy,
  order?: readonly string[],
  isFallbackAllowed?: boolean,
): Record<string, unknown> {
  const fallback = OPENROUTER_PRIVACY_CHOICES.find((candidate) => candidate.id === 'zdr')
  const choice =
    OPENROUTER_PRIVACY_CHOICES.find((candidate) => candidate.id === privacy) ?? fallback
  if (choice === undefined) {
    return {}
  }
  const ordered = order === undefined || order.length === 0 ? {} : { order: [...order] }
  const fallbacked = isFallbackAllowed === undefined ? {} : { allow_fallbacks: isFallbackAllowed }
  const provider = { ...choice.request.provider, ...ordered, ...fallbacked }
  return Object.keys(provider).length === 0 ? {} : { provider }
}

/**
 * The browser URL **Connect OpenRouter account** opens: `callback_url`
 * (a loopback address on any port, or absent for the paste flow),
 * `code_challenge` (S256), `code_challenge_method` and `state`.
 */
export function buildOpenRouterAuthUrl(options: {
  readonly challenge: string
  readonly state: string
  readonly callbackUrl?: string
  readonly keyLabel?: string
}): string {
  const params = new URLSearchParams({
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state,
  })
  if (options.callbackUrl !== undefined) {
    params.set('callback_url', options.callbackUrl)
  }
  if (options.keyLabel !== undefined && options.keyLabel !== '') {
    params.set('key_label', options.keyLabel)
  }
  return `${OPENROUTER_AUTH_URL}?${params.toString()}`
}

/** The single-use code exchange: `POST` this JSON body to the token URL. */
export function openRouterTokenRequestBody(options: {
  readonly code: string
  readonly verifier: string
}): {
  readonly url: string
  readonly method: 'POST'
  readonly body: {
    readonly code: string
    readonly code_verifier: string
    readonly code_challenge_method: 'S256'
  }
} {
  return {
    url: OPENROUTER_TOKEN_URL,
    method: 'POST',
    body: {
      code: options.code,
      code_verifier: options.verifier,
      code_challenge_method: 'S256',
    },
  }
}
