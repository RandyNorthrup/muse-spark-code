// D214: the M113 collector's playbook ordering (lane I's handoff). Built
// sections go through collectPlaybookReport, so owner and failure rows come
// first in the playbook, milestone and fleet kinds; every other kind keeps
// its own order. Rows ride through as their own items, so payloads survive
// by reference and duplicate keys refuse instead of collapsing. Ordered rows
// take a severity bucket prefix on their keys (0 owner, 1 failure, 2 rest),
// because the finalizer re-sorts every section by key: the prefix makes the
// canonical key order the severity order. The prefix is a pure function of
// the row's flags, so bytes stay stable across runs; a row that changes
// severity legitimately changes identity (a diff shows remove plus add).
import {
  collectPlaybookReport,
  collectResidualRegister,
  type PlaybookReportKind,
} from '../../orchestration/playbookReports'
import { playbookReportBucket } from '../../../shared/playbook'
import type {
  PlaybookPolicy,
  PlaybookRecord,
  PlaybookReportItem,
  PlaybookWhyNote,
} from '../../../shared/playbook'
import type { ReportKind, ReportRow, ReportSection } from '../../../shared/reportSchema'
import { label, playbookRowReportFlags, row, text } from './common'

/** The kinds the seam orders: playbook, milestone and fleet rows go through
collectPlaybookReport; every other kind keeps its own order. */
export function isPlaybookReportKind(kind: ReportKind): kind is PlaybookReportKind {
  return ['playbook', 'milestone', 'fleet'].includes(kind)
}

/** The ordering the report inputs bind: the seam's policy shape, served from
the journal the report already read, without the effect policy (its weight
has no place on the report path). */
export type PlaybookReportOrderer = Pick<PlaybookPolicy, 'orderReport'> & {
  getRecord(): readonly PlaybookRecord[]
}

export function wrapPlaybookSections(
  orderer: PlaybookReportOrderer | undefined,
  kind: PlaybookReportKind,
  sections: readonly ReportSection[],
  showNote: (note: PlaybookWhyNote) => void,
  preflags?: ReadonlyMap<string, Pick<PlaybookReportItem, 'needsUser' | 'failing'>>,
): ReportSection[] {
  if (orderer === undefined) return [...sections]
  return sections.map((section) => {
    const items = section.rows.map((reportRow) => ({
      row: reportRow,
      id: reportRow.key,
      ...(preflags?.get(reportRow.key) ?? playbookRowReportFlags(reportRow)),
    }))
    const result = collectPlaybookReport(orderer, kind, items, showNote)
    return {
      ...section,
      rows: result.rows.map((item) => ({
        ...item.row,
        key: `${String(playbookReportBucket(item))}/${item.row.key}`,
      })),
    }
  })
}

/** A journal residual as a milestone residuals row: open entries block the
release, so they call the owner and fail; unbound acceptances need fresh
acceptance; bound acceptances are history. Keys carry the entry kind plus
its content address, so register entries never collide with plan rows. The
status cell states the entry honestly; the flags (which add failing to open
entries) ride alongside for the wrap. */
const RESIDUAL_FLAGS = {
  open: { needsUser: true, failing: true },
  unbound: { needsUser: true, failing: false },
  accepted: { needsUser: false, failing: false },
} as const
const RESIDUAL_STATUS = { open: 'open', unbound: 'open', accepted: 'complete' } as const

function residualRow(
  kind: 'open' | 'accepted' | 'unbound',
  identity: readonly string[],
  name: string,
  reason: string,
  playbookSourceId: string,
): { row: ReportRow; flags: Pick<PlaybookReportItem, 'needsUser' | 'failing'> } {
  return {
    row: row(
      'playbook-residual',
      [kind, ...identity],
      {
        name: text(name),
        reason: text(reason),
        status: label(RESIDUAL_STATUS[kind]),
      },
      [playbookSourceId],
    ),
    flags: RESIDUAL_FLAGS[kind],
  }
}

/** D214: the journal's residual register merged into the milestone residuals
section, with each row's flags carried alongside for the wrap. Without an
orderer, or with an empty register, sections pass through untouched and the
flag map is empty. */
export function mergeMilestoneResidualRows(
  sections: readonly ReportSection[],
  orderer: PlaybookReportOrderer | undefined,
  scope: string,
  playbookSourceId: string,
): {
  sections: ReportSection[]
  flags: ReadonlyMap<string, Pick<PlaybookReportItem, 'needsUser' | 'failing'>>
} {
  if (orderer === undefined) return { sections: [...sections], flags: new Map() }
  const register = collectResidualRegister(orderer.getRecord(), undefined, scope)
  const merged = [
    ...register.open.map((entry) =>
      residualRow(
        'open',
        [entry.name, entry.moduleId, entry.whySafe, entry.followUp, String(entry.at)],
        entry.name,
        `${entry.whySafe} · ${entry.followUp}`,
        playbookSourceId,
      ),
    ),
    ...register.unbound.map((acceptance) =>
      residualRow(
        'unbound',
        [acceptance.name, acceptance.actor, acceptance.reason, String(acceptance.recordIndex)],
        acceptance.name,
        `${acceptance.actor}: ${acceptance.reason}`,
        playbookSourceId,
      ),
    ),
    ...register.accepted.map((acceptance) =>
      residualRow(
        'accepted',
        [acceptance.name, acceptance.actor, acceptance.reason, String(acceptance.recordIndex)],
        acceptance.name,
        `${acceptance.actor}: ${acceptance.reason}`,
        playbookSourceId,
      ),
    ),
  ]
  if (merged.length === 0) return { sections: [...sections], flags: new Map() }
  return {
    sections: sections.map((section) =>
      section.id === 'milestoneResiduals'
        ? { ...section, rows: [...section.rows, ...merged.map((entry) => entry.row)] }
        : section,
    ),
    flags: new Map(merged.map((entry) => [entry.row.key, entry.flags] as const)),
  }
}

export function wrapPlaybookSection(
  orderer: PlaybookReportOrderer | undefined,
  kind: PlaybookReportKind,
  section: ReportSection,
  showNote: (note: PlaybookWhyNote) => void,
): ReportSection {
  // The wrap preserves length; the fallback only satisfies the type.
  const [ordered = section] = wrapPlaybookSections(orderer, kind, [section], showNote)
  return ordered
}
