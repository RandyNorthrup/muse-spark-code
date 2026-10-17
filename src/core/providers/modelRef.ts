// A BYO model reference (M95, PLAN.md D74): `<providerId>/<modelId>`
// (`anthropic/claude-sonnet-5-5`, `openrouter/deepseek/deepseek-v4-pro`,
// `ollama/qwen3:8b`), the convention OpenCode, LiteLLM and Aider use.
// Meta's models stay bare (`muse-spark-1.3`), so every Meta request, stored
// session and hook payload keeps its bytes. Provider ids match
// `^[a-z][a-z0-9-]{0,31}$`; `meta` is reserved. Pure.

import { PROVIDER_MODEL_LABEL_MAX_CHARS } from '../../shared/constants'

// D74: provider ids match `^[a-z][a-z0-9-]{0,31}$`; `meta` is reserved.
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const RESERVED_PROVIDER_ID = 'meta'
// A model id carries no whitespace or control character; the provider id is
// checked separately, so a model id may hold slashes (OpenRouter's
// `author/slug`).
const MODEL_ID_PATTERN = /^\S+$/
// Control, format and separator characters a listed label must not keep
// (Cc, Cf, Zl, Zp: the bidi controls live in Cf). Property escapes, so no
// range can silently miss one; the `g` flag strips every occurrence.
const UNPRINTABLE_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** A parsed model reference: the provider and the provider's own model id. */
export interface ModelRef {
  readonly providerId: string
  readonly modelId: string
}

/** Whether the id names a provider (`meta` is reserved and never valid). */
export function isProviderId(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value) && value !== RESERVED_PROVIDER_ID
}

/**
 * The reference's provider and model. A bare id (`muse-spark-1.3`) is
 * Meta's: the whole id is the model. Otherwise the provider is the text
 * before the first slash and the model is the rest, so OpenRouter's
 * `author/slug` survives (`openrouter/deepseek/deepseek-v4-pro`).
 * Undefined for an empty model, a reserved or malformed provider, or a
 * model id with whitespace in it.
 */
export function parseModelRef(ref: string): ModelRef | undefined {
  const slash = ref.indexOf('/')
  if (slash === -1) {
    return ref !== '' && MODEL_ID_PATTERN.test(ref)
      ? { providerId: 'meta', modelId: ref }
      : undefined
  }
  const providerId = ref.slice(0, slash)
  const modelId = ref.slice(slash + 1)
  return modelId === '' || !isProviderId(providerId) || !MODEL_ID_PATTERN.test(modelId)
    ? undefined
    : { providerId, modelId }
}

/** The canonical reference for a provider's model; a bare id for Meta's. */
export function formatModelRef(providerId: string, modelId: string): string {
  return providerId === RESERVED_PROVIDER_ID ? modelId : `${providerId}/${modelId}`
}

/** Whether the reference addresses a BYO provider (anything but Meta's). */
export function isByoModelRef(ref: string): boolean {
  const parsed = parseModelRef(ref)
  return parsed !== undefined && parsed.providerId !== RESERVED_PROVIDER_ID
}

/**
 * A model id or label a provider listed, made safe to show: control and
 * format characters stripped, the rest cut to
 * `PROVIDER_MODEL_LABEL_MAX_CHARS`. A custom server cannot pass itself off
 * as Meta's `muse-spark-1.3` by this alone: callers always show the
 * provider's own label beside it.
 */
export function sanitizeModelLabel(label: string): string {
  const stripped = label.replaceAll(UNPRINTABLE_PATTERN, '')
  const capped = stripped.slice(0, PROVIDER_MODEL_LABEL_MAX_CHARS)
  // Never split a surrogate pair: drop a trailing high surrogate instead.
  return /[\u{D800}-\u{DBFF}]$/u.test(capped) ? capped.slice(0, -1) : capped
}
