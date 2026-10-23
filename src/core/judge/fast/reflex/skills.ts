// M125 lane R (D107): lexical skill and command fit. A skill matches
// only when one of its name's own words appears whole in the request;
// the description breaks no tie, because guessing from prose is the
// engine's job. Zero or several matches miss. Pure and synchronous.
export interface SkillCandidate {
  readonly name: string
  readonly description: string
}

export type SkillVerdict =
  { readonly decision: 'match'; readonly name: string } | { readonly decision: 'miss' }

function words(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 1)
}

/** Match the one skill the request names, or miss. */
export function matchSkill(request: string, skills: readonly SkillCandidate[]): SkillVerdict {
  const requested = new Set(words(request))
  if (requested.size === 0 || skills.length === 0) return { decision: 'miss' }
  const matched = skills.filter((skill) => words(skill.name).some((word) => requested.has(word)))
  return matched.length === 1 && matched[0] !== undefined
    ? { decision: 'match', name: matched[0].name }
    : { decision: 'miss' }
}
