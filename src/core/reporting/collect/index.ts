import { REPORT_FORMAT_VERSION } from '../../../shared/constants'
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
import { compare, derivedSourceId, sourcedSection, unavailableRecord } from './common'
import { needsYou } from './needsYou'
import { collectMilestone, planFormat } from './plan'
import {
  collectChanges,
  collectProject,
  collectRelease,
  type ReportSelectionPorts,
} from './repository'
import { collectQuality } from './quality'
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
}

const forwardedKinds = {
  fleet: ['agents', 'workers', 'devices', 'nodes'],
  security: ['vault', 'breakdown', 'grants', 'usage', 'denials', 'locks', 'developerAudit'],
  accounts: ['accounts', 'limits', 'usage', 'swaps', 'refusals', 'confirmations'],
  estimate: ['totals', 'criticalPath', 'limitingResource', 'setups', 'inputs', 'calibration'],
  playbook: ['totals', 'decisions', 'drills', 'disabledRules', 'refusals'],
  issues: ['issues', 'limits'],
  schedules: ['timeline', 'schedules', 'fires', 'refusals', 'cost'],
  keybindings: ['keybindings', 'conflicts'],
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
  const sections =
    source.data?.map((value) => {
      const parsed = reportSectionSchema.parse(value)
      // Already omitted rows cannot be recovered; --full requires complete facts.
      if (options.full && parsed.omittedRows !== 0) throw new Error('report/incompleteFullSource')
      const collected = sourcedSection(
        snapshot,
        options,
        parsed.id,
        parsed.label,
        parsed.columns,
        parsed.rows,
        [kind],
      )
      // Keep arbitrary column keys and any upstream omissions intact.
      return {
        ...collected,
        omittedRows: parsed.omittedRows + collected.omittedRows,
      }
    }) ?? []
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
      default: {
        if (!isForwarded(options.kind)) throw new Error('report/unsupportedKind')
        ;({ sections, sources: extraSources } = forward(snapshot, options, options.kind))
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
        header: {
          kind: options.kind,
          scope: options.scope,
          asOf: options.asOf,
          generatorVersion: snapshot.generatorVersion,
        },
        needsYou: needsYou(snapshot, options),
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
