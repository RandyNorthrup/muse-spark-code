import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/l10n/text'

const section = z.string().check(z.trim(), z.minLength(1))
const briefSchema = z.strictObject({
  objective: section,
  scope: z.array(section).check(z.minLength(1)),
  acceptance: z.array(section).check(z.minLength(1)),
  baseCommit: section.check(z.regex(/^[a-f\d]+$/u)),
})

export type PlaybookBrief = z.infer<typeof briefSchema>
export interface RenderedPlaybookBrief {
  readonly text: string
  readonly sha256: string
  readonly baseCommit: string
}

/** G3/G4: named required sections, no template replacement, a recorded base and digest.
 * Job prompts use this envelope as data; K owns the surrounding reviewer charter. */
export function renderPlaybookBrief(input: PlaybookBrief): RenderedPlaybookBrief {
  const parsed = briefSchema.safeParse(input)
  if (!parsed.success) throw new Error(UI_TEXT.playbookUnavailable)
  const text = JSON.stringify(parsed.data)
  return {
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    baseCommit: parsed.data.baseCommit,
  }
}
