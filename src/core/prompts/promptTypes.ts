import type { SavedPrompt } from '../../shared/prompts'

import * as z from 'zod/mini'

/**
 * The editable fields only; trust, identities and timestamps belong to the
 * host. D121: any title/body length stands — the removed 80/10000 ceilings
 * were invented — so only a blank title refuses.
 */
export const promptDraftSchema = z.object({
  title: z.string().check(
    z.minLength(1),
    z.refine((title) => title.trim() !== ''),
  ),
  body: z.string(),
  tags: z.array(z.string().check(z.minLength(1))),
  scope: z.enum(['user', 'workspace']),
})
export type PromptDraft = z.infer<typeof promptDraftSchema>

export interface PromptImportPreview {
  readonly id: string
  readonly prompt: SavedPrompt
  readonly variables: SavedPrompt['variables']
}
