// The ChatGPT plan catalogue's per-model facts (GET /v1/models with the
// plan token). The catalogue already carries every fact the plan route
// needs, so plan models take their numbers from it instead of a fixed
// table. Only the fields the app uses are parsed; unknown fields are
// ignored. The pure facts type and send-path resolution live beside the
// policy so every bundle that sends a plan turn can read them.
import * as z from 'zod/mini'
import type { ChatGptPlanFacts } from '../../backends/modelapi/planFacts'

const reasoningLevelSchema = z.looseObject({ effort: z.string() })
const serviceTierSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
})

/** One catalogue entry: only the fields the app uses, never a token. */
export const chatGptCatalogEntrySchema = z.looseObject({
  slug: z.string().check(z.minLength(1)),
  visibility: z.enum(['list', 'hide']),
  supported_in_api: z.boolean(),
  context_window: z.optional(z.nullable(z.number())),
  supported_reasoning_levels: z.optional(z.array(reasoningLevelSchema)),
  default_reasoning_level: z.optional(z.nullable(z.string())),
  supports_reasoning_summary_parameter: z.optional(z.boolean()),
  service_tiers: z.optional(z.array(serviceTierSchema)),
  default_service_tier: z.optional(z.nullable(z.string())),
  multi_agent_reasoning_effort: z.optional(z.nullable(z.string())),
})
export type ChatGptCatalogEntry = z.infer<typeof chatGptCatalogEntrySchema>

/** The entry's facts, or undefined when the entry is not shaped like one. */
export function chatGptPlanFacts(entry: unknown): ChatGptPlanFacts | undefined {
  const parsed = chatGptCatalogEntrySchema.safeParse(entry)
  if (!parsed.success) return undefined
  const value = parsed.data
  const context = value.context_window
  return {
    source: { kind: 'catalogue' },
    slug: value.slug,
    contextTokens:
      typeof context === 'number' && Number.isSafeInteger(context) && context > 0
        ? context
        : undefined,
    reasoningLevels: (value.supported_reasoning_levels ?? []).map((level) => level.effort),
    defaultReasoningLevel: value.default_reasoning_level ?? undefined,
    supportsReasoningSummary: value.supports_reasoning_summary_parameter ?? true,
    serviceTiers: [...(value.service_tiers ?? [])],
    defaultServiceTier: value.default_service_tier ?? undefined,
    multiAgentReasoningEffort: value.multi_agent_reasoning_effort ?? undefined,
  }
}
