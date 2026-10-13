// OPENAI-G26: per-model facts for ChatGPT plan models.
//
// A plan model's context window, input cap, output cap and effort levels
// come from that model's own documented record, never from Meta's
// constants. Numbers below are quoted from the provider's model pages,
// each read 2026-10-13; which slugs a plan catalogue actually lists is
// UNVERIFIED until the PLANROUTE capture (C1) confirms it.
export interface ChatGptPlanModelFacts {
  readonly contextTokens: number
  readonly maxInputTokens?: number | undefined
  readonly maxOutputTokens?: number | undefined
  readonly effortLevels?: readonly string[] | undefined
}

const FACTS: Record<string, ChatGptPlanModelFacts> = {
  // https://developers.openai.com/api/docs/models/gpt-5.3-codex.md:
  // "400,000 context window", "Maximum input tokens: 272,000",
  // "128,000 max output tokens", "supports `low`, `medium`, `high`, and
  // `xhigh` reasoning effort settings".
  'gpt-5.3-codex': {
    contextTokens: 400_000,
    maxInputTokens: 272_000,
    maxOutputTokens: 128_000,
    effortLevels: ['low', 'medium', 'high', 'xhigh'],
  },
  // https://developers.openai.com/api/docs/models/gpt-5.2-codex.md:
  // same four figures as gpt-5.3-codex.
  'gpt-5.2-codex': {
    contextTokens: 400_000,
    maxInputTokens: 272_000,
    maxOutputTokens: 128_000,
    effortLevels: ['low', 'medium', 'high', 'xhigh'],
  },
  // https://developers.openai.com/api/docs/models/codex-mini-latest.md:
  // "200,000 context window", "100,000 max output tokens". The page states
  // reasoning support but no effort levels and no maximum input tokens, so
  // those stay unknown instead of inheriting another model's.
  'codex-mini-latest': {
    contextTokens: 200_000,
    maxOutputTokens: 100_000,
  },
}

/** The documented facts for one plan catalogue slug, if the product knows them. */
export function chatGptPlanFactsFor(slug: string): ChatGptPlanModelFacts | undefined {
  return FACTS[slug]
}
