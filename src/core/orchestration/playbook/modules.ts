import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
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
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_TIMEOUT_MS,
  TOOL_FILE_MAX_BYTES,
  REVIEW_FINDINGS_MAX,
  PLAYBOOK_CONTENT_SIMILARITY_PERCENT,
  PLAYBOOK_FILE_FINGERPRINT_MAX,
  PLAYBOOK_LINE_HASH_CHARS,
} from '../../../shared/constants'
import type { PlaybookLease } from '../../../shared/playbook'
import { withoutCredentials } from '../../credentialEnvironment'

export interface ModuleState {
  module: PlaybookModule
  counts: Map<string | undefined, number>
  strikes: number
  historicalFiles: string[]
  linked: Set<string>
  escalated: boolean
  leases: Map<string, PlaybookLease & { at: number; status: 'held' | 'released' }>
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

/** Internal technical journal tags, not user-supplied evidence. Fingerprints,
 * user decisions and legacy lease notes remain mandatory retention evidence. */
export const PLAYBOOK_IDENTITY_NOTE = 'playbook-file-identity'
export const PLAYBOOK_LEASE_NOTE = 'playbook-patch-lease'
export const PLAYBOOK_RELEASE_NOTE = 'playbook-patch-release'
export const PLAYBOOK_USER_NOTE = 'playbook-redesign-user-decision'
/** G3: the rendered dispatch brief and its hash, recorded before dispatch. */
export const PLAYBOOK_BRIEF_NOTE = 'playbook-dispatch-brief'

export function fileIdentities(
  workspace: string,
  module: PlaybookModule,
): { file: string; hash: string }[] {
  const root = realpathSync(workspace)
  const files = new Set<string>()
  const visit = (file: string): void => {
    const absolute = nodePath.join(root, file)
    if (!existsSync(absolute)) return
    const real = realpathSync(absolute)
    const relative = nodePath.relative(root, real)
    if (relative.startsWith('..') || nodePath.isAbsolute(relative))
      throw new Error(UI_TEXT.playbookUnavailable)
    const stat = statSync(real)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(real)) visit(`${file}/${entry}`)
    } else if (module.files.some((pattern) => nodePath.matchesGlob(file, pattern))) {
      if (stat.size > TOOL_FILE_MAX_BYTES) throw new Error(UI_TEXT.playbookUnavailable)
      if (files.size >= REVIEW_FINDINGS_MAX) throw new Error(UI_TEXT.playbookUnavailable)
      files.add(file)
    }
  }
  for (const selector of module.files) {
    const prefix = selector.split(/[*?[{]/u, 1)[0] ?? ''
    visit(prefix === selector ? selector : nodePath.posix.dirname(prefix))
  }
  return [...files].map((file) => ({
    file,
    hash: contentIdentity(readFileSync(nodePath.join(root, file), 'utf8')),
  }))
}

/** Bounded line fingerprints retain no file text. Similarity catches edited
 * untracked moves too; Git history supplies path evidence after commit. */
function contentIdentity(content: string): string {
  const lines = [
    ...new Set(
      content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ]
  const fingerprints = lines
    .map((line) =>
      createHash('sha256').update(line).digest('hex').slice(0, PLAYBOOK_LINE_HASH_CHARS),
    )
    .toSorted((a, b) => a.localeCompare(b))
    .slice(0, PLAYBOOK_FILE_FINGERPRINT_MAX)
  return `${createHash('sha256').update(content).digest('hex')}:${fingerprints.join(',')}`
}

export function hasSimilarContent(left: string, right: string): boolean {
  if (left.split(':', 1)[0] === right.split(':', 1)[0]) return true
  const a = left.split(':', 2)[1]?.split(',').filter(Boolean) ?? []
  const b = new Set(right.split(':', 2)[1]?.split(',').filter(Boolean))
  const common = a.filter((line) => b.has(line)).length
  return (
    common > 0 && common * 100 >= Math.max(a.length, b.size) * PLAYBOOK_CONTENT_SIMILARITY_PERCENT
  )
}

/** Git supplies similarity-based rename evidence even when moved code changed
 * bytes. Hashes separately cover untracked moves and copies. Never consult an
 * agent's claim about identity. Both staged and unstaged moves are inspected. */
export function renamedFiles(workspace: string): { from: string; to: string }[] {
  if (!existsSync(nodePath.join(workspace, '.git'))) return []
  const renames: { from: string; to: string }[] = []
  for (const args of [['diff', '--cached'], ['diff'], ['log', '--all', '--format=']]) {
    const result = spawnSync(
      'git',
      [
        ...args,
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '-z',
        `--find-renames=${String(PLAYBOOK_CONTENT_SIMILARITY_PERCENT)}%`,
        '--',
      ],
      {
        cwd: workspace,
        env: withoutCredentials(process.env),
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_OUTPUT_MAX_BYTES,
        windowsHide: true,
      },
    )
    if (result.status !== 0 || result.error) throw new Error(UI_TEXT.playbookUnavailable)
    const fields = result.stdout.split('\0')
    for (let index = 0; index < fields.length - 1; index += 1) {
      const status = (fields[index] ?? '').trim()
      if (!status) continue
      const from = fields[++index]
      if (!from) throw new Error(UI_TEXT.playbookUnavailable)
      if (/^[RC]\d+$/u.test(status)) {
        const to = fields[++index]
        if (!to) throw new Error(UI_TEXT.playbookUnavailable)
        renames.push({ from: modulePath(from), to: modulePath(to) })
      } else if (!/^[ADMTUXB]$/u.test(status)) throw new Error(UI_TEXT.playbookUnavailable)
    }
  }
  return renames
}

function linkedStates(state: ModuleState, states: Map<string, ModuleState>): ModuleState[] {
  const ids = new Set([state.module.id])
  const pending = [state.module.id]
  while (pending.length > 0) {
    const id = pending.shift() ?? ''
    const neighbors = states.get(id)?.linked ?? []
    for (const linked of neighbors) {
      if (ids.has(linked)) continue
      ids.add(linked)
      pending.push(linked)
    }
  }
  return [...ids].map((id) => {
    const linked = states.get(id)
    if (!linked) throw new Error(UI_TEXT.playbookUnavailable)
    return linked
  })
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
      const state: ModuleState = existing ?? {
        module,
        counts: new Map(),
        strikes: 0,
        historicalFiles: [...module.files],
        linked: new Set(predecessorIds(module)),
        escalated: false,
        leases: new Map(),
      }
      state.module = module
      state.historicalFiles = [...new Set([...state.historicalFiles, ...module.files])]
      for (const id of predecessorIds(module)) state.linked.add(id)
      for (const id of predecessorIds(module)) {
        const prior = states.get(id)
        if (!prior) throw new Error(UI_TEXT.playbookUnavailable)
        for (const [key, count] of prior.counts)
          state.counts.set(key, Math.max(count, state.counts.get(key) ?? 0))
        state.strikes = Math.max(state.strikes, prior.strikes)
        state.escalated ||= prior.escalated
        if (prior.design && !state.design) state.design = prior.design
        prior.linked.add(module.id)
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
      const family = linkedStates(state, states)
      const counts = new Map<string | undefined, number>()
      const strikes = Math.max(...family.map((member) => member.strikes))
      for (const member of family)
        for (const [key, count] of member.counts)
          counts.set(key, Math.max(count, counts.get(key) ?? 0))
      for (const linked of family) {
        linked.strikes = strikes
        linked.counts = new Map(counts)
        linked.escalated ||= family.some((member) => member.escalated)
        if (state.current) linked.current = { ...state.current, module: linked.module }
        for (const member of family) if (member !== linked) linked.linked.add(member.module.id)
      }
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
        if (round.round > previous && round.findings.length > 0)
          state.strikes = round.phase === 'build' ? Math.max(1, state.strikes) : state.strikes + 1
        if (round.findings.length === 0 && round.phase === 'redesign') state.strikes = 0
        state.current = round
      }
      // File lineage is one live identity, including identities declared before
      // a later strike. A split cannot freeze a pre-strike snapshot forever.
      for (const linked of linkedStates(state, states)) {
        linked.counts.set(round.class, round.round)
        if (round.class !== undefined) {
          continue
        }

        linked.strikes = state.strikes
        if (linked === state || round.round > previous)
          linked.current = { ...round, module: linked.module }
      }
      return
    }
    case 'lease': {
      const state = states.get(record.value.moduleId)
      if (!state) throw new Error(UI_TEXT.playbookUnavailable)
      state.leases.set(record.value.moduleId, record.value)
      return
    }
    case 'verification': {
      if (record.value.result !== 'fail') return
      const state = states.get(record.value.moduleId)
      if (!state) throw new Error(UI_TEXT.playbookUnavailable)
      // One violation per commit/digest is published by the owner.
      for (const linked of linkedStates(state, states)) linked.strikes += 1
      return
    }
    case 'design': {
      const state = states.get(record.value.module.id)
      if (!state) throw new Error(UI_TEXT.playbookUnavailable)
      if (record.value.outcome === 'pending' && state.escalated)
        throw new Error(UI_TEXT.playbookUnavailable)
      for (const linked of linkedStates(state, states)) {
        linked.design = { ...record.value, module: linked.module }
        linked.escalated ||= ['remains', 'caught'].includes(record.value.outcome)
      }
      return
    }
    case 'note': {
      if (record.value.laneId === PLAYBOOK_USER_NOTE && record.value.actor === 'owner') {
        const state = states.get(record.value.module ?? '')
        if (!state) throw new Error(UI_TEXT.playbookUnavailable)
        for (const linked of linkedStates(state, states)) linked.escalated = false
      }
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
