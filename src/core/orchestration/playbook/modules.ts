import { randomUUID } from 'node:crypto'
import nodePath from 'node:path'
import { UI_TEXT } from '../../../shared/l10n/text'
import {
  playbookModuleSchema,
  type PlaybookModule,
  type PlaybookRecord,
  type PlaybookRound,
  type PlaybookDesignDecision,
} from '../../../shared/playbook'
import { redactSecrets } from '../../../shared/redact'

export interface ModuleState {
  module: PlaybookModule
  counts: Map<string | undefined, number>
  strikes: number
  current?: PlaybookRound
  design?: PlaybookDesignDecision
}

/** Only workspace-relative selectors enter the registry. Segment-wise
 * normalization also makes Windows spelling and ./ aliases equivalent. */
export function modulePath(value: string): string {
  const path = value.replaceAll('\\', '/').replace(/^\.\//u, '')
  if (
    /^(?:\/|[A-Za-z]:|\w+:)/u.test(path) ||
    path.split('/').some((part) => ['..', '', '.'].includes(part)) ||
    redactSecrets(path) !== path
  )
    throw new Error(UI_TEXT.playbookUnavailable)
  return path
}

export function normalizedModule(module: PlaybookModule): PlaybookModule {
  const parsed = playbookModuleSchema.parse(module)
  if (redactSecrets(parsed.id) !== parsed.id) throw new Error(UI_TEXT.playbookUnavailable)
  return {
    ...parsed,
    key: modulePath(parsed.key),
    files: [...new Set(parsed.files.map((file) => modulePath(file)))].toSorted(
      (a, b) => Number(a > b) - Number(a < b),
    ),
  }
}

/** Trusted adapters can declare lane/team selectors; without either, use
 * the first two directories under the source root. The registry journals
 * this returned id before dispatch; adapters retain it on subsequent calls. */
export function newPlaybookModule(
  files: readonly string[],
  declaration?: { readonly source: 'lane' | 'team'; readonly key: string },
): PlaybookModule {
  const normalized = files.map((file) => modulePath(file))
  const first = normalized[0]
  if (!first) throw new Error(UI_TEXT.playbookUnavailable)
  const parts = first.split('/')
  parts.pop()
  const key = declaration?.key ?? parts.slice(0, 1 + 2).join('/')
  return normalizedModule({
    id: randomUUID(),
    key,
    files: normalized,
    source: declaration?.source ?? 'directory',
  })
}

export function predecessorIds(module: PlaybookModule): string[] {
  const lineage = module.lineage
  if (!lineage) return []
  if ('renamedFrom' in lineage) return [lineage.renamedFrom]
  return 'splitFrom' in lineage ? [lineage.splitFrom] : lineage.mergedFrom
}

export function hasOverlappingFiles(left: PlaybookModule, right: PlaybookModule): boolean {
  return left.files.some((a) =>
    right.files.some((b) => {
      a = a.toLowerCase()
      b = b.toLowerCase()
      if (a === b || nodePath.matchesGlob(a, b) || nodePath.matchesGlob(b, a)) return true
      // Two patterns can intersect without either spelling matching the other.
      // Conservatively overlap compatible literal prefixes; never erase a strike
      // just because a new lane broadens its selector.
      const aPrefix = a.split(/[*?[{]/u, 1)[0] ?? ''
      const bPrefix = b.split(/[*?[{]/u, 1)[0] ?? ''
      return (
        (aPrefix !== a || bPrefix !== b) &&
        (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix))
      )
    }),
  )
}

function validateRound(round: PlaybookRound, state: ModuleState): void {
  const priorCount = state.counts.get(round.class) ?? 0
  const ids = round.findings.map((finding) => finding.id)
  const answers = round.answers.map((answer) => answer.findingId)
  if (
    round.implementerId === round.reviewerId ||
    round.implementerSessionId === round.reviewerSessionId ||
    new Set(ids).size !== ids.length ||
    new Set(answers).size !== answers.length ||
    answers.some((id) => !ids.includes(id)) ||
    round.round < priorCount ||
    round.round > priorCount + 1 ||
    (round.class !== undefined && round.findings.some((finding) => finding.class !== round.class))
  )
    throw new Error(UI_TEXT.playbookUnavailable)
  if (round.class !== undefined) return
  if (round.round > priorCount && round.phase === 'build' && state.strikes > 0)
    throw new Error(UI_TEXT.playbookUnavailable)
  if (round.phase !== 'redesign' || round.round <= priorCount) return
  {
    const expected = state.current?.findings.map((finding) => finding.id) ?? []
    const supplied = round.resolution?.map((resolution) => resolution.findingId) ?? []
    if (
      !state.design ||
      expected.length !== supplied.length ||
      new Set(supplied).size !== supplied.length ||
      supplied.some((id) => !expected.includes(id)) ||
      (round.findings.length === 0 &&
        round.resolution?.some((resolution) => resolution.outcome !== 'impossible'))
    )
      throw new Error(UI_TEXT.playbookUnavailable)
  }
}

/** Replay in publication order. Class records carry their independent
 * lifetime counters; the aggregate retains the active findings and identities.
 * No current state comes from a lane name, branch or display key. */
function applyRecord(record: PlaybookRecord, states: Map<string, ModuleState>): void {
  switch (record.kind) {
    case 'module': {
      const module = normalizedModule(record.value.module)
      const existing = states.get(module.id)
      if (existing) {
        existing.module = module
        return
      }
      const state: ModuleState = { module, counts: new Map(), strikes: 0 }
      for (const id of predecessorIds(module)) {
        const prior = states.get(id)
        if (!prior) throw new Error(UI_TEXT.playbookUnavailable)
        for (const [key, count] of prior.counts)
          state.counts.set(key, Math.max(count, state.counts.get(key) ?? 0))
        state.strikes = Math.max(state.strikes, prior.strikes)
        if (!prior.current) continue
        const allFindings = [...(state.current?.findings ?? []), ...prior.current.findings]
        const findings = allFindings.filter(
          (finding, index) => allFindings.findIndex((other) => other.id === finding.id) === index,
        )
        const allAnswers = [...(state.current?.answers ?? []), ...prior.current.answers]
        const answers = allAnswers.filter(
          (answer, index) =>
            allAnswers.findIndex((other) => other.findingId === answer.findingId) === index,
        )
        state.current =
          !state.current || prior.current.round >= state.current.round
            ? { ...prior.current, module, findings, answers }
            : { ...state.current, findings, answers }
      }
      states.set(module.id, state)
      return
    }
    case 'round': {
      const round = record.value
      const state = states.get(round.module.id)
      if (!state) throw new Error(UI_TEXT.playbookUnavailable)
      validateRound(round, state)
      const previous = state.counts.get(round.class) ?? 0
      state.counts.set(round.class, round.round)
      if (round.class === undefined) {
        if (round.round > previous) state.strikes = round.phase === 'build' ? 1 : state.strikes + 1
        if (round.findings.length === 0) state.strikes = 0
        state.current = round
      }
      return
    }
    case 'design': {
      const state = states.get(record.value.module.id)
      if (!state) throw new Error(UI_TEXT.playbookUnavailable)
      state.design = record.value
      return
    }
    default: {
      return
    }
  }
}

export function moduleStates(records: readonly PlaybookRecord[]): Map<string, ModuleState> {
  const states = new Map<string, ModuleState>()
  for (const record of records) applyRecord(record, states)
  return states
}
