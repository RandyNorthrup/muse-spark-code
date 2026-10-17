// Finding drafts (M97, PLAN.md D76): readers return findings without
// ids, and `scanLegal` sorts them deterministically before assigning the
// stable `rule/version/counter` ids the report quotes.

import type { LegalFinding } from '../../shared/legal'

/** A finding waiting for its stable id; bounds still apply to every field. */
export type LegalFindingDraft = Omit<LegalFinding, 'id'>
