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
import { collectPlaybookReport, type PlaybookReportKind } from '../../orchestration/playbookReports'
import { playbookReportBucket } from '../../../shared/playbook'
import type { PlaybookPolicy, PlaybookRecord, PlaybookWhyNote } from '../../../shared/playbook'
import type { ReportKind, ReportSection } from '../../../shared/reportSchema'
import { playbookRowReportFlags } from './common'

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
): ReportSection[] {
  if (orderer === undefined) return [...sections]
  return sections.map((section) => {
    const items = section.rows.map((row) => ({
      row,
      id: row.key,
      ...playbookRowReportFlags(row),
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
