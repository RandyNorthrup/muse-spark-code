import { MODEL_API_LEGACY_CONTEXT_MODELS } from '../../../shared/constants'
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
