import type { SavedPrompt } from '../../shared/prompts'

/** Shared search across title, body and tags, with an optional exact tag filter. */
export function filterPrompts(
  prompts: readonly SavedPrompt[],
  query: string,
  tag?: string,
): SavedPrompt[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return prompts.filter(
    (prompt) =>
      (tag === undefined || prompt.tags.includes(tag)) &&
      terms.every((term) =>
        `${prompt.title}\n${prompt.body}\n${prompt.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(term),
      ),
  )
}
