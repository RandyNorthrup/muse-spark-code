// The ChatGPT plan catalogue's per-model facts (GET /v1/models with the
// plan token). The catalogue already carries every fact the plan route
// needs, so plan models take their numbers from it instead of a fixed
// table: the supported reasoning levels, the default level, the service
// tiers and the context window. Unknown fields are ignored; an entry that
// fails this parse still lists by slug, without facts.
import * as z from 'zod/mini'
import { THINKING_OFF_EFFORT, type EffortLevel } from '../../../shared/constants'
import { isEffortLevel } from '../../../shared/effort'

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

export interface ChatGptServiceTier {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** A plan model's capability facts, with catalogue provenance. */
export interface ChatGptPlanFacts {
  readonly source: { readonly kind: 'catalogue' }
  readonly slug: string
  readonly contextTokens: number | undefined
  /** Catalogue order, verbatim; may name levels the app cannot offer. */
  readonly reasoningLevels: readonly string[]
  readonly defaultReasoningLevel: string | undefined
  /** True unless the catalogue says otherwise (the provider defaults it true). */
  readonly supportsReasoningSummary: boolean
  readonly serviceTiers: readonly ChatGptServiceTier[]
  readonly defaultServiceTier: string | undefined
  readonly multiAgentReasoningEffort: string | undefined
}

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

/**
 * The catalogue levels the app can honestly offer: its own effort
 * vocabulary, in catalogue order. Levels it does not name (`ultra`) are
 * kept out of every picker; the send path below still maps them the way
 * the provider's own client does.
 */
export function planOfferedLevels(facts: ChatGptPlanFacts): readonly EffortLevel[] {
  return facts.reasoningLevels.filter(isEffortLevel)
}

/** The priority tier where the model lists one (the provider's Fast switch). */
export function planFastTier(facts: ChatGptPlanFacts): ChatGptServiceTier | undefined {
  return facts.serviceTiers.find((tier) => tier.id === 'priority')
}

/** The catalogue default where offered, else the lowest offered level. */
export function planDefaultEffort(facts: ChatGptPlanFacts): EffortLevel | undefined {
  const offered = planOfferedLevels(facts)
  if (offered.length === 0) return undefined
  const fallback = offered[0]
  if (fallback === undefined) return undefined
  const def = facts.defaultReasoningLevel
  if (def !== undefined) {
    if (isEffortLevel(def) && offered.includes(def)) return def
    if (def === 'ultra') {
      const mapped = resolvePlanEffort(facts, 'ultra')
      if (isEffortLevel(mapped) && offered.includes(mapped)) return mapped
    }
  }
  return fallback
}

/**
 * The effort a plan turn sends for one requested setting, from the
 * catalogue's own levels. A listed level rides as named, never `none` to
 * a model that does not list it. `ultra` maps the way the provider's own
 * client maps it: the catalogue's multi-agent effort where listed, else
 * `max` where listed, else the highest listed level. Anything else falls
 * back to the catalogue default; Thinking-off rides unchanged.
 */
export function resolvePlanEffort(facts: ChatGptPlanFacts, requested: string): string {
  const offered = planOfferedLevels(facts)
  if ((offered as readonly string[]).includes(requested)) return requested
  if (requested === THINKING_OFF_EFFORT) return THINKING_OFF_EFFORT
  if (requested === 'ultra') {
    const multi = facts.multiAgentReasoningEffort
    if (multi !== undefined && multi !== 'ultra' && (offered as readonly string[]).includes(multi))
      return multi
    if (offered.includes('max')) return 'max'
    const highest = offered.at(-1)
    if (highest !== undefined) return highest
  }
  return planDefaultEffort(facts) ?? THINKING_OFF_EFFORT
}
