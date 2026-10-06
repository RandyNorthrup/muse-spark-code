import type { SideCallFormats } from './structuredOutput'
import type { ModelApiHostDeps } from './ModelApiHost'
import {
  MODEL_API_LEGACY_CONTEXT_MODELS,
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
