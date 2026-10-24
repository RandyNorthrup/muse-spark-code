import { REPORT_KIND_REGISTRY } from '../registry'
import { REPORT_FORMAT_VERSION } from '../../../shared/constants'
import type { PlaybookWhyNote } from '../../../shared/playbook'
import {
  reportDocumentSchema,
  reportSectionSchema,
  type ReportDocument,
  type ReportKind,
  type ReportOptions,
  type ReportSection,
  type ReportSourceRecord,
} from '../../../shared/reportSchema'
import type { ReportCollector, SourceSnapshot } from '../sources/types'
import {
  admitForwardedSection,
  compare,
  dedupeUnknownRowKeys,
  derivedSourceId,
  sourcedSection,
  unavailableRecord,
} from './common'
import { needsYou } from './needsYou'
import { collectMilestone, planFormat } from './plan'
import {
  isPlaybookReportKind,
  mergeMilestoneResidualRows,
  wrapPlaybookSection,
  wrapPlaybookSections,
  type PlaybookReportOrderer,
} from './playbookOrder'
import {
  collectChanges,
  collectProject,
  collectRelease,
  type ReportSelectionPorts,
} from './repository'
import { collectAccounts } from './accounts'
import { collectQuality } from './quality'
import { collectSecurity } from './security'
import { collectSession } from './session'
import { cacheSource, otherAgentLimits, otherAgentUsage, usageSections } from './usage'

// R owns canonicalization, the second scrub, then hash calculation. No draft
// can pass report-v1's boundary until the injected finalizer seals it.
export type ReportDraft = Omit<ReportDocument, 'header'> & {
  header: Omit<ReportDocument['header'], 'contentHash'>
}
export interface ReportCollectorDependencies {
  finalize(draft: ReportDraft): ReportDocument
  readonly nextStepLimit: number
  readonly selections: ReportSelectionPorts
  /** D220: the playbook ordering, bound by the facades from the journal the
  report read. Absent, the three playbook kinds keep their own order. */
  readonly playbookOrder?: PlaybookReportOrderer
  /** D220: where the ordering note goes (the host log in production). Absent,
  the order still applies; the note has nowhere to surface. */
  readonly playbookNote?: (note: PlaybookWhyNote) => void
}

const forwardedKinds = {
  fleet: REPORT_KIND_REGISTRY.fleet.sections,
  estimate: REPORT_KIND_REGISTRY.estimate.sections,
  playbook: REPORT_KIND_REGISTRY.playbook.sections,
  issues: REPORT_KIND_REGISTRY.issues.sections,
  schedules: REPORT_KIND_REGISTRY.schedules.sections,
  keybindings: REPORT_KIND_REGISTRY.keybindings.sections,
} as const
type ForwardedKind = keyof typeof forwardedKinds

function isForwarded(kind: ReportKind): kind is ForwardedKind {
  return Object.hasOwn(forwardedKinds, kind)
}

function forward(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  kind: ForwardedKind,
): { sections: ReportSection[]; sources: ReportSourceRecord[] } {
  const source = snapshot.sources[kind]
  const sources: ReportSourceRecord[] = []
  // Each forwarded section parses on its own: one damaged section is an
  // unavailable record beside the good sections, never a lost kind
  // (RVREPORTJOIN P2-1). The collector carries no language table, so the
  // record names the technical section slot, as missing headings do below.
  const sections: ReportSection[] = []
  const values = source.data ?? []
  for (const [index, value] of values.entries()) {
    let parsed: ReportSection
    // Admission before validation: the shared keep-first/count-omitted
    // step runs on the unvalidated section, so the complete section below
    // always meets the row limit (RVREPORTJOIN P2-4).
    const admitted = admitForwardedSection(dedupeUnknownRowKeys(value))
    try {
      // A repeated row key in a forwarded section is drift in the source's
      // own data, never a reason to throw a raw parse error: make keys
      // unique before the schema validates everything else strictly.
      parsed = reportSectionSchema.parse(admitted.section)
    } catch {
      sources.push(
        unavailableRecord(
          derivedSourceId(source.record.id, `records/${String(index)}`),
          `${kind}/records/${String(index)}: invalid`,
        ),
      )
      continue
    }
    // Omitted source rows remain disclosed even with --full; accepted facets survive.
    const collected = sourcedSection(
      snapshot,
      options,
      parsed.id,
      parsed.label,
      parsed.columns,
      parsed.rows,
      [kind],
    )
    // Keep arbitrary column keys, the admission gap above and any upstream
    // omissions intact.
    sections.push({
      ...collected,
      omittedRows: admitted.omittedRows + parsed.omittedRows + collected.omittedRows,
    })
  }
  const headings = forwardedKinds[kind]
  for (const heading of headings) {
    if (sections.some((entry) => entry.label === heading)) continue
    const missing =
      source.data === null
        ? undefined
        : unavailableRecord(
            derivedSourceId(source.record.id, heading),
            `${kind}/${heading}: undefined`,
          )
    if (missing !== undefined) sources.push(missing)
    sections.push(
      sourcedSection(
        snapshot,
        options,
        `${kind}/${heading}`,
        heading,
        ['name'],
        [],
        missing === undefined ? [kind] : [],
        missing === undefined ? [] : [missing],
      ),
    )
  }
  // Section order also survives a reordered source's facets.
  return { sections: sections.toSorted((left, right) => compare(left.id, right.id)), sources }
}

export function createReportCollector(dependencies: ReportCollectorDependencies): ReportCollector {
  if (!Number.isSafeInteger(dependencies.nextStepLimit) || dependencies.nextStepLimit < 1)
    throw new Error('report/invalidNextStepLimit')
  return (snapshot, options) => {
    if (snapshot.asOf !== options.asOf) throw new Error('report/asOfMismatch')
    let sections: ReportSection[]
    let extraSources: ReportSourceRecord[] = []
    // D220: every section carries the same ordering note (one policy, one
    // settings replay); the sink sees it once per report.
    let hasShownPlaybookNote = false
    const showPlaybookNote = (note: PlaybookWhyNote) => {
      if (hasShownPlaybookNote) return
      hasShownPlaybookNote = true
      dependencies.playbookNote?.(note)
    }
    switch (options.kind) {
      case 'project': {
        ;({ sections, sources: extraSources } = collectProject(
          snapshot,
          options,
          dependencies.nextStepLimit,
          dependencies.selections,
        ))
        break
      }
      case 'milestone': {
        sections = collectMilestone(snapshot, options)
        if (dependencies.playbookOrder !== undefined) {
          const merged = mergeMilestoneResidualRows(
            sections,
            dependencies.playbookOrder,
            options,
            snapshot.sources.playbook.record.id,
          )
          sections = wrapPlaybookSections(
            dependencies.playbookOrder,
            'milestone',
            merged.sections,
            showPlaybookNote,
            merged.flags,
          )
        }
        break
      }
      case 'release': {
        sections = collectRelease(snapshot, options)
        break
      }
      case 'changes': {
        ;({ sections, sources: extraSources } = collectChanges(
          snapshot,
          options,
          dependencies.selections,
        ))
        break
      }
      case 'session': {
        sections = collectSession(snapshot, options)
        break
      }
      case 'usage': {
        sections = [
          ...usageSections(snapshot, options, 'usage'),
          otherAgentUsage(snapshot, options),
          otherAgentLimits(snapshot, options),
        ]
        break
      }
      case 'quality': {
        sections = collectQuality(snapshot, options)
        break
      }
      case 'security': {
        sections = collectSecurity(snapshot, options)
        break
      }
      case 'accounts': {
        sections = collectAccounts(snapshot, options)
        break
      }
      default: {
        if (!isForwarded(options.kind)) throw new Error('report/unsupportedKind')
        ;({ sections, sources: extraSources } = forward(snapshot, options, options.kind))
        if (dependencies.playbookOrder !== undefined && isPlaybookReportKind(options.kind))
          sections = wrapPlaybookSections(
            dependencies.playbookOrder,
            options.kind,
            sections,
            showPlaybookNote,
          )
      }
    }
    if (options.kind === 'usage' || options.kind === 'project') {
      const cache = cacheSource(snapshot, 'usage')
      if (cache !== undefined) extraSources.push(cache)
    } else if (options.kind === 'session') {
      const cache = cacheSource(snapshot, 'session')
      if (cache !== undefined) extraSources.push(cache)
    }
    sections.push(planFormat(snapshot, options))
    const needsYouSection = needsYou(snapshot, options)
    const orderedNeedsYou =
      dependencies.playbookOrder !== undefined && isPlaybookReportKind(options.kind)
        ? wrapPlaybookSection(
            dependencies.playbookOrder,
            options.kind,
            needsYouSection,
            showPlaybookNote,
          )
        : needsYouSection
    const sources = new Map<string, ReportSourceRecord>()
    for (const record of [
      ...Object.values(snapshot.sources).map((source) => source.record),
      ...extraSources,
    ]) {
      const existing = sources.get(record.id)
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record))
        throw new Error('report/conflictingSourceRecords')
      sources.set(record.id, record)
    }
    return reportDocumentSchema.parse(
      dependencies.finalize({
        format: REPORT_FORMAT_VERSION,
        moneyVersion: 2,
        header: {
          kind: options.kind,
          scope: options.scope,
          asOf: options.asOf,
          generatorVersion: snapshot.generatorVersion,
        },
        needsYou: orderedNeedsYou,
        sections,
        sources: Array.from(sources, ([, record]) => record).toSorted((left, right) =>
          compare(left.id, right.id),
        ),
        footer: {
          rendererVersion: snapshot.rendererVersion,
          icuVersion: snapshot.icuVersion,
          locale: snapshot.locale,
        },
      }),
    )
  }
}
