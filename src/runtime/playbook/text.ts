// Shared text presentation for CLI, ACP and React. Read the installed table
// only at use time. No filesystem, DOM, process or model access.
import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_HOUR,
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_LAUNDER_WINDOW_MS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatDateTime, formatNumber, formatUnit, plural } from '../../shared/l10n/text'
import type {
  PlaybookFindingClass,
  PlaybookRecord,
  PlaybookSettings,
  PlaybookWhyNote,
} from '../../shared/playbook'
import type { PlaybookSnapshot } from './command'

export function playbookNoteText(note: PlaybookWhyNote): string {
  return fill(UI_TEXT.playbookNotes[note.code], {
    module: note.module ?? UI_TEXT.playbookModuleLabel,
    round: note.round === undefined ? UI_TEXT.playbookStatus : formatNumber(note.round),
    classes:
      note.classes?.map((value) => UI_TEXT.playbookClasses[value]).join(', ') ??
      UI_TEXT.playbookClassLabel,
    lane: note.laneId ?? UI_TEXT.playbookStatus,
    worker: note.workerId ?? UI_TEXT.playbookStatus,
    missing: note.missing?.join(', ') ?? UI_TEXT.playbookStatus,
    actor: note.actor ?? UI_TEXT.playbookStatus,
    reason: note.reason ?? UI_TEXT.playbookStatus,
    rule: UI_TEXT.playbookRules[note.rule],
    duration: formatUnit(
      PLAYBOOK_LAUNDER_WINDOW_MS / MILLISECONDS_PER_SECOND / SECONDS_PER_HOUR,
      'hour',
    ),
  })
}

export function disabledPlaybookDetail(
  setting: PlaybookSettings['rules']['threeStrikes'],
): string | undefined {
  return setting.enabled
    ? undefined
    : fill(UI_TEXT.playbookDisabledDetail, {
        actor: setting.actor,
        date: formatDateTime(setting.at),
        reason: setting.reason,
      })
}

/** Counters are journal facts, keyed by stable identity and class. A new key
 * never resets a badge, and a `caught` outcome never implies closure. */
export function playbookCounters(records: readonly PlaybookRecord[]) {
  const counts = new Map<
    string,
    { moduleId: string; module: string; class: PlaybookFindingClass | undefined; round: number }
  >()
  for (const entry of records) {
    if (entry.kind !== 'round') continue
    const round = entry.value
    const key = `${round.module.id}:${round.class ?? ''}`
    const previous = counts.get(key)
    counts.set(key, {
      moduleId: round.module.id,
      module: round.module.key,
      class: round.class,
      round: Math.max(previous?.round ?? 0, round.round),
    })
  }
  return Array.from(counts, ([, counter]) => counter)
}

export function playbookCounterText(counter: ReturnType<typeof playbookCounters>[number]): string {
  const label =
    counter.class === undefined
      ? UI_TEXT.playbookModuleLabel
      : UI_TEXT.playbookClasses[counter.class]
  return `${counter.module} · ${label}: ${plural(UI_TEXT.playbookStrikeBadge, counter.round)}`
}

function prioritized(entry: PlaybookRecord): number {
  if (entry.kind === 'note') return entry.value.needsUser ? 0 : 2
  if (entry.kind === 'design' && entry.value.outcome === 'remains') return 0
  return entry.kind === 'round' && entry.value.findings.length > 0 ? 1 : 2
}

/** Stable within a priority: owner/escalation first, failing reviews next. */
export function orderedPlaybookRecords(records: readonly PlaybookRecord[]): PlaybookRecord[] {
  return records.toSorted((a, b) => prioritized(a) - prioritized(b))
}

export function playbookDesigns(records: readonly PlaybookRecord[]) {
  const designs = new Map<string, Extract<PlaybookRecord, { kind: 'design' }>>()
  for (const record of records) if (record.kind === 'design') designs.set(record.value.id, record)
  return orderedPlaybookRecords(Array.from(designs, ([, design]) => design))
}

export function playbookRecordText(entry: PlaybookRecord): string {
  switch (entry.kind) {
    case 'note': {
      return `${playbookNoteText(entry.value)} · ${formatDateTime(entry.value.at)}`
    }
    case 'settings': {
      return settingsText(entry.value)
    }
    case 'module': {
      return [
        `${UI_TEXT.playbookModuleLabel}: ${entry.value.module.key} (${entry.value.module.id})`,
        entry.value.override === undefined
          ? ''
          : `${UI_TEXT.playbookDispositions.override}: ${entry.value.override.actor} · ${formatDateTime(entry.value.override.at)} · ${entry.value.override.reason}`,
      ]
        .filter(Boolean)
        .join('\n')
    }
    case 'design': {
      const design = entry.value
      return [
        `${UI_TEXT.playbookDesignDecision}: ${design.id} · ${design.module.key}`,
        `${UI_TEXT.playbookDesignFields.failureClass}: ${design.failureClass}`,
        `${UI_TEXT.playbookDesignFields.whyPatchesFailed}: ${design.whyPatchesFailed}`,
        `${UI_TEXT.playbookDesignFields.structuralChange}: ${design.structuralChange}`,
        `${UI_TEXT.playbookDesignFields.planLocation}: ${design.planLocation}`,
        `${UI_TEXT.playbookDesignFields.redesignLane}: ${design.redesignLane}`,
        `${UI_TEXT.playbookOutcomeLabel}: ${design.outcome === 'pending' ? UI_TEXT.playbookDesignPending : UI_TEXT.playbookResolutions[design.outcome]}`,
        formatDateTime(design.at),
      ].join('\n')
    }
    case 'round': {
      const round = entry.value
      return [
        `${round.module.key} (${round.module.id}) · ${plural(UI_TEXT.playbookStrikeBadge, round.round)}`,
        round.class === undefined
          ? ''
          : `${UI_TEXT.playbookClassLabel}: ${UI_TEXT.playbookClasses[round.class]}`,
        ...round.findings
          .toSorted((a, b) => a.severity.localeCompare(b.severity))
          .map(
            (finding) =>
              `${finding.severity} · ${finding.id} · ${finding.file}${finding.line === undefined ? '' : `:${formatNumber(finding.line)}`}${finding.class === undefined ? '' : ` · ${UI_TEXT.playbookClasses[finding.class]}`}`,
          ),
        ...round.answers.map((answer) => {
          const label = `${answer.findingId}: ${UI_TEXT.playbookDispositions[answer.status]}`
          switch (answer.status) {
            case 'fixed': {
              return label
            }
            case 'disputed': {
              return `${label} · ${answer.reason}`
            }
            case 'residual': {
              return `${label} · ${answer.name} · ${answer.whySafe} · ${answer.followUp}`
            }
            case 'override': {
              return `${label} · ${answer.actor} · ${formatDateTime(answer.at)} · ${answer.reason}`
            }
          }
        }),
        ...(round.resolution ?? []).map(
          (resolution) =>
            `${resolution.findingId}: ${UI_TEXT.playbookResolutions[resolution.outcome]} · ${resolution.reason}`,
        ),
        `${round.implementerId} (${round.implementerSessionId}) · ${round.reviewerId} (${round.reviewerSessionId})`,
        formatDateTime(round.at),
      ]
        .filter(Boolean)
        .join('\n')
    }
  }
}

function settingsText(settings: PlaybookSettings): string {
  return [
    `${UI_TEXT.playbookSettings} (${settings.teamId})`,
    ...PLAYBOOK_CONFIGURABLE_RULES.map((rule) => {
      const detail = disabledPlaybookDetail(settings.rules[rule])
      return `${UI_TEXT.playbookRules[rule]} (${rule}): ${settings.rules[rule].enabled ? UI_TEXT.playbookEnabled : UI_TEXT.playbookDisabled}${detail === undefined ? '' : ` · ${detail}`}`
    }),
    `${UI_TEXT.playbookRules.neverAround}: ${UI_TEXT.playbookSafetyAlwaysOn}`,
    `${UI_TEXT.playbookPatchRoundsLabel}: ${formatNumber(settings.patchRoundsMax)}`,
  ].join('\n')
}

export function playbookText(
  view: 'status' | 'record' | 'settings',
  snapshot: PlaybookSnapshot,
): string {
  if (view === 'settings') return settingsText(snapshot.settings)
  const records = orderedPlaybookRecords(snapshot.records)
  if (view === 'record')
    return records.length === 0
      ? UI_TEXT.playbookEmpty
      : records.map((entry) => playbookRecordText(entry)).join('\n\n')
  return [
    ...records
      .filter((entry) => entry.kind === 'note' && entry.value.needsUser)
      .map((entry) => playbookRecordText(entry)),
    ...playbookDesigns(snapshot.records).map((entry) => playbookRecordText(entry)),
    UI_TEXT.playbookTitle,
    ...playbookCounters(snapshot.records).map((counter) => playbookCounterText(counter)),
    ...records
      .filter((entry) => entry.kind === 'note' && !entry.value.needsUser)
      .map((entry) => playbookRecordText(entry)),
    records.length === 0 ? UI_TEXT.playbookEmpty : '',
    settingsText(snapshot.settings),
  ]
    .filter(Boolean)
    .join('\n\n')
}
