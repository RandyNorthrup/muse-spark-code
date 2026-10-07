import { createHash } from 'node:crypto'
import { UI_TEXT } from '../../shared/l10n/text'
import { playbookBriefSchema, type PlaybookBrief } from '../../shared/playbook'

export type { PlaybookBrief } from '../../shared/playbook'
export interface RenderedPlaybookBrief {
  readonly text: string
  readonly sha256: string
  readonly baseCommit: string
}

/** An unfilled template marker: a brief carrying one never rendered structurally. */
const PLACEHOLDER = /\{\{[^}]*\}\}/u

/** G3/G4: named required sections, no template replacement, a recorded base and digest.
 * Placeholders from an unfilled template refuse before dispatch; ordinary
 * text (including `#`, which broke substitution rendering) passes through.
 * Job prompts use this envelope as data; K owns the surrounding reviewer charter. */
export function renderPlaybookBrief(input: PlaybookBrief): RenderedPlaybookBrief {
  const parsed = playbookBriefSchema.safeParse(input)
  if (!parsed.success) throw new Error(UI_TEXT.playbookUnavailable)
  const sections = [parsed.data.objective, ...parsed.data.scope, ...parsed.data.acceptance]
  if (sections.some((section) => PLACEHOLDER.test(section)))
    throw new Error(UI_TEXT.playbookUnavailable)
  const text = JSON.stringify(parsed.data)
  return {
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    baseCommit: parsed.data.baseCommit,
  }
}
