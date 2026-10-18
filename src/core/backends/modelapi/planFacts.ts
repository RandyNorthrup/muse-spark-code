// A plan model's capability facts from its own catalogue, and the send
// path that resolves from them. Pure: no fetch, no schema, no bundle
// weight beyond these lines, so the policy and the request path can read
// it wherever they load. The catalogue fetch and parse live beside the
// subscription client.
import { THINKING_OFF_EFFORT, type EffortLevel } from '../../../shared/constants'
import { isEffortLevel } from '../../../shared/effort'

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
