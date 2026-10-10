import type { SideCallFormats } from './structuredOutput'
import type { ModelApiHostDeps } from './ModelApiHost'
import type { ArgumentPreviewCapabilities } from './argumentPreview'
import {
  MODEL_API_LEGACY_CONTEXT_MODELS,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  M106_CAPTURED_META_MODEL,
} from '../../../shared/constants'
import type { ModelCapabilities } from '../../providers/capabilities'

/** Known Meta models only; an installed registry resolver remains authoritative. */
export function metaModelFacts(modelId: string):
  | {
      readonly capabilities: ModelCapabilities
      readonly quirks: { readonly cachedUsageFields: readonly string[] }
    }
  | undefined {
  if (!MODEL_API_LEGACY_CONTEXT_MODELS.includes(modelId)) return undefined
  return {
    capabilities: {
      toolCalling: true,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
      // Owner's live 2026-10-05 strict-tool receipt (M101INT brief).
      supportsStrictTools: true,
    },
    quirks: { cachedUsageFields: ['input_tokens_details.cached_tokens'] },
  }
}

/** U10's one counted model; unknown never inherits the provider's support. */
export function metaSideCallFormats(modelId: string): SideCallFormats {
  return modelId === M106_CAPTURED_META_MODEL
    ? { state: 'yes', value: ['strict_schema'] }
    : { state: 'unknown' }
}

/** U8's hosted tool and bound on the same selected model, without a guessed row. */
export function metaHostedCapabilities(
  modelId: string,
): ReturnType<NonNullable<ModelApiHostDeps['modelCapabilities']>> {
  return modelId === M106_CAPTURED_META_MODEL
    ? {
        hosted: {
          webSearch: { state: 'yes', value: { tool: 'web_search' } },
          maxToolCalls: { state: 'yes', value: true },
        },
      }
    : undefined
}

/**
 * U9's delta/done sequence on the captured contributor model
 * (`test/fixtures/m106/u9-strict-stream.json` shows two
 * `response.function_call_arguments.delta` frames then `.done`): only that
 * model streams tool arguments. Unobserved models keep today's stream.
 */
export function metaArgumentPreviewCapabilities(
  modelId: string,
): ArgumentPreviewCapabilities | undefined {
  return modelId === M106_CAPTURED_META_MODEL
    ? { tools: { streamingArguments: { state: 'yes', value: true } } }
    : undefined
}

/**
 * The selected Meta output cap (PLAN.md D86.5, acceptance 8): the documented
 * 131,072-token maximum every Muse Spark model shares, matching
 * `modelPolicyFor`'s Meta ceiling so the request and the clamp agree. Other
 * providers keep the legacy request cap until their own capture.
 */
export function metaOutputMaxTokens(modelId: string): number | undefined {
  return modelId.includes('/') || !modelId.startsWith(MODEL_API_MODEL_PREFIX)
    ? undefined
    : MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS
}
