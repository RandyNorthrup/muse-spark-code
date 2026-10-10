import {
  playbookRecordSchema,
  type PlaybookLane,
  type PlaybookPolicy,
  type PlaybookRecord,
  type PlaybookReportItem,
  type PlaybookWhyNote,
} from '../../shared/playbook'
import { UI_TEXT } from '../../shared/l10n/text'

export type PlaybookReportKind = 'playbook' | 'milestone' | 'fleet'

export interface PlaybookResidualEntry {
  readonly name: string
  readonly moduleId: string
  readonly moduleKey: string
  readonly whySafe: string
  readonly followUp: string
  readonly at: number
}

export interface PlaybookResidualEvidence {
  readonly whySafe: string
  readonly followUp: string
  readonly moduleId: string
}

export interface PlaybookResidualAcceptance {
  /** Position in the supplied journal, so identical legacy records stay distinct. */
  readonly recordIndex: number
  readonly name: string
  readonly actor: 'lead' | 'owner'
  readonly reason: string
  readonly at: number
  /** The accepted instance. Absent on records written before the binding. */
  readonly evidence?: PlaybookResidualEvidence
}

interface PlacedResidualEntry {
  readonly entry: PlaybookResidualEntry
  /** The journal position that answered it: its answer time, not its review time. */
  readonly seq: number
}

interface PlacedResidualAcceptance {
  readonly acceptance: PlaybookResidualAcceptance
  /** The journal position that recorded it. */
  readonly seq: number
}

/** Whether an acceptance covers a residual instance: same name, answered
 * (published) strictly before the acceptance was recorded and reviewed no
 * later, and — when the acceptance carries evidence — the same safety
 * rationale, follow-up and module. A legacy record without evidence binds to
 * the same-name instances actually preceding it in the journal; a residual
 * answered after the acceptance stays open until freshly accepted, even when
 * its review predates the acceptance. */
function isResidualCovered(
  acceptance: PlacedResidualAcceptance,
  residual: PlacedResidualEntry,
): boolean {
  if (
    residual.seq >= acceptance.seq ||
    acceptance.acceptance.name !== residual.entry.name ||
    acceptance.acceptance.at < residual.entry.at
  )
    return false
  const evidence = acceptance.acceptance.evidence
  return (
    evidence === undefined ||
    (evidence.whySafe === residual.entry.whySafe &&
      evidence.followUp === residual.entry.followUp &&
      evidence.moduleId === residual.entry.moduleId)
  )
}

export interface PlaybookResidualRegister {
  readonly milestoneId: string
  readonly open: readonly PlaybookResidualEntry[]
  readonly accepted: readonly PlaybookResidualAcceptance[]
  /** Acceptances that bound to no answered residual — legacy records with no
   * preceding same-name instance. They cover nothing: the residual stays open
   * (or a fresh acceptance is needed) and release names it. */
  readonly unbound: readonly PlaybookResidualAcceptance[]
}

/** G24: the per-milestone residual register. Named residuals from round
 * answers stay open until a lead/owner acceptance for that milestone and
 * name is recorded after the answer. Integration surfaces this and refuses
 * release while anything is open. */
export function collectResidualRegister(
  records: readonly PlaybookRecord[],
  lanes: readonly PlaybookLane[] | undefined,
  milestoneId: string,
): PlaybookResidualRegister {
  // Record-only surfaces have no lane registry: inspect all recorded modules.
  // Release callers always supply lanes and retain strict milestone scoping.
  const modules =
    lanes === undefined
      ? undefined
      : new Set(
          lanes.filter((lane) => lane.milestoneId === milestoneId).map((lane) => lane.module.id),
        )
  const placed: PlacedResidualEntry[] = []
  const acceptances: PlacedResidualAcceptance[] = []
  for (const [seq, record] of records.entries()) {
    if (record.kind === 'round' && (modules === undefined || modules.has(record.value.module.id))) {
      for (const answer of record.value.answers) {
        if (answer.status !== 'residual') continue
        placed.push({
          entry: {
            name: answer.name,
            moduleId: record.value.module.id,
            moduleKey: record.value.module.key,
            whySafe: answer.whySafe,
            followUp: answer.followUp,
            at: record.value.at,
          },
          seq,
        })
      }
      continue
    }
    if (record.kind !== 'residual' || record.value.milestoneId !== milestoneId) continue
    acceptances.push({
      acceptance: {
        recordIndex: seq,
        name: record.value.name,
        actor: record.value.actor,
        reason: record.value.reason,
        at: record.value.at,
        ...(record.value.evidence !== undefined && { evidence: { ...record.value.evidence } }),
      },
      seq,
    })
  }
  const isBound = (acceptance: PlacedResidualAcceptance): boolean =>
    placed.some((residual) => isResidualCovered(acceptance, residual))
  // Only a bound acceptance counts: the latest bound record per name. An
  // acceptance that binds to nothing — a legacy record with no preceding
  // same-name answer — is reported as unbound, never as accepted.
  const accepted: PlaybookResidualAcceptance[] = []
  const unbound: PlaybookResidualAcceptance[] = []
  const indexByName = new Map<string, number>()
  for (const placedAcceptance of acceptances) {
    if (!isBound(placedAcceptance)) {
      unbound.push(placedAcceptance.acceptance)
      continue
    }
    const { acceptance } = placedAcceptance
    const known = indexByName.get(acceptance.name)
    if (known === undefined) {
      indexByName.set(acceptance.name, accepted.length)
      accepted.push(acceptance)
    } else accepted[known] = acceptance
  }
  const open: PlaybookResidualEntry[] = []
  for (const residual of placed) {
    const { entry } = residual
    if (acceptances.some((acceptance) => isResidualCovered(acceptance, residual))) continue
    const duplicate = open.find(
      (known) =>
        known.name === entry.name &&
        known.moduleId === entry.moduleId &&
        known.whySafe === entry.whySafe &&
        known.followUp === entry.followUp,
    )
    // The same instance republished keeps its latest occurrence: only an
    // acceptance recorded after its answer covers it.
    if (duplicate !== undefined) {
      if (entry.at > duplicate.at) open[open.indexOf(duplicate)] = entry
      continue
    }
    open.push(entry)
  }
  return { milestoneId, open, accepted, unbound }
}

/** M113 supplies its current rows, including its residual register and Needs you facts.
 * The integration preserves their payloads and applies the same ordering in all editors. */
export function collectPlaybookReport<T extends PlaybookReportItem>(
  policy: Pick<PlaybookPolicy, 'orderReport'> & { getRecord(): readonly PlaybookRecord[] },
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
