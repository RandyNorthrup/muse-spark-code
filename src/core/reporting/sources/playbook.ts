// The orchestrator playbook's journal (M116) as the reporting `playbook`
// source: strike counts per module and class from the owner's replay, design
// decisions with their outcomes, hook-verification receipts with their
// pass/fail results, disabled rules with reasons, and route-around refusals.
// Reads only through the injected reader; only the playbook kind binds it.
import { moduleStates } from '../../orchestration/playbook/modules'
import { validatedRecords } from '../../orchestration/playbook/journal'
import type { PlaybookRecord } from '../../../shared/playbook'
import {
  isRouteAroundRefusal,
  playbookSections,
  type PlaybookDesignView,
  type PlaybookDisabledRuleView,
  type PlaybookDrillView,
  type PlaybookModuleView,
  type PlaybookRefusalView,
  type PlaybookView,
} from '../collect/playbook'
import {
  codeUnitCompare,
  isoDateMs,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'
import type { SourceReadContext } from './types'

/** Validated journal lines; an empty journal is a fresh workspace, not a miss. */
export interface PlaybookReportReader {
  read(context: SourceReadContext): Promise<{
    records: readonly unknown[]
    observedAt: string
    partial?: string
  }>
}

function project(records: readonly PlaybookRecord[]): PlaybookView {
  const states = moduleStates(records)
  const modules: PlaybookModuleView[] = Array.from(states.values(), (state) => ({
    id: state.module.id,
    key: state.module.key,
    strikes: state.strikes,
    rounds: Array.from(state.counts, ([className, round]) => ({
      class: className ?? null,
      round,
    })),
  })).toSorted(
    (left, right) => codeUnitCompare(left.key, right.key) || codeUnitCompare(left.id, right.id),
  )
  const designs: PlaybookDesignView[] = []
  const drills: PlaybookDrillView[] = []
  const disabledRules: PlaybookDisabledRuleView[] = []
  const refusals: PlaybookRefusalView[] = []
  // Every settings save snapshots every switched-off rule, and switching a
  // rule off also journals a `ruleDisabled` note, so one switch would fill
  // the section with copies of itself and hide a second disabled rule past
  // the row cap. Rows that share rule, actor, reason and stamp are one fact.
  const seenDisabled = new Set<string>()
  for (const record of records)
    projectRecord(record, { designs, drills, disabledRules, refusals, seenDisabled })
  return { modules, designs, drills, disabledRules, refusals }
}

function pushDisabledRule(
  sink: { disabledRules: PlaybookDisabledRuleView[]; seenDisabled: Set<string> },
  entry: PlaybookDisabledRuleView,
): void {
  const identity = JSON.stringify([entry.rule, entry.actor, entry.reason, entry.at])
  if (sink.seenDisabled.has(identity)) return
  sink.seenDisabled.add(identity)
  sink.disabledRules.push(entry)
}

function projectRecord(
  record: PlaybookRecord,
  sink: {
    designs: PlaybookDesignView[]
    drills: PlaybookDrillView[]
    disabledRules: PlaybookDisabledRuleView[]
    refusals: PlaybookRefusalView[]
    seenDisabled: Set<string>
  },
): void {
  switch (record.kind) {
    case 'design': {
      sink.designs.push({
        id: record.value.id,
        moduleKey: record.value.module.key,
        redesignLane: record.value.redesignLane,
        failureClass: record.value.failureClass,
        outcome: record.value.outcome,
        at: record.value.at,
        dateIso: isoDateMs(record.value.at),
      })
      break
    }
    case 'verification': {
      sink.drills.push({
        commit: record.value.commit,
        moduleId: record.value.moduleId,
        scope: record.value.scope,
        result: record.value.result,
        at: record.value.at,
        dateIso: isoDateMs(record.value.at),
      })
      break
    }
    case 'settings': {
      for (const [rule, setting] of Object.entries(record.value.rules)) {
        if (!setting.enabled)
          pushDisabledRule(sink, {
            rule,
            actor: setting.actor,
            reason: setting.reason,
            at: setting.at,
            dateIso: isoDateMs(setting.at),
          })
      }
      break
    }
    case 'note': {
      const note = record.value
      if (note.code === 'ruleDisabled')
        pushDisabledRule(sink, {
          rule: note.rule,
          actor: note.actor,
          reason: note.reason,
          at: note.at,
          dateIso: isoDateMs(note.at),
        })
      if (isRouteAroundRefusal(note.rule, note.code))
        sink.refusals.push({
          code: note.code,
          module: note.module,
          actor: note.actor,
          reason: note.reason,
          at: note.at,
          dateIso: isoDateMs(note.at),
        })
      break
    }
    default: {
      break
    }
  }
}

export function playbookSource(reader: PlaybookReportReader | undefined, scrub: SourceScrub) {
  return localSource('playbook', async (context) => {
    if (context.options.kind !== 'playbook') throw new LocalSourceError('disabled')
    if (reader === undefined) throw new LocalSourceError('unbound')
    const read = await reader.read(context)
    let records: PlaybookRecord[]
    try {
      // The journal's own second scrub runs inside validation, over the
      // already source-scrubbed lines, like publication and recovery.
      records = validatedRecords(scrubSourceValue(read.records, scrub) as readonly unknown[])
    } catch {
      throw new LocalSourceError('invalid')
    }
    let view: PlaybookView
    try {
      view = project(records)
    } catch {
      // Schema-valid lines the replay refuses are inconsistent history.
      throw new LocalSourceError('invalid')
    }
    return {
      data: playbookSections(view, context.options),
      observedAt: read.observedAt,
      ...(read.partial !== undefined && { partial: scrub(read.partial) }),
    }
  })
}
