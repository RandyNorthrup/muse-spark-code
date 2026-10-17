import type { SavedPrompt } from '../../shared/prompts'

import * as z from 'zod/mini'
import { PROMPT_LIMITS } from '../../shared/constants'

/** The editable fields only; trust, identities and timestamps belong to the host. */
export const promptDraftSchema = z.object({
  title: z.string().check(
    z.minLength(1),
    z.maxLength(PROMPT_LIMITS.title),
    z.refine((title) => title.trim() !== ''),
  ),
  body: z.string().check(z.maxLength(PROMPT_LIMITS.body)),
  tags: z.array(z.string().check(z.minLength(1))),
  scope: z.enum(['user', 'workspace']),
})
export type PromptDraft = z.infer<typeof promptDraftSchema>

export interface PromptImportPreview {
  readonly id: string
  readonly prompt: SavedPrompt
  readonly variables: SavedPrompt['variables']
}
