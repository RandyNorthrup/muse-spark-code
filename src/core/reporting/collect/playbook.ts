// Playbook report sections (M113 C-M113-4, PLAN.md D93.4 playbook row).
// Pure view-model to sections: the source validates and scrubs the journal,
// replays strike state and projects these facts; this module only filters
// (--module <glob>, --milestone <id>) and builds stable rows. Dates arrive
// pre-rendered because collectors never touch the clock.
import { PLAYBOOK_SAFETY_RULE } from '../../../shared/constants'
import type { ReportOptions, ReportSection, ReportValue } from '../../../shared/reportSchema'
import { count, label, normalizeMilestone, row, section, text } from './common'

export interface PlaybookModuleView {
  readonly id: string
  readonly key: string
  readonly strikes: number
  readonly rounds: readonly { readonly class: string | null; readonly round: number }[]
}
export interface PlaybookDesignView {
  readonly id: string
  readonly moduleKey: string
  readonly redesignLane: string
  readonly failureClass: string
  readonly outcome: string
  readonly at: number
  readonly dateIso: string | undefined
}
export interface PlaybookDrillView {
  readonly commit: string
  readonly moduleId: string
  readonly scope: string
  readonly result: string
  readonly at: number
  readonly dateIso: string | undefined
}
export interface PlaybookDisabledRuleView {
  readonly teamId?: string
  readonly rule: string
  readonly actor: string | undefined
  readonly reason: string | undefined
  readonly at: number
  readonly dateIso: string | undefined
}
export interface PlaybookRefusalView {
  readonly code: string
  readonly module: string | undefined
  readonly actor: string | undefined
  readonly reason: string | undefined
  readonly at: number
  readonly dateIso: string | undefined
}
export interface PlaybookView {
  readonly modules: readonly PlaybookModuleView[]
  readonly designs: readonly PlaybookDesignView[]
  readonly drills: readonly PlaybookDrillView[]
  readonly disabledRules: readonly PlaybookDisabledRuleView[]
  readonly refusals: readonly PlaybookRefusalView[]
}

const escapeGlob = (segment: string): string =>
  segment.replaceAll(/[[\\\]^{[}+().|$]/gu, (char) => `\\${char}`)

/** Segment-wise glob: `*` and `?` stay inside one segment, `**` crosses. */
export function isModuleMatch(key: string, glob: string): boolean {
  const normalized = key.replaceAll('\\', '/')
  const pattern = glob
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) =>
      segment === '**'
        ? segment
        : escapeGlob(segment).replaceAll('*', '[^/]*').replaceAll('?', '[^/]'),
    )
    .join('/')
    .replaceAll('**/[^/]*', '(?:.*/)?[^/]*')
    .replaceAll('**', '.*')
  // Every glob segment passes escapeGlob before fixed character classes and
  // anchors are added; user text cannot introduce regex operators or groups.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`^(?:${pattern})$`, 'u').test(normalized)
}

function isMilestoneMatch(candidates: readonly (string | undefined)[], milestone: string): boolean {
  // A milestone is named by a whole token, never by a substring: `--milestone
  // M13` must not keep lane `C-M113-4`, `--milestone M110` must not keep lane
  // `C-M110a0`, and `--milestone M1` must not keep a UUID that happens to
  // contain a `1`. Lane ids carry their milestone as `M<id>` (`C-M113-4`
  // names M113), so the token allows that one leading `M`.
  const wanted = normalizeMilestone(milestone).replaceAll(/[^0-9A-Z]/gu, '')
  if (wanted === '') return false
  return candidates.some((candidate) => {
    if (candidate === undefined) return false
    const upper = candidate.toUpperCase()
    let index = upper.indexOf(wanted)
    while (index !== -1) {
      const after = upper[index + wanted.length]
      if (after !== undefined && /[0-9A-Z]/u.test(after)) {
        index = upper.indexOf(wanted, index + 1)
        continue
      }
      const before = upper[index - 1]
      if (before === undefined || /[^0-9A-Z]/u.test(before)) return true
      // Lane ids carry their milestone as `M<id>` (`C-M113-4` names M113):
      // that one leading `M` is a marker, not a token character, but only
      // when it stands on its own. Wanted `13` must not match inside `M113`.
      if (before === 'M') {
        const beforeBefore = upper[index - 2]
        if (beforeBefore === undefined || /[^0-9A-Z]/u.test(beforeBefore)) return true
      }
      index = upper.indexOf(wanted, index + 1)
    }
    return false
  })
}

function dateCell(at: number, dateIso: string | undefined): ReportValue {
  // A schema-valid stamp outside the Date range stays visible as its number,
  // never dropped and never rendered as a guessed date.
  return dateIso === undefined ? text(String(at)) : { type: 'timestamp', value: dateIso }
}

function isModuleKept(
  candidates: readonly (string | undefined)[],
  options: ReportOptions,
): boolean {
  // Rows without a module (workspace settings, unscoped notes) are
  // workspace-wide facts: filters keep them, never silently drop them.
  if (candidates.every((candidate) => candidate === undefined)) return true
  const glob = options.module
  if (glob !== undefined) {
    const keys = candidates.filter((candidate) => candidate !== undefined)
    if (keys.every((key) => !isModuleMatch(key, glob))) return false
  }
  return options.milestone === undefined || isMilestoneMatch(candidates, options.milestone)
}

export function playbookSections(view: PlaybookView, options: ReportOptions): ReportSection[] {
  const totals = view.modules
    .filter((module) => isModuleKept([module.key, module.id], options))
    .flatMap((module) => {
      const rounds =
        module.rounds.length > 0 ? module.rounds : [{ class: null as string | null, round: 0 }]
      return rounds.map((entry) =>
        row(
          'strikes',
          [module.key, entry.class ?? 'all', String(entry.round), String(module.strikes)],
          {
            module: text(module.key),
            class: entry.class === null ? label('all') : text(entry.class),
            strikes: count(module.strikes),
            rounds: count(entry.round),
          },
          ['playbook'],
        ),
      )
    })
  const decisions = view.designs
    .filter((design) => isModuleKept([design.moduleKey, design.redesignLane], options))
    .map((design) =>
      row(
        'decision',
        [design.outcome, design.moduleKey, design.id, String(design.at)],
        {
          name: text(design.id),
          module: text(design.moduleKey),
          failure: text(design.failureClass),
          outcome: text(design.outcome),
          date: dateCell(design.at, design.dateIso),
        },
        ['playbook'],
      ),
    )
  const drills = view.drills
    .filter((drill) => isModuleKept([drill.moduleId], options))
    .map((drill) =>
      row(
        'drill',
        [drill.moduleId, drill.commit, drill.scope, String(drill.at)],
        {
          name: text(drill.commit),
          module: text(drill.moduleId),
          scope: text(drill.scope),
          result: text(drill.result),
          date: dateCell(drill.at, drill.dateIso),
        },
        ['playbook'],
      ),
    )
  // Settings rows are workspace-wide, not module-scoped: filters keep them.
  const disabledRules = view.disabledRules.map((entry) =>
    row(
      'disabled',
      [entry.teamId ?? '', entry.rule, entry.actor ?? '', entry.reason ?? '', String(entry.at)],
      {
        team: text(entry.teamId ?? ''),
        rule: text(entry.rule),
        actor: text(entry.actor ?? ''),
        reason: text(entry.reason ?? ''),
        date: dateCell(entry.at, entry.dateIso),
      },
      ['playbook'],
    ),
  )
  // A refusal without a module is workspace-wide, like a settings row.
  const refusals = view.refusals
    .filter((refusal) =>
      isModuleKept(refusal.module === undefined ? [] : [refusal.module], options),
    )
    .map((refusal) =>
      row(
        'refusal',
        [refusal.code, refusal.module ?? '', refusal.actor ?? '', String(refusal.at)],
        {
          code: text(refusal.code),
          module: text(refusal.module ?? ''),
          actor: text(refusal.actor ?? ''),
          reason: text(refusal.reason ?? ''),
          date: dateCell(refusal.at, refusal.dateIso),
        },
        ['playbook'],
      ),
    )
  return [
    section(
      'playbook/totals',
      'totals',
      [
        { key: 'module', label: 'name' },
        { key: 'class', label: 'kind' },
        { key: 'strikes', label: 'count' },
        { key: 'rounds', label: 'count' },
      ],
      totals,
      options,
    ),
    section(
      'playbook/decisions',
      'decisions',
      [
        { key: 'name', label: 'name' },
        { key: 'module', label: 'name' },
        { key: 'failure', label: 'name' },
        { key: 'outcome', label: 'outcome' },
        { key: 'date', label: 'date' },
      ],
      decisions,
      options,
    ),
    section(
      'playbook/drills',
      // The journal holds hook-verification receipts, not the board's
      // break-on-purpose drill records: the heading states what it holds.
      'hookVerification',
      [
        { key: 'name', label: 'name' },
        { key: 'module', label: 'name' },
        { key: 'scope', label: 'scope' },
        { key: 'result', label: 'outcome' },
        { key: 'date', label: 'date' },
      ],
      drills,
      options,
    ),
    section(
      'playbook/disabledRules',
      'disabledRules',
      [
        { key: 'team', label: 'scope' },
        { key: 'rule', label: 'name' },
        { key: 'actor', label: 'name' },
        { key: 'reason', label: 'reason' },
        { key: 'date', label: 'date' },
      ],
      disabledRules,
      options,
    ),
    section(
      'playbook/refusals',
      'refusals',
      [
        { key: 'code', label: 'name' },
        { key: 'module', label: 'name' },
        { key: 'actor', label: 'name' },
        { key: 'reason', label: 'reason' },
        { key: 'date', label: 'date' },
      ],
      refusals,
      options,
    ),
  ]
}

/**
 * Route-around refusals are the safety-rule notes that refused something.
 * Allowed safety-rule notes (`checksPassed` for an admitted command or hook
 * check, `fallbackReviewer` for an applied fallback reviewer) are not
 * refusals: listing them would bury a real `hookTampering`, `gateSkipped`,
 * `permissionLaundering` or `classifierBlocked` refusal past the row cap.
 */
export function isRouteAroundRefusal(rule: string, code: string): boolean {
  return rule === PLAYBOOK_SAFETY_RULE && code !== 'checksPassed' && code !== 'fallbackReviewer'
}
