import {
  playbookRecordSchema,
  type PlaybookRecord,
  type PlaybookReportItem,
  type PlaybookWhyNote,
} from '../../shared/playbook'
import { UI_TEXT } from '../../shared/l10n/text'
import type { PlaybookIntegrationPolicy } from './playbookIntegration'

export type PlaybookReportKind = 'playbook' | 'milestone' | 'fleet'

/** M113 supplies its current rows, including its residual register and Needs you facts.
 * The integration preserves their payloads and applies the same ordering in all editors. */
export function collectPlaybookReport<T extends PlaybookReportItem>(
  policy: PlaybookIntegrationPolicy,
  kind: PlaybookReportKind,
  rows: readonly T[],
  showNote: (note: PlaybookWhyNote) => void,
): {
  readonly kind: PlaybookReportKind
  readonly rows: readonly T[]
  readonly record: readonly PlaybookRecord[]
} {
  const byId = new Map(rows.map((row) => [row.id, row]))
  if (byId.size !== rows.length) throw new Error(UI_TEXT.playbookUnavailable)
  const ordered = policy.orderReport(rows)
  showNote(ordered.note)
  const sorted = ordered.items.map((item) => {
    const row = byId.get(item.id)
    if (!row) throw new Error(UI_TEXT.playbookUnavailable)
    return row
  })
  return {
    kind,
    rows: sorted,
    record: policy.getRecord().map((record) => playbookRecordSchema.parse(record)),
  }
}
