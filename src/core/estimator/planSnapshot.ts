// The estimator's plan snapshot (M117 C-M117-1, PLAN.md D97.2): the shared
// core adapter every host's snapshot binding reads. It projects one bounded
// EstimateGoalSnapshot from M113's readPlan (lane tables, Starts, rigs,
// files, the delivery order, §10 releases) plus git merged-lane state plus
// PR/issue evidence, for the requesting goal only. It performs no IO: the
// host gathers the plan text and the already-captured evidence.
//
// Scoping keeps the snapshot inside ESTIMATE_MAX_ITEMS and makes missing
// hour estimates fail loudly: lanes without hours are left out, and a goal
// whose transitive closure needs one is refused naming the lanes, instead
// of estimating a silently partial DAG. Milestone-level Starts refs expand
// to that milestone's unfinished lanes; prose fragments that name boards,
// audits or tools (not lanes) are outside the DAG and ignored. Metered
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
const STOPWORD = /^(?:and|lane|lanes|merge|merges|merged)$/i

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
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
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
}

/** The same lane-table bodies M113's reader walks, with its table guards. */
function laneTableCells(text: string): Map<string, Map<string, LaneCells>> {
  const tables = new Map<string, Map<string, LaneCells>>()
  const lines = planLines(text)
  const laneColumns = new Set([
    'Lane',
    'Lane / receipt',
    'Scope',
    'Items',
    'Owns',
    'Own files',
    'Shared files (region)',
    'Files it owns',
    'Its regions in shared files',
    'Starts',
    'Rig',
    'Hours',
    'Current state',
    'Muse implementation ownership',
    'Codex review / acceptance focus',
    'Review focus',
    'Muse owns',
    'Codex review focus',
    'Adds',
  ])
  let section = 0
  let milestone: string | null = null
  let body: PlanLine[] = []
  const flush = (): void => {
    if (milestone !== null) {
      const rows = tables.get(milestone) ?? new Map<string, LaneCells>()
      for (const { columns, rows: tableRows } of planTables(body, [])) {
        if (
          (columns[0] !== 'Lane' && columns[0] !== 'Lane / receipt') ||
          columns.some((column) => !laneColumns.has(column)) ||
          new Set(columns).size !== columns.length
        )
          continue
        const startsIndex = columns.indexOf('Starts')
        const rigIndex = columns.indexOf('Rig')
        const fileIndexes = columns.flatMap((column, index) =>
          FILE_COLUMNS.has(column) ? [index] : [],
        )
        for (const row of tableRows) {
          const cells = tableCells(row.text)
          if (cells.length !== columns.length) continue
          const id = (cells[0] ?? '').replaceAll(/[*`]/g, '').split(/\s+/, 1)[0] ?? ''
          if (id === '') continue
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
}

/** Lane and milestone refs in one Starts cell, against the plan's own ids. */
function parseStartsRefs(
  cell: string,
  shorts: ReadonlyMap<string, string>,
  resolveQualified: (mid: string, token: string) => string | null,
  self: string,
): StartsRefs {
  const lanes = new Set<string>()
  const milestoneRefs = new Set<string>()
  const claim = (token: string): void => {
    if (STOPWORD.test(token)) return
    const milestoneMatch = /^M([1-9]\d*[a-z\d]*)$/i.exec(token)
    if (milestoneMatch?.[1]) {
      const canonical = `M${milestoneMatch[1].toLowerCase()}`
      if (canonical !== self) milestoneRefs.add(canonical)
      return
    }
    const short = shorts.get(token.toLowerCase())
    if (short !== undefined) lanes.add(`${self}:${short}`)
  }
  for (const clause of cell.split(';')) {
    const trimmed = clause.trim()
    if (trimmed === '' || /^(?:first|last)$/i.test(trimmed)) continue
    let scope = trimmed
    // M-qualified lanes first ("M100 lanes E, S and G", "M98 2j", "M110t's TP2"):
    // a name that is no known lane of that milestone is a milestone ref.
    scope = scope.replaceAll(
      /\bM([1-9]\d*[a-z\d]*)(?:'s)?(?:\s+lanes?)?\s+([A-Za-z\d]+(?:\s*(?:,|and)\s*[A-Za-z\d]+)*)/gi,
      (_span: string, mid: string, names: string) => {
        const canonical = `M${mid.toLowerCase()}`
        for (const token of names.split(/\s*(?:,|and)\s*/)) {
          if (token === '' || STOPWORD.test(token)) continue
          const resolved = resolveQualified(canonical, token)
          if (resolved !== null) lanes.add(resolved)
          else if (canonical !== self) milestoneRefs.add(canonical)
        }
        return ' '
      },
    )
    // Bare milestone refs in what remains ("with M96 merged", "M96c merge").
    const bareRefs = scope.matchAll(/\bM([1-9]\d*[a-z\d]*)(?:'s)?\b/gi)
    for (const match of bareRefs) {
      const canonical = `M${(match[1] ?? '').toLowerCase()}`
      if (canonical !== self) milestoneRefs.add(canonical)
    }
    // Lane lists after after/with ("after 0 and C") and lane keywords.
    const laneLists = scope.matchAll(
      /(?:\bafter\b|\bwith\b|\blanes?\b)\s+([A-Za-z\d]+(?:\s*(?:,|and)\s*[A-Za-z\d]+)*)/gi,
    )
    for (const match of laneLists) {
      const tokens = (match[1] ?? '').split(/\s*(?:,|and)\s*/)
      for (const token of tokens) {
        if (token !== '') claim(token)
      }
    }
  }
  return {
    lanes: [...lanes].toSorted(comparePlanText),
    milestones: [...milestoneRefs].toSorted(comparePlanText),
  }
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
  const parsedGoal = estimateGoalSchema.parse(goal)
  const instant = estimateRequestSchema.shape.asOf.parse(asOf)
  // readPlan's evidence carries only what the reader matches (branch names
  // and merged flags; commits stay empty: the reader never reads them).
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
  const cells = laneTableCells(planText)

  // The full lane graph, including hour-less lanes the closure check rejects.
  const lanes = new Map<string, FullLane & { startsCell: string }>()
  const milestoneLanes = new Map<string, string[]>()
  const shortsByMilestone = new Map<string, Map<string, string>>()
  for (const milestone of facts.milestones) {
    const mid = canonicalMilestoneId(milestone.id)
    if (mid === null) continue
    const rows = cells.get(milestone.id) ?? new Map<string, LaneCells>()
    const shorts = new Map<string, string>()
    for (const lane of milestone.lanes) {
      const lower = lane.id.toLowerCase()
      if (!shorts.has(lower)) shorts.set(lower, lane.id)
      if (lane.id === '0' && !shorts.has('l0')) shorts.set('l0', lane.id)
    }
    shortsByMilestone.set(mid, shorts)
    const isTerminal = TERMINAL_MILESTONES.has(milestone.status)
    const ordered = milestoneLanes.get(mid) ?? []
    milestoneLanes.set(mid, ordered)
    for (const lane of milestone.lanes) {
      const id = `${mid}:${lane.id}`
      const row = rows.get(lane.id)
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
      const startsCell = row?.starts ?? ''
      const previous = lanes.get(id)
      if (previous !== undefined) {
        // Two tables reuse an owner letter (M91): merge the declarations.
        // Hours add (both bodies of work); the least-done state wins.
        let mergedState: FullLane['state'] = 'planned'
        if (state === 'merged' && previous.state === 'merged') mergedState = 'merged'
        else if (state === 'running' || previous.state === 'running') mergedState = 'running'
        lanes.set(id, {
          ...previous,
          hours:
            previous.hours === null || lane.hours === null ? null : previous.hours + lane.hours,
          state: mergedState,
          pr: previous.pr ?? lane.pullRequest,
          files: [...new Set([...previous.files, ...files])].toSorted(comparePlanText),
          rigId: previous.rigId ?? rigId,
          startsCell: [previous.startsCell, startsCell].filter((part) => part !== '').join('; '),
        })
        continue
      }
      lanes.set(id, {
        id,
        short: lane.id,
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
        startsCell,
      })
      ordered.push(id)
    }
  }

  // Starts deps resolve against the whole plan; milestone refs expand to the
  // milestone's unfinished lanes (finished ones bind nothing).
  const resolveQualified = (mid: string, token: string): string | null => {
    const short = shortsByMilestone.get(mid)?.get(token.toLowerCase())
    return short === undefined ? null : `${mid}:${short}`
  }
  const withDeps = new Map<string, FullLane>()
  const allLanes = lanes.values()
  for (const lane of allLanes) {
    const refs = parseStartsRefs(
      lane.startsCell,
      shortsByMilestone.get(lane.mid) ?? new Map<string, string>(),
      resolveQualified,
      lane.mid,
    )
    const deps = new Set<string>(refs.lanes)
    const milestoneRefs = refs.milestones
    for (const ref of milestoneRefs) {
      const targets = milestoneLanes.get(ref) ?? []
      for (const id of targets) {
        const target = lanes.get(id)
        if (target !== undefined && target.state !== 'merged') deps.add(id)
      }
    }
    deps.delete(lane.id)
    withDeps.set(lane.id, {
      ...lane,
      deps: [...deps].toSorted(comparePlanText),
    })
  }

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
  const pricedLanes = withDeps.values()
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
    const milestoneShorts = shortsByMilestone.entries()
    for (const [mid, shorts] of milestoneShorts) {
      const readerId = readerIdByMid.get(mid)
      if (readerId === undefined) continue
      const uniqueShorts = [...new Set(shorts.values())]
      const short = branchLane(pull.branch, readerId.toLowerCase(), uniqueShorts)
      if (short === null) continue
      const id = `${mid}:${short}`
      if (withDeps.has(id)) claimPull(pull.number, pull.state, id)
    }
  }

  // Issues keep their explicit lane associations; unknown lanes fall away.
  const issues = new Map<number, { labels: Set<string>; laneIds: Set<string> }>()
  const evidenceIssues = evidence.issues ?? []
  for (const issue of evidenceIssues) {
    if (!Number.isSafeInteger(issue.number) || issue.number <= 0) continue
    const knownLaneIds = [...issue.laneIds].filter((id) => withDeps.has(id))
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

  // Releases: versioned delivery-order entries map to their milestones; §10
  // releases without a delivery entry resolve empty (nothing assigned yet).
  const releases = new Map<string, Set<string>>()
  const versionId = /^\d+\.\d+\.\d+$/
  for (const entry of facts.deliveryOrder) {
    if (!versionId.test(entry.id)) continue
    const known = new Set(
      entry.needs.filter((id) => milestoneLanes.has(canonicalMilestoneId(id) ?? '')),
    )
    const canonical = [...known]
      .map((id) => canonicalMilestoneId(id) ?? id)
      .toSorted(comparePlanText)
    releases.set(entry.id, new Set(canonical))
  }
  for (const release of facts.releases) {
    if (!versionId.test(release.version)) continue
    if (!releases.has(release.version)) releases.set(release.version, new Set())
  }

  // The goal's entry points, with goal.ts's not-found semantics.
  const notFound = (): never => {
    throw new Error(fill(UI_TEXT.estimateNotFound, { goal: JSON.stringify(parsedGoal) }))
  }
  const milestoneEntry = (id: string): string[] => milestoneLanes.get(id) ?? notFound()
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
      selected = [...release].flatMap((id) => milestoneLanes.get(id) ?? [])
      break
    }
  }

  // The transitive closure; merged lanes bind nothing further. An hour-less
  // lane in the closure refuses the read instead of a partial estimate.
  const included = new Set<string>()
  const pending = [...selected]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (included.has(id)) continue
    const lane = withDeps.get(id) ?? notFound()
    included.add(id)
    if (included.size > ESTIMATE_MAX_ITEMS) refuse('lane-limit')
    if (lane.state !== 'merged') pending.push(...lane.deps)
  }
  const isMissing = (id: string): boolean => {
    const hours = withDeps.get(id)?.hours
    return hours === null || hours === undefined
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
      const lane = withDeps.get(id)
      if (lane === undefined) refuse(`missing-estimate: ${id}`)
      if (lane.hours === null) refuse(`missing-estimate: ${id}`)
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
          estimatedHours: lane.hours,
          elapsedAgentHours: 0,
          minimumRemainingHours: 0,
          state: lane.state,
          dependencies:
            lane.state === 'merged'
              ? []
              : lane.deps
                  .filter((dep) => dep !== lane.id && included.has(dep))
                  .toSorted(comparePlanText),
          files: [...lane.files],
          affinity: { os: [], architectures: [], machineClassIds: [], gpuRequired: false },
          resources,
          review: { status: 'unknown' as const },
        },
        ...(lane.rigId !== null && { rigId: lane.rigId }),
      }
    }),
    milestones: [...milestoneLanes]
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
          return lane?.rigId === null || lane?.rigId === undefined ? [] : [lane.rigId]
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
