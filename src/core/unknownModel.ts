import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { parseModelRef } from './providers/modelRef'

/**
 * A model refusal names what was refused and why: the model id as the
 * person typed it, the provider entry that does not offer it, and what
 * the person can do. One source for the sentence on every surface (the
 * terminal agent, the panel, the editor protocol); each surface fills
 * its own remedy.
 */
export function unknownProviderModelText(model: string, provider: string, remedy: string): string {
  return fill(UI_TEXT.modelNotOnProvider, { model, provider, remedy })
}

/** The remedy where a command lists what the entry offers. */
export function listModelsRemedy(command = 'providers list'): string {
  return fill(UI_TEXT.unknownModelListModels, { command })
}

/**
 * The sentence for a reference no configured entry resolves: the id as the
 * person typed it, the entry that was asked (bare ids belong to the
 * reserved `meta` lane), and the remedy for that lane.
 */
export function unknownModelRefText(ref: string): string {
  const parsed = parseModelRef(ref)
  return parsed !== undefined && parsed.providerId !== 'meta'
    ? unknownProviderModelText(ref, parsed.providerId, listModelsRemedy())
    : unknownProviderModelText(ref, 'meta', UI_TEXT.unknownModelPickOffered)
}

/** An effort refusal names the effort, the model, and the valid levels. */
export function effortNotForModelText(
  effort: string,
  model: string,
  levels: readonly string[],
): string {
  return fill(UI_TEXT.effortNotForModel, { effort, model, levels: levels.join(', ') })
}
