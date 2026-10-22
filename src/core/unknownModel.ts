import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

/**
A model refusal names what was refused and why: the model id as the
person typed it, the provider entry that does not offer it, and what
the person can do. One source for the sentence on every surface (the
terminal agent, the panel, the editor protocol); each surface fills
its own remedy. Shared-only, so every bundle can carry it (PLAN.md D6).
*/
export function unknownProviderModelText(model: string, provider: string, remedy: string): string {
  return fill(UI_TEXT.modelNotOnProvider, { model, provider, remedy })
}

/** The remedy where a command lists what the entry offers. */
export function listModelsRemedy(command = 'providers list'): string {
  return fill(UI_TEXT.unknownModelListModels, { command })
}

/**
The entry a reference asks, from its shape alone: a bare id belongs to
the reserved `meta` lane, otherwise the text before the first slash
(OpenRouter's `author/slug` survives, as with the provider parser).
Malformed refs name their raw segment rather than a wrong lane.
*/
export function refEntryName(ref: string): string {
  const slash = ref.indexOf('/')
  if (slash === -1) return 'meta'
  const entry = ref.slice(0, slash)
  return entry === '' ? 'meta' : entry
}

/** The sentence for a reference no configured entry resolves. */
export function unknownModelRefText(ref: string): string {
  const entry = refEntryName(ref)
  const remedy = entry === 'meta' ? UI_TEXT.unknownModelPickOffered : listModelsRemedy()
  return unknownProviderModelText(ref, entry, remedy)
}

/**
An effort refusal names the effort, the model, and the valid levels.
A model serving no known levels (a BYO ref) gets its own sentence:
"Use one of: ." would name no remedy.
*/
export function effortNotForModelText(
  effort: string,
  model: string,
  levels: readonly string[],
): string {
  return levels.length === 0
    ? fill(UI_TEXT.effortNoneForModel, { effort, model })
    : fill(UI_TEXT.effortNotForModel, { effort, model, levels: levels.join(', ') })
}
