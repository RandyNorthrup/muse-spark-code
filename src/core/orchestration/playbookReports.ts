import {
  playbookRecordSchema,
  type PlaybookLane,
  type PlaybookRecord,
  type PlaybookReportItem,
  type PlaybookWhyNote,
} from '../../shared/playbook'
import { UI_TEXT } from '../../shared/l10n/text'
import type { PlaybookIntegrationPolicy } from './playbookIntegration'

export type PlaybookReportKind = 'playbook' | 'milestone' | 'fleet'

export interface PlaybookResidualEntry {
  readonly name: string
  readonly moduleId: string
  readonly moduleKey: string
  readonly whySafe: string
  readonly followUp: string
  readonly at: number
}

export interface PlaybookResidualAcceptance {
  readonly name: string
  readonly actor: 'lead' | 'owner'
  readonly reason: string
  readonly at: number
}

export interface PlaybookResidualRegister {
  readonly milestoneId: string
  readonly open: readonly PlaybookResidualEntry[]
  readonly accepted: readonly PlaybookResidualAcceptance[]
}

/** G24: the per-milestone residual register. Named residuals from round
 * answers stay open until a lead/owner acceptance for that milestone and
 * name is recorded. Integration surfaces this and refuses release while
 * anything is open. */
export function collectResidualRegister(
  records: readonly PlaybookRecord[],
  lanes: readonly PlaybookLane[],
  milestoneId: string,
): PlaybookResidualRegister {
  const modules = new Set(
    lanes.filter((lane) => lane.milestoneId === milestoneId).map((lane) => lane.module.id),
  )
  const accepted: PlaybookResidualAcceptance[] = []
  const indexByName = new Map<string, number>()
  for (const record of records) {
    if (record.kind !== 'residual' || record.value.milestoneId !== milestoneId) continue
    const entry: PlaybookResidualAcceptance = {
      name: record.value.name,
      actor: record.value.actor,
      reason: record.value.reason,
      at: record.value.at,
    }
    const known = indexByName.get(record.value.name)
    if (known === undefined) {
      indexByName.set(record.value.name, accepted.length)
      accepted.push(entry)
    } else accepted[known] = entry
  }
  const open: PlaybookResidualEntry[] = []
  for (const record of records) {
    if (record.kind !== 'round' || !modules.has(record.value.module.id)) continue
    for (const answer of record.value.answers) {
      if (
        answer.status !== 'residual' ||
        indexByName.has(answer.name) ||
        open.some((entry) => entry.name === answer.name)
      )
        continue
      open.push({
        name: answer.name,
        moduleId: record.value.module.id,
        moduleKey: record.value.module.key,
        whySafe: answer.whySafe,
        followUp: answer.followUp,
        at: record.value.at,
      })
    }
  }
  return { milestoneId, open, accepted }
}

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
