import { parseEstimate, EstimateDiagnosticError } from './diagnostic'
// The estimator's plan snapshot (M117 C-M117-1, PLAN.md D97.2): the shared
// core adapter every host's snapshot binding reads. It projects one bounded
// EstimateGoalSnapshot from M113's readPlan (lane tables, Starts, rigs,
// files, the delivery order, §10 releases) plus git merged-lane state plus
// PR/issue evidence, for the requesting goal only. It performs no IO: the
// host gathers the plan text and the already-captured evidence.
//
// A Starts cell is `day 0` or `after <ref>[, <ref> | and <ref>]...`, where a
// ref is a lane of its own milestone (`0`, `lane 0`), a qualified lane
// (`M100:T`) or a whole milestone (`M100`, expanding to its lanes). `first`
// binds nothing; `last` depends on every other unfinished lane of its
// milestone; an empty cell binds nothing. Notes contain no ordering words.
// Anything else is malformed and refuses naming the cell and its plan line, so prose
// can never silently become a dependency or silently drop one. Strictness
// applies to the goal's dependency closure: rows outside it never block a
// forecast. `checkPlan` lists every problem in the whole plan instead.
//
// Scoping keeps the snapshot inside ESTIMATE_MAX_ITEMS and makes missing
// hour estimates fail loudly: a goal whose transitive closure needs an
// hour-less unfinished lane (Hours `—`, missing, or `0`) is refused naming
// the lanes, instead of estimating a silently partial DAG. Completed lanes
// retain their identity with zero remaining work; unknown prerequisites,
// reader drift and unknown rigs refuse with named diagnostics. Metered
// demands the plan never carries (slots, accounts, CI, disk) are disclosed
// assumptions at the engine fixtures' scale with zero samples — the schedule
// refuses unknowns there — while review stays an explicit unknown, so the
// estimate qualifies it through its unknown limits.
import { estimateGoalSchema, estimateRequestSchema, type EstimateGoal } from '../../shared/estimate'
import {
  ESTIMATE_ASSUMED_PEAK_BYTES,
  ESTIMATE_ASSUMED_STEADY_BYTES,
  ESTIMATE_ASSUMED_TOKENS_PER_HOUR,
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_MISSING_DETAIL_LIMIT,
} from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import {
  comparePlanText,
  milestoneHeading,
  PLAN_SECTIONS,
  planLines,
  planTables,
  tableCells,
  type PlanLine,
} from '../reporting/plan/grammar'
import { readPlan } from '../reporting/plan/reader'
import type { PlanFacts } from '../reporting/sources/types'
import type { EstimateGoalSnapshot } from './goal'

/** Git merged-lane state: branch names with whether each is merged. */
export interface PlanSnapshotBranch {
  readonly name: string
  readonly merged: boolean
}

/** PR evidence: the head branch, the number, and the merged-aware state. */
export interface PlanSnapshotPull {
  readonly branch: string
  readonly number: number
  readonly state: 'open' | 'closed' | 'merged'
}

/** Issue evidence with its explicit lane associations (M113 N linkage). */
export interface PlanSnapshotIssue {
  readonly number: number
  readonly labels: readonly string[]
  readonly laneIds: readonly string[]
}

export interface PlanSnapshotEvidence {
  readonly branches?: readonly PlanSnapshotBranch[]
  readonly pullRequests?: readonly PlanSnapshotPull[]
  readonly issues?: readonly PlanSnapshotIssue[]
}

const TERMINAL_MILESTONES = new Set(['merged', 'released', 'complete'])
const MILESTONE_ID = /^M([1-9]\d*[a-z\d]*)$/
const QUALIFIED_REF = /^M([1-9]\d*[a-z\d]*):([\w.-]+)$/

/** File-bearing lane-table columns (PLAN.md's vocabulary, §6 lane tables). */
const FILE_COLUMNS = new Set([
  'Files it owns',
  'Own files',
  'Owns',
  'Muse implementation ownership',
  'Muse owns',
  'Adds',
  'Its regions in shared files',
  'Shared files (region)',
])

/** Rig names the plan uses, to the OS facts the schedule may assume. */
const RIG_OS: ReadonlyMap<
  string,
  { os: 'linux' | 'macos' | 'windows'; arch: 'x64' | 'arm64' | null }
> = new Map([
  ['kubuntu', { os: 'linux', arch: null }],
  ['macmini', { os: 'macos', arch: 'arm64' }],
  ['win11vm', { os: 'windows', arch: null }],
  ['win11', { os: 'windows', arch: null }],
  ['windows', { os: 'windows', arch: null }],
])

function refuse(detail: string): never {
  throw new EstimateDiagnosticError(detail)
}

/** The snapshot's canonical milestone id: what the goal grammar parses. */
function canonicalMilestoneId(readerId: string): string | null {
  const match = MILESTONE_ID.exec(readerId)
  return match?.[1] === undefined ? null : `M${match[1].toLowerCase()}`
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('\\', '/')
    .replaceAll(/[^a-z\d]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

/** The snapshot's canonical lane short: the reader keeps plan punctuation
 * (M112's `Integration,` row), but protocol ids allow only word chars, dots
 * and dashes. Edge punctuation is stripped; a row with no addressable token
 * is refused instead of emitted against the id grammar. */
function canonicalLaneShort(raw: string): string | null {
  const token = raw.replaceAll(/[*`]/g, '').split(/\s+/, 1)[0] ?? ''
  const clean = token.replaceAll(/^[^\w.-]+|[^\w.-]+$/g, '')
  return /^[\w.-]+$/.test(clean) ? clean : null
}

/** The branch convention, as M113's lane reader matches it (lanes.ts). */
function shortRef(name: string): string {
  return name
    .replaceAll(/^refs\/(?:heads|remotes)\//g, '')
    .replaceAll(/^remotes\//g, '')
    .replaceAll(/^[^/]+\/(?=(?:feature\/|m\d+\/))/g, '')
}

function laneShorts(short: string): string[] {
  return short === '0' ? ['0', 'l0'] : [short.toLowerCase()]
}

function branchLane(branch: string, prefix: string, shorts: readonly string[]): string | null {
  const ref = shortRef(branch).toLowerCase()
  let hit: string | null = null
  for (const short of shorts) {
    // Two tables may reuse an owner letter (M91): an ambiguous branch names no lane.
    const isMatch = laneShorts(short).some(
      (lane) =>
        ref === `${prefix}/${lane}` ||
        ref.startsWith(`${prefix}/${lane}-`) ||
        ref.startsWith(`feature/${prefix}-${lane}-`) ||
        ref === `feature/${prefix}-${lane}`,
    )
    if (!isMatch) continue
    if (hit !== null) return null
    hit = short
  }
  return hit
}

interface LaneCells {
  starts: string
  rig: string
  files: string
  /** The first row's plan line, for malformed-Starts diagnostics. */
  line: number
}

/** Collect lane-table cells even when the reader diagnoses their columns. */
function laneTableCells(text: string): Map<string, Map<string, LaneCells>> {
  const tables = new Map<string, Map<string, LaneCells>>()
  const lines = planLines(text)
  let section = 0
  let milestone: string | null = null
  let body: PlanLine[] = []
  const flush = (): void => {
    if (milestone !== null) {
      const rows = tables.get(milestone) ?? new Map<string, LaneCells>()
      for (const { columns, rows: tableRows } of planTables(body, [])) {
        if (columns[0] !== 'Lane' && columns[0] !== 'Lane / receipt') continue
        const startsIndex = columns.indexOf('Starts')
        const rigIndex = columns.indexOf('Rig')
        const fileIndexes = columns.flatMap((column, index) =>
          FILE_COLUMNS.has(column) ? [index] : [],
        )
        for (const row of tableRows) {
          const cells = tableCells(row.text)
          if (cells.length !== columns.length) continue
          const id = canonicalLaneShort(cells[0] ?? '')
          if (id === null) continue
          const files = fileIndexes.map((index) => cells[index] ?? '').join('\n')
          const previous = rows.get(id)
          rows.set(id, {
            starts: [previous?.starts, startsIndex === -1 ? '' : (cells[startsIndex] ?? '')]
              .filter((part) => part !== undefined && part !== '')
              .join('; '),
            rig: [previous?.rig, rigIndex === -1 ? '' : (cells[rigIndex] ?? '')]
              .filter((part) => part !== undefined && part !== '')
              .join(' + '),
            files: [previous?.files, files].filter((part) => part !== '').join('\n'),
            line: previous?.line ?? row.line,
          })
        }
      }
      tables.set(milestone, rows)
    }
    body = []
  }
  for (const row of lines) {
    const sectionMatch = /^## (\d+)\. (.+)$/.exec(row.text)
    if (sectionMatch?.[1]) {
      flush()
      milestone = null
      section = Number(sectionMatch[1])
      continue
    }
    const item = section === PLAN_SECTIONS.milestones ? milestoneHeading(row.text) : null
    if (item) {
      flush()
      milestone = item.id
      continue
    }
    if (milestone !== null) body.push(row)
  }
  flush()
  return tables
}

/** The milestones each delivery-order entry's bold title assigns, by version.
 * A versioned release train names its components in the title ("0.15.0: M95,
 * M96, M97, M101 and M102"); the reader keeps only the entry id, so the
 * titles are re-read here with the reader's own item boundaries. Only the
 * label matters, so trailing prose can never corrupt membership. */
function releaseMembers(text: string): Map<string, Set<string>> {
  const members = new Map<string, Set<string>>()
  const itemStart = /^(?:\d+[.)]\s|[-*+]\s|\*\*(?:M\d|\d+\.\d))/
  let section = 0
  let isInOrder = false
  let item: string | null = null
  const flush = (): void => {
    if (item !== null) {
      const flat = item.replaceAll(/\s+/g, ' ')
      const label = /^\d+[.)]\s+\*\*(.+?)\*\*(?: \([^)]*\))? — /.exec(flat)?.[1] ?? ''
      const version = /^\d+\.\d+\.\d+/.exec(label)?.[0]
      if (version !== undefined) {
        const ids = new Set<string>()
        for (const match of label.matchAll(/\bM([1-9]\d*[a-z\d]*)\b/gi)) {
          ids.add(`M${(match[1] ?? '').toLowerCase()}`)
        }
        members.set(version, ids)
      }
    }
    item = null
  }
  for (const row of planLines(text)) {
    const heading = /^## (\d+)\. (.+)$/.exec(row.text)
    if (heading?.[1] !== undefined) {
      flush()
      section = Number(heading[1])
      isInOrder = false
      continue
    }
    if (row.text.startsWith('### ')) {
      flush()
      isInOrder = /^### Delivery order(?: \(\d{4}-\d{2}-\d{2}\))?$/.test(row.text)
      continue
    }
    if (row.text === '**Delivery order**' && section === PLAN_SECTIONS.milestones) {
      flush()
      isInOrder = true
      continue
    }
    if (!isInOrder) continue
    if (itemStart.test(row.text)) {
      flush()
      item = row.text
    } else if (item !== null && !row.text.startsWith('### ')) {
      item += ` ${row.text.trim()}`
    }
  }
  flush()
  return members
}

/** Workspace-relative path globs from backtick spans; prose stays out. */
function extractFiles(cells: string): string[] {
  const files = new Set<string>()
  for (const match of cells.matchAll(/`([^`]+)`/g)) {
    const token = (match[1] ?? '').trim().replaceAll('\\', '/')
    if (!/[/.]/.test(token) || token.includes(' ') || token.startsWith('-')) continue
    // Absolute paths and parent climbs never enter the snapshot, before
    // segment filtering can hide what they were.
    if (/^(?:\/|[a-z]:)/i.test(token.replaceAll(/^(?:\.\/)+/g, ''))) continue
    const normalized = token
      .replaceAll(/^(?:\.\/)+/g, '')
      .split('/')
      .filter((part) => part !== '' && part !== '.')
      .join('/')
    if (normalized === '' || normalized.split('/').includes('..')) continue
    files.add(normalized)
  }
  return [...files].toSorted(comparePlanText)
}

interface StartsRefs {
  lanes: string[]
  milestones: string[]
  /** A `last` clause: the lane starts after every other unfinished lane. */
  isLast: boolean
  unresolved: string[]
}

interface StartsToken {
  readonly kind: 'word' | 'separator' | 'clause' | 'note'
  readonly text: string
}

/** Small lexer: balanced notes are tokens, never deleted ordering prose. */
function startsTokens(cell: string): StartsToken[] | null {
  const tokens: StartsToken[] = []
  const source = cell.replaceAll(/[*`]/g, '')
  for (let index = 0; index < source.length;) {
    const char = source[index] ?? ''
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '(') {
      const start = index++
      let depth = 1
      while (index < source.length && depth > 0) {
        if (source[index] === '(') depth += 1
        if (source[index] === ')') depth -= 1
        index += 1
      }
      const note = source.slice(start, index)
      if (depth !== 0 || /\b(?:after|before|once|when|finished|last|freeze)\b/i.test(note))
        return null
      tokens.push({ kind: 'note', text: note })
      continue
    }
    if (char === ';' || /[,+&]/.test(char)) {
      tokens.push({ kind: char === ';' ? 'clause' : 'separator', text: char })
      index += 1
      continue
    }
    const word = /^[\w.:-]+/.exec(source.slice(index))?.[0]
    if (word === undefined) return null
    tokens.push({ kind: word.toLowerCase() === 'and' ? 'separator' : 'word', text: word })
    index += word.length
  }
  return tokens
}

/** clause := first | last | day integer | after ref (separator ref)*
 * ref := lane local-id | milestone M-id | M-id:local-id | M-id | local-id
 * Notes may follow a complete clause and contain no ordering words. */
function parseStartsCell(
  cell: string,
  id: string,
  line: number,
  shorts: ReadonlyMap<string, string>,
  resolveQualified: (mid: string, token: string) => string | null,
): StartsRefs | { malformed: string } {
  const self = id.slice(0, id.indexOf(':'))
  const malformed = (): { malformed: string } => ({
    malformed: `malformed-starts: ${id} line ${String(line)}`,
  })
  const tokens = startsTokens(cell)
  if (tokens === null) return malformed()
  const lanes = new Set<string>()
  const milestones = new Set<string>()
  const unresolved = new Set<string>()
  let isLast = false
  let index = 0
  const word = (): string | undefined => {
    const token = tokens[index]
    if (token?.kind !== 'word') return undefined
    index += 1
    return token.text
  }
  const hasReference = (): boolean => {
    let token = word()
    if (token === undefined) return false
    const kind = token.toLowerCase()
    const isLocal = kind === 'lane'
    const isMilestone = kind === 'milestone'
    if (isLocal || isMilestone) token = word()
    if (token === undefined) return false
    const mid = /^M([1-9]\d*[a-z\d]*)$/i.exec(token)?.[1]
    if (isMilestone || (!isLocal && mid !== undefined)) {
      if (mid === undefined) return false
      milestones.add(`M${mid.toLowerCase()}`)
      return true
    }
    const qualified = QUALIFIED_REF.exec(token)
    if (!isLocal && qualified?.[1] && qualified[2]) {
      const canonical = `M${qualified[1].toLowerCase()}`
      const resolved = resolveQualified(canonical, qualified[2])
      if (resolved === null) unresolved.add(`${canonical}:${qualified[2]}`)
      else lanes.add(resolved)
      return true
    }
    if (!/^[\w.-]+$/.test(token)) return false
    const short = shorts.get(token.toLowerCase())
    if (short === undefined) unresolved.add(`${self}:${token}`)
    else lanes.add(`${self}:${short}`)
    return true
  }
  const hasClause = (): boolean => {
    const keyword = word()?.toLowerCase()
    switch (keyword) {
      case 'last': {
        isLast = true
        return true
      }
      case 'day': {
        return word() === '0'
      }
      case 'after': {
        if (!hasReference()) return false
        while (tokens[index]?.kind === 'separator') {
          index += 1
          if (!hasReference()) return false
        }
        return true
      }
      case 'first': {
        return true
      }
      default: {
        return false
      }
    }
  }
  while (index < tokens.length) {
    if (!hasClause()) return malformed()
    while (tokens[index]?.kind === 'note') index += 1
    if (index === tokens.length) break
    if (tokens[index]?.kind !== 'clause') return malformed()
    index += 1
    if (index === tokens.length) return malformed()
  }
  return {
    lanes: [...lanes].toSorted(comparePlanText),
    milestones: [...milestones].toSorted(comparePlanText),
    isLast,
    unresolved: [...unresolved].toSorted(comparePlanText),
  }
}

/** A Starts parse that failed the grammar names its own diagnostic. */
function isMalformedStarts(
  parsed: StartsRefs | { malformed: string },
): parsed is { malformed: string } {
  return 'malformed' in parsed
}

/** One lane's Starts cell against the whole plan's ids, shared by the goal
 * closure validator and the whole-plan check. */
function parseLaneStarts(
  lane: PlanGraphLane,
  graph: Pick<PlanGraph, 'shortsByMilestone' | 'resolveQualified'>,
): StartsRefs | { malformed: string } {
  return parseStartsCell(
    lane.startsCell,
    lane.id,
    lane.line,
    graph.shortsByMilestone.get(lane.mid) ?? new Map<string, string>(),
    graph.resolveQualified,
  )
}

interface FullLane {
  readonly id: string
  readonly short: string
  readonly mid: string
  readonly hours: number | null
  readonly state: 'merged' | 'running' | 'planned'
  readonly pr: number | null
  readonly deps: readonly string[]
  readonly files: readonly string[]
  readonly rigId: string | null
  readonly rigAffinity: {
    readonly os: readonly ('windows' | 'macos' | 'linux')[]
    readonly architectures: readonly ('x64' | 'arm64')[]
  }
}

function unknownQuantity(): {
  readonly status: 'unknown'
  readonly value: null
  readonly basis: 'unknown'
  readonly samples: 0
  readonly uncertainty: { readonly kind: 'unknown' }
} {
  return {
    status: 'unknown',
    value: null,
    basis: 'unknown',
    samples: 0,
    uncertainty: { kind: 'unknown' },
  }
}

/** Whether a PR touches the goal's lanes. A loop, not the Set methods the
 * linter prefers: the extension host runs Node 20, which lacks them. */
function hasSharedLanes(laneIds: ReadonlySet<string>, included: ReadonlySet<string>): boolean {
  for (const id of laneIds) {
    if (included.has(id)) return true
  }
  return false
}

/** A disclosed assumption: the plan never meters demand, so the snapshot
 * assumes the engine fixtures' scale with zero samples instead of refusing
 * every forecast (or silently running on zeros). Calibration replaces it. */
function assumedDemand(value: number): {
  readonly status: 'known'
  readonly value: number
  readonly basis: 'assumption'
  readonly samples: 0
  readonly uncertainty: {
    readonly kind: 'interval'
    readonly lower: number
    readonly upper: number
  }
} {
  return {
    status: 'known',
    value,
    basis: 'assumption',
    samples: 0,
    uncertainty: { kind: 'interval', lower: value, upper: value },
  }
}

interface PlanGraphLane extends FullLane {
  readonly startsCell: string
  readonly line: number
  readonly rigNames: readonly string[]
}

interface PlanGraph {
  readonly lanes: Map<string, PlanGraphLane>
  readonly milestoneLanes: Map<string, string[]>
  readonly shortsByMilestone: Map<string, Map<string, string>>
  readonly duplicates: Set<string>
  readonly resolveQualified: (mid: string, token: string) => string | null
}

/** Collect lane identities, including rows from diagnosed tables and
 * hour-less lanes. Parsing and row diagnostics precede closure validation. */
function collectPlanGraph(
  facts: Pick<PlanFacts, 'milestones'>,
  cells: Map<string, Map<string, LaneCells>>,
): PlanGraph {
  const lanes = new Map<string, PlanGraphLane>()
  const milestoneLanes = new Map<string, string[]>()
  const shortsByMilestone = new Map<string, Map<string, string>>()
  const duplicates = new Set<string>()
  for (const milestone of facts.milestones) {
    const mid = canonicalMilestoneId(milestone.id)
    if (mid === null) continue
    const rows = cells.get(milestone.id) ?? new Map<string, LaneCells>()
    const shorts = new Map<string, string>()
    // The reader rejects unsupported tables, but their rows still enter
    // collection so their Starts and identity problems are never lost.
    const readerShorts = new Set(milestone.lanes.map((lane) => canonicalLaneShort(lane.id)))
    const sourceLanes = [...milestone.lanes]
    for (const id of rows.keys()) {
      if (readerShorts.has(id)) continue
      sourceLanes.push({
        id,
        scope: '',
        branch: null,
        certification: null,
        hours: null,
        state: 'planned',
        pullRequest: null,
      })
    }
    for (const lane of sourceLanes) {
      const short = canonicalLaneShort(lane.id)
      if (short === null) continue
      const lower = short.toLowerCase()
      if (!shorts.has(lower)) shorts.set(lower, short)
      if (short === '0' && !shorts.has('l0')) shorts.set('l0', short)
    }
    shortsByMilestone.set(mid, shorts)
    const isTerminal = TERMINAL_MILESTONES.has(milestone.status)
    const ordered = milestoneLanes.get(mid) ?? []
    milestoneLanes.set(mid, ordered)
    for (const lane of sourceLanes) {
      const short = canonicalLaneShort(lane.id)
      if (short === null) continue
      const id = `${mid}:${short}`
      const row = rows.get(short)
      let state: FullLane['state'] = 'running'
      if (isTerminal || lane.state === 'merged') state = 'merged'
      else if (lane.state === 'planned') state = 'planned'
      const files = extractFiles(row?.files ?? '')
      const rigNames = [...new Set((row?.rig ?? '').split(/\s*(?:\+|,|&)\s*|\s+and\s+/i))]
        .map((name) => name.trim())
        .filter((name) => name !== '')
        .toSorted(comparePlanText)
      const os: ('windows' | 'macos' | 'linux')[] = []
      const architectures: ('x64' | 'arm64')[] = []
      for (const name of rigNames) {
        const known = RIG_OS.get(slug(name).replaceAll('-', ''))
        if (known === undefined) continue
        if (!os.includes(known.os)) os.push(known.os)
        if (known.arch !== null && !architectures.includes(known.arch))
          architectures.push(known.arch)
      }
      const rigId =
        rigNames.length === 0
          ? null
          : rigNames
              .map((name) => slug(name))
              .filter((part) => part !== '')
              .join('-') || null
      const previous = lanes.get(id)
      if (previous !== undefined) {
        duplicates.add(id)
        continue
      }
      lanes.set(id, {
        id,
        short,
        mid,
        hours: lane.hours,
        state,
        pr: lane.pullRequest,
        deps: [],
        files,
        rigId,
        rigAffinity: {
          os: os.toSorted(comparePlanText),
          architectures: architectures.toSorted(comparePlanText),
        },
        startsCell: row?.starts ?? '',
        line: row?.line ?? 0,
        rigNames,
      })
      ordered.push(id)
    }
  }
  return {
    lanes,
    milestoneLanes,
    shortsByMilestone,
    duplicates,
    resolveQualified: (mid: string, token: string): string | null => {
      const short = shortsByMilestone.get(mid)?.get(token.toLowerCase())
      return short === undefined ? null : `${mid}:${short}`
    },
  }
}

/**
 * The goal's snapshot from the plan text and the captured evidence. Every
 * goal kind resolves through it: milestones, PRs, issues, labels, releases
 * and lane lists. Unknown resource demands stay explicit unknowns.
 */
export function buildPlanSnapshot(
  planText: string,
  goal: EstimateGoal,
  asOf: string,
  evidence: PlanSnapshotEvidence = {},
): EstimateGoalSnapshot {
  const parsedGoal = parseEstimate(estimateGoalSchema, goal)
  const instant = parseEstimate(estimateRequestSchema.shape.asOf, asOf)
  // readPlan's evidence carries only what the reader matches (branch names
  // and merged flags; commits stay empty: the reader never reads them).
  // Reader drift is collected with its row before goal selection; a reached
  // malformed table must never become an empty successful forecast.
  const { facts } = readPlan(planText, {
    ...(evidence.branches !== undefined && {
      branches: evidence.branches.map((branch) => ({
        name: branch.name,
        commit: '',
        merged: branch.merged,
      })),
    }),
    ...(evidence.pullRequests !== undefined && {
      pullRequests: evidence.pullRequests.map((pull) => ({
        branch: pull.branch,
        number: pull.number,
        state: pull.state,
      })),
    }),
  })
  const graph = collectPlanGraph(facts, laneTableCells(planText))
  const problems = collectPlanProblems(planText, facts, graph)
  // Phase one parses EVERY declaration, without throwing. Phase two below
  // decides which collected problems belong to the requesting closure.
  const withDeps = new Map<string, FullLane>()
  const prerequisiteMilestones = new Map<string, readonly string[]>()
  for (const lane of graph.lanes.values()) {
    const parsed = parseLaneStarts(lane, graph)
    if (!isMalformedStarts(parsed))
      prerequisiteMilestones.set(
        lane.id,
        parsed.isLast ? [...parsed.milestones, lane.mid] : parsed.milestones,
      )
    withDeps.set(lane.id, {
      ...lane,
      deps: isMalformedStarts(parsed) ? [] : expandStarts(lane, parsed, graph),
    })
  }
  const expandDeps = (id: string): readonly string[] => withDeps.get(id)?.deps ?? []

  // PRs: the plan's open PRs plus the captured evidence, matched by branch.
  const pullRequests = new Map<number, { states: Set<string>; laneIds: Set<string> }>()
  const claimPull = (number: number, state: string, laneId: string): void => {
    if (!Number.isSafeInteger(number) || number <= 0) return
    const entry = pullRequests.get(number) ?? {
      states: new Set<string>(),
      laneIds: new Set<string>(),
    }
    entry.states.add(state)
    entry.laneIds.add(laneId)
    pullRequests.set(number, entry)
  }
  const pricedLanes = graph.lanes.values()
  for (const lane of pricedLanes) {
    if (lane.pr !== null) claimPull(lane.pr, 'open', lane.id)
  }
  const readerIdByMid = new Map<string, string>()
  for (const milestone of facts.milestones) {
    const mid = canonicalMilestoneId(milestone.id)
    if (mid !== null && !readerIdByMid.has(mid)) readerIdByMid.set(mid, milestone.id)
  }
  const evidencePulls = evidence.pullRequests ?? []
  for (const pull of evidencePulls) {
    const milestoneShorts = graph.shortsByMilestone.entries()
    for (const [mid, shorts] of milestoneShorts) {
      const readerId = readerIdByMid.get(mid)
      if (readerId === undefined) continue
      const uniqueShorts = [...new Set(shorts.values())]
      const short = branchLane(pull.branch, readerId.toLowerCase(), uniqueShorts)
      if (short === null) continue
      const id = `${mid}:${short}`
      if (graph.lanes.has(id)) claimPull(pull.number, pull.state, id)
    }
  }

  const mergedPullLanes = new Set<string>()
  const openPullLanes = new Set<string>()
  for (const pull of pullRequests.values()) {
    for (const id of pull.laneIds) {
      if (pull.states.has('merged')) mergedPullLanes.add(id)
      if (pull.states.has('open')) openPullLanes.add(id)
    }
  }
  for (const id of graph.lanes.keys()) {
    const lane = graph.lanes.get(id)
    if (!(lane?.state === 'planned' && mergedPullLanes.has(id)) || openPullLanes.has(id)) {
      continue
    }

    graph.lanes.set(id, { ...lane, state: 'merged' })
    withDeps.set(id, { ...lane, state: 'merged', deps: [] })
  }

  // Issues keep their explicit lane associations; unknown lanes fall away.
  const issues = new Map<number, { labels: Set<string>; laneIds: Set<string> }>()
  const evidenceIssues = evidence.issues ?? []
  for (const issue of evidenceIssues) {
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0) continue
    const knownLaneIds = [...issue.laneIds].filter((id) => graph.lanes.has(id))
    const laneIds = new Set(knownLaneIds)
    if (laneIds.size === 0) continue
    const entry = issues.get(issue.number) ?? {
      labels: new Set<string>(),
      laneIds: new Set<string>(),
    }
    const labels = issue.labels
    for (const label of labels) {
      if (label !== '') entry.labels.add(label)
    }
    const matched = laneIds.values()
    for (const id of matched) entry.laneIds.add(id)
    issues.set(issue.number, entry)
  }

  // Releases: versioned delivery-order entries map to the milestones their
  // titles assign (0.15.0's "M95, M96, M97, M101 and M102"); prerequisites
  // (Needs) never assign membership. §10 releases without a delivery entry
  // resolve empty (nothing assigned yet).
  const releases = new Map<string, Set<string>>()
  const versionId = /^\d+\.\d+\.\d+$/
  const assignedByVersion = releaseMembers(planText)
  // Unknown release members are recorded per version: only the goal release's
  // members can block its forecast; checkPlan lists every version's.
  const releaseProblems = new Map<string, Set<string>>()
  for (const [version, assigned] of assignedByVersion) {
    if (!versionId.test(version)) continue
    for (const id of assigned) {
      if (graph.milestoneLanes.has(id)) {
        continue
      }

      const refs = releaseProblems.get(version) ?? new Set<string>()
      refs.add(`${version}:${id}`)
      releaseProblems.set(version, refs)
    }
    releases.set(version, new Set([...assigned].toSorted(comparePlanText)))
  }
  for (const release of facts.releases) {
    if (!versionId.test(release.version)) continue
    if (!releases.has(release.version)) releases.set(release.version, new Set())
  }

  const unresolved = new Map<string, Set<string>>()
  const missingRef = (code: string, reference: string): void => {
    const refs = unresolved.get(code) ?? new Set<string>()
    refs.add(reference)
    unresolved.set(code, refs)
  }
  const refuseCollected = (): void => {
    if (unresolved.size === 0) return
    refuse(
      [...unresolved]
        .toSorted(([a], [b]) => comparePlanText(a, b))
        .map(([code, refs]) => `${code}: ${[...refs].toSorted(comparePlanText).join(', ')}`)
        .join('; '),
    )
  }

  // The goal's entry points, with goal.ts's not-found semantics.
  const notFound = (): never => {
    if ('milestoneId' in parsedGoal) {
      for (const problem of problems) {
        if (problem.mid === parsedGoal.milestoneId) missingRef(problem.code, problem.reference)
      }
      refuseCollected()
    }
    let reference: string = parsedGoal.kind
    if ('milestoneId' in parsedGoal) reference = parsedGoal.milestoneId
    else if ('number' in parsedGoal) reference = String(parsedGoal.number)
    else if ('release' in parsedGoal) reference = parsedGoal.release
    throw new EstimateDiagnosticError(
      `unknown-goal: ${reference}`,
      fill(UI_TEXT.estimateNotFound, { goal: JSON.stringify(parsedGoal) }),
    )
  }
  const milestoneEntry = (id: string): string[] => graph.milestoneLanes.get(id) ?? notFound()
  let selected: string[]
  switch (parsedGoal.kind) {
    case 'milestone': {
      selected = milestoneEntry(parsedGoal.milestoneId)
      break
    }
    case 'lanes': {
      const available = milestoneEntry(parsedGoal.milestoneId)
      selected = parsedGoal.laneIds.map((short) => {
        const id = `${parsedGoal.milestoneId}:${short}`
        return available.includes(id) ? id : notFound()
      })
      break
    }
    case 'pullRequest': {
      selected = [...(pullRequests.get(parsedGoal.number)?.laneIds ?? notFound())]
      break
    }
    case 'issues': {
      selected = parsedGoal.numbers.flatMap((number) => [
        ...(issues.get(number)?.laneIds ?? notFound()),
      ])
      break
    }
    case 'label': {
      const candidates = issues.values()
      const matched: { laneIds: Set<string> }[] = []
      for (const entry of candidates) {
        if (entry.labels.has(parsedGoal.label)) matched.push(entry)
      }
      if (matched.length === 0) notFound()
      selected = matched.flatMap((entry) => [...entry.laneIds])
      break
    }
    case 'release': {
      const release = releases.get(parsedGoal.release) ?? notFound()
      selected = [...release].flatMap((id) => graph.milestoneLanes.get(id) ?? [])
      break
    }
  }

  // Strictness applies to the goal's dependency closure: every row reachable
  // from the goal must parse and resolve, or the estimate refuses naming
  // every problem at once. Rows outside the closure never block a forecast;
  // checkPlan lists the whole plan's problems instead. Completed rows bind
  // no work, so their Starts text is history and is not parsed.
  const included = new Set<string>()
  const prerequisiteClosure = new Set<string>()
  const pending = [...selected]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (included.has(id)) continue
    const lane = graph.lanes.get(id) ?? notFound()
    included.add(id)
    if (included.size > ESTIMATE_MAX_ITEMS) refuse('lane-limit')
    if (graph.duplicates.has(id)) missingRef('duplicate-lane', id)
    for (const problem of problems) {
      if (
        problem.laneId === id &&
        problem.code !== 'self-dependency' &&
        (lane.state !== 'merged' || problem.code === 'plan-drift')
      )
        missingRef(problem.code, problem.reference)
    }
    if (lane.state === 'merged') {
      continue
    }
    for (const name of lane.rigNames) {
      if (!RIG_OS.has(slug(name).replaceAll('-', '')))
        missingRef('unknown-rig', `${id}:${slug(name)}`)
    }
    const milestoneRefs = prerequisiteMilestones.get(id) ?? []
    for (const mid of milestoneRefs) prerequisiteClosure.add(mid)
    pending.push(...expandDeps(id))
  }
  if (parsedGoal.kind === 'release') {
    const releaseRefs = releaseProblems.get(parsedGoal.release) ?? []
    for (const ref of releaseRefs) {
      const code = 'unknown-release-member'
      const refs = unresolved.get(code) ?? new Set<string>()
      refs.add(ref)
      unresolved.set(code, refs)
    }
  }
  const reachedMilestones = new Set([...included].map((id) => graph.lanes.get(id)?.mid))
  const wholeMilestones = new Set(prerequisiteClosure)
  for (const mid of prerequisiteClosure) reachedMilestones.add(mid)
  if ('milestoneId' in parsedGoal) reachedMilestones.add(parsedGoal.milestoneId)
  if (parsedGoal.kind === 'milestone') wholeMilestones.add(parsedGoal.milestoneId)
  else if (parsedGoal.kind === 'release') {
    const releaseMids = releases.get(parsedGoal.release) ?? []
    for (const mid of releaseMids) {
      reachedMilestones.add(mid)
      wholeMilestones.add(mid)
    }
  }
  for (const problem of problems) {
    if (
      problem.laneId === null &&
      ((problem.mid !== null &&
        (problem.wholeOnly
          ? wholeMilestones.has(problem.mid)
          : reachedMilestones.has(problem.mid))) ||
        (problem.mid === null &&
          (/^(?:plan-format|lanes-missing|input-size)\b/.test(problem.reference) ||
            (parsedGoal.kind === 'release' && problem.releaseId === parsedGoal.release))))
    )
      missingRef(problem.code, problem.reference)
  }
  refuseCollected()

  // Completed prerequisites retain identity but bind no further work. Missing
  // unfinished hours refuse — including an explicit Hours `0`, which is not
  // an estimate but a missing one; absent historical hours on a completed
  // lane are represented as zero, without inventing an original estimate.
  const isMissing = (id: string): boolean => {
    const lane = withDeps.get(id) ?? graph.lanes.get(id)
    const hours = lane?.hours
    return lane?.state !== 'merged' && (hours == null || hours === 0)
  }
  const missing = [...included].filter((id) => isMissing(id)).toSorted(comparePlanText)
  if (missing.length > 0) {
    const shown = missing.slice(0, ESTIMATE_MISSING_DETAIL_LIMIT).join(', ')
    const rest = missing.length - ESTIMATE_MISSING_DETAIL_LIMIT
    refuse(`missing-estimate: ${shown}${rest > 0 ? ` and ${String(rest)} more` : ''}`)
  }

  const laneIds = [...included].toSorted(comparePlanText)
  return {
    asOf: instant,
    lanes: laneIds.map((id) => {
      // Every Starts cell was parsed during collection. Completed closure
      // lanes bind no further work; unfinished lanes retain every edge.
      const lane = withDeps.get(id) ?? graph.lanes.get(id)
      if (lane === undefined) refuse(`missing-estimate: ${id}`)
      if (lane.hours === null && lane.state !== 'merged') refuse(`missing-estimate: ${id}`)
      const resources = {
        slots: assumedDemand(1),
        accountRequestsPerHour: assumedDemand(1),
        accountTokensPerHour: assumedDemand(ESTIMATE_ASSUMED_TOKENS_PER_HOUR),
        accountUsdPerHour: assumedDemand(0),
        accountPercentPerHour: unknownQuantity(),
        ciJobs: assumedDemand(0),
        ciMinutes: assumedDemand(0),
        disk: [
          {
            role: 'workspace',
            peakBytes: assumedDemand(ESTIMATE_ASSUMED_PEAK_BYTES),
            steadyBytes: assumedDemand(ESTIMATE_ASSUMED_STEADY_BYTES),
          },
        ],
      }
      return {
        lane: {
          id: lane.id,
          kind: lane.short.toLowerCase(),
          estimatedHours: lane.hours ?? 0,
          elapsedAgentHours: 0,
          minimumRemainingHours: 0,
          state: lane.state,
          dependencies:
            lane.state === 'merged' ? [] : expandDeps(lane.id).filter((dep) => included.has(dep)),
          files: [...lane.files],
          affinity: { os: [], architectures: [], machineClassIds: [], gpuRequired: false },
          resources,
          review: { status: 'unknown' as const },
        },
        ...(lane.state !== 'merged' && lane.rigId !== null && { rigId: lane.rigId }),
      }
    }),
    milestones: [...graph.milestoneLanes]
      .map(([id, ids]) => ({
        id,
        laneIds: ids.filter((laneId) => included.has(laneId)).toSorted(comparePlanText),
      }))
      .toSorted((left, right) => comparePlanText(left.id, right.id)),
    pullRequests: [...pullRequests]
      .filter(([, entry]) => hasSharedLanes(entry.laneIds, included))
      .map(([number, entry]) => {
        let state: 'open' | 'closed' | 'merged' = 'closed'
        if (entry.states.has('merged')) state = 'merged'
        else if (entry.states.has('open')) state = 'open'
        return {
          number,
          state,
          laneIds: [...entry.laneIds].filter((id) => included.has(id)).toSorted(comparePlanText),
        }
      })
      .toSorted((left, right) => left.number - right.number),
    issues: [...issues]
      .map(([number, entry]) => ({
        number,
        labels: [...entry.labels].toSorted(comparePlanText),
        laneIds: [...entry.laneIds].filter((id) => included.has(id)).toSorted(comparePlanText),
      }))
      .filter((entry) => entry.laneIds.length > 0)
      .toSorted((left, right) => left.number - right.number),
    releases: [...releases]
      .map(([id, milestoneIds]) => ({
        id,
        milestoneIds: [...milestoneIds].toSorted(comparePlanText),
      }))
      .toSorted((left, right) => comparePlanText(left.id, right.id)),
    rigs: [
      ...new Set(
        laneIds.flatMap((id) => {
          const lane = withDeps.get(id)
          return lane?.state === 'merged' || lane?.rigId === null || lane?.rigId === undefined
            ? []
            : [lane.rigId]
        }),
      ),
    ]
      .map((id) => {
        const os: ('windows' | 'macos' | 'linux')[] = []
        const architectures: ('x64' | 'arm64')[] = []
        for (const laneId of laneIds) {
          const lane = withDeps.get(laneId)
          if (lane?.rigId !== id) continue
          for (const name of lane.rigAffinity.os) if (!os.includes(name)) os.push(name)
          for (const name of lane.rigAffinity.architectures)
            if (!architectures.includes(name)) architectures.push(name)
        }
        return {
          id,
          affinity: {
            os: os.toSorted(comparePlanText),
            architectures: architectures.toSorted(comparePlanText),
            machineClassIds: [],
            gpuRequired: false,
          },
        }
      })
      .toSorted((left, right) => comparePlanText(left.id, right.id)),
  }
}

interface PlanProblem {
  readonly code: string
  readonly reference: string
  readonly mid: string | null
  readonly laneId: string | null
  readonly releaseId?: string
  readonly wholeOnly?: true
}

/** Expand declared refs without throwing or discarding explicit self edges. */
function expandStarts(lane: PlanGraphLane, parsed: StartsRefs, graph: PlanGraph): string[] {
  const deps = new Set(parsed.lanes)
  for (const mid of parsed.milestones) {
    const targets = graph.milestoneLanes.get(mid) ?? []
    for (const id of targets) deps.add(id)
  }
  if (parsed.isLast) {
    const siblings = graph.milestoneLanes.get(lane.mid) ?? []
    for (const id of siblings) {
      if (id !== lane.id) deps.add(id)
    }
  }
  return [...deps].toSorted(comparePlanText)
}

/** Attach reader and identity problems to the actual plan row before any
 * goal selection. Unsupported tables still have an owning milestone. */
function collectPlanProblems(planText: string, facts: PlanFacts, graph: PlanGraph): PlanProblem[] {
  const lines = planLines(planText)
  const problems: PlanProblem[] = []
  const owners = new Map<number, { mid: string | null; laneId: string | null }>()
  let mid: string | null = null
  let section = 0
  let isLaneTable = false
  const add = (code: string, reference: string, laneId: string | null = null): void => {
    problems.push({
      code,
      reference,
      mid,
      laneId,
      ...(code === 'invalid-lane' && { wholeOnly: true }),
    })
  }
  for (const row of lines) {
    const heading = /^## (\d+)\./.exec(row.text)
    if (heading) {
      section = Number(heading[1])
      mid = null
      isLaneTable = false
    }
    const milestone = milestoneHeading(row.text)
    if (milestone === null && row.text.startsWith('### ')) mid = null
    if (milestone && section === PLAN_SECTIONS.milestones) {
      mid = canonicalMilestoneId(milestone.id)
      isLaneTable = false
    }
    let laneId: string | null = null
    if (mid !== null && row.text.trimStart().startsWith('|')) {
      const cells = tableCells(row.text)
      const first = cells[0] ?? ''
      if (first === 'Lane' || first === 'Lane / receipt') {
        isLaneTable = true
      } else if (isLaneTable && !/^[-: ]+$/.test(first)) {
        const short = canonicalLaneShort(first)
        if (short === null) add('invalid-lane', `${mid} line ${String(row.line)}`)
        else {
          laneId = `${mid}:${short}`
          if (!graph.lanes.has(laneId))
            add('plan-drift', `lanes-row line ${String(row.line)}`, laneId)
        }
      }
    } else if (row.text.trim() !== '') isLaneTable = false
    owners.set(row.line, { mid, laneId })
  }
  let laneTables = 0
  const tables = planTables(lines, [])
  for (const table of tables) {
    const owner = owners.get(table.line)
    if (
      owner?.mid !== undefined &&
      owner.mid !== null &&
      (table.columns[0] === 'Lane' || table.columns[0] === 'Lane / receipt')
    )
      laneTables += 1
  }
  if (facts.format !== 'plan-format-v1')
    problems.push({ code: 'plan-drift', reference: 'plan-format line 1', mid: null, laneId: null })
  if (laneTables === 0)
    problems.push({
      code: 'plan-drift',
      reference: 'lanes-missing line 1',
      mid: null,
      laneId: null,
    })
  for (const drift of facts.drift) {
    const owner = owners.get(drift.line) ?? { mid: null, laneId: null }
    const releaseId = /\*\*(\d+\.\d+\.\d+)/.exec(lines[drift.line - 1]?.text ?? '')?.[1]
    const reference = `${drift.code} line ${String(drift.line)}`
    if (drift.code === 'lanes-columns') {
      const table = tables.find((entry) => entry.line === drift.line)
      const rows = table?.rows ?? []
      for (const row of rows) {
        const rowOwner = owners.get(row.line) ?? owner
        problems.push({
          code: 'plan-drift',
          reference,
          ...rowOwner,
          ...(rowOwner.laneId === null && { wholeOnly: true }),
        })
      }
      if (rows.length > 0) continue
    }
    problems.push({
      code: 'plan-drift',
      reference,
      ...owner,
      ...(releaseId !== undefined && { releaseId }),
      ...((drift.code === 'lanes-columns' || drift.code === 'table-delimiter') && {
        wholeOnly: true,
      }),
    })
  }
  for (const lane of graph.lanes.values()) {
    mid = lane.mid
    if (graph.duplicates.has(lane.id)) add('duplicate-lane', lane.id, lane.id)
    const parsed = parseLaneStarts(lane, graph)
    if (isMalformedStarts(parsed))
      add('malformed-starts', parsed.malformed.replace(/^malformed-starts: /, ''), lane.id)
    else {
      for (const ref of parsed.unresolved) add('unknown-prerequisite', ref, lane.id)
      for (const ref of parsed.milestones) {
        if (!graph.milestoneLanes.has(ref)) add('unknown-prerequisite', ref, lane.id)
      }
      if (expandStarts(lane, parsed, graph).includes(lane.id))
        add('self-dependency', lane.id, lane.id)
    }
    if (lane.state !== 'merged') {
      for (const name of lane.rigNames) {
        if (!RIG_OS.has(slug(name).replaceAll('-', '')))
          add('unknown-rig', `${lane.id}:${slug(name)}`, lane.id)
      }
    }
  }
  return problems
}

/** Whole-plan diagnostics, independent of the forecast's selected closure. */
export function checkPlan(planText: string): string[] {
  const { facts } = readPlan(planText)
  const graph = collectPlanGraph(facts, laneTableCells(planText))
  const problems = new Map<string, Set<string>>()
  const collect = (code: string, reference: string): void => {
    const refs = problems.get(code) ?? new Set<string>()
    refs.add(reference)
    problems.set(code, refs)
  }
  for (const problem of collectPlanProblems(planText, facts, graph))
    collect(problem.code, problem.reference)
  const versionId = /^\d+\.\d+\.\d+$/
  for (const [version, assigned] of releaseMembers(planText)) {
    if (!versionId.test(version)) continue
    for (const id of assigned) {
      if (!graph.milestoneLanes.has(id)) collect('unknown-release-member', `${version}:${id}`)
    }
  }
  return [...problems]
    .toSorted(([a], [b]) => comparePlanText(a, b))
    .map(([code, refs]) => `${code}: ${[...refs].toSorted(comparePlanText).join(', ')}`)
}
