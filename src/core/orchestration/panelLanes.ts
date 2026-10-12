// The panel's lane facts before M96 (M116, PLAN.md D96.1 and D96.13; lane
// C-M116-6). A conversation that orchestrates has no board, so its trusted
// facts are the host's own: which child agents it started, which files the
// host saw each of them change, and what the journal already holds.
//
// - A module is D96.1's default: the directory two levels under the source
//   root that the changed files share. Its id is the journal's; a file set
//   that grew keeps the id through recorded lineage, so no counter resets.
// - A review is a playbook review only for files a child of the conversation
//   changed: the child implements, the conversation reviews. Files nobody's
//   child changed belong to no module, and their review stays ordinary.
// - A redesign's board is its design decision: the decision is the contract
//   the person accepted, the redesign lane starts after it.
//
// No model text enters here. Synchronous, no `vscode`.

import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import {
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_MODULE_DIRECTORY_DEPTH,
  PLAYBOOK_PANEL_TEAM,
  REVIEW_FINDINGS_MAX,
} from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import type {
  PlaybookBoard,
  PlaybookDesignDecision,
  PlaybookLane,
  PlaybookModule,
  PlaybookRecord,
  PlaybookReviewAgents,
  PlaybookRound,
} from '../../shared/playbook'
import { resolvedLongPath } from '../pathIdentity'
import type { PlaybookHookAdmission } from './playbook/outcomes'
import {
  fileIdentities,
  hasRecordedContent,
  moduleStates,
  modulePath,
  predecessorIds,
  renamedFiles,
  type ModuleState,
} from './playbook/modules'
import type { PlaybookWork } from './playbookIntegration'
import type { PanelDispatchKind, PlaybookReviewContext } from './panelPlaybook'

/** A child agent of a conversation, as the host itself recorded it. */
export interface PanelChild {
  /** The subagent's id, or a best-of-N attempt's. */
  readonly agentId: string
  /** The child's own session, never the conversation's. */
  readonly sessionId: string
  /** Workspace-relative files the host saw it change. */
  readonly files: readonly string[]
}

/** The lane a redesign runs on: the panel's own, named so no board lane collides. */
const REDESIGN_LANE_PREFIX = 'panel-redesign-'
const CONTRACTS_LANE = '0'
const REVIEWER_PREFIX = 'conversation:'

function bounded(id: string): string {
  return id.length <= PLAYBOOK_ID_MAX_CHARS ? id : createHash('sha256').update(id).digest('hex')
}

/** The conversation as a reviewer: an agent id of its own, its own session. */
export function conversationAgent(sessionId: string): string {
  return bounded(`${REVIEWER_PREFIX}${sessionId}`)
}

/** D96.1: the directory two levels under the source root; a root file is its own module. */
export function moduleKeyOf(file: string): string {
  const parts = modulePath(file).split('/')
  const name = parts.pop() ?? ''
  return parts.length === 0 ? name : parts.slice(0, PLAYBOOK_MODULE_DIRECTORY_DEPTH).join('/')
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].toSorted((a, b) => Number(a > b) - Number(a < b))
}

/** `realpath.native`; a test stands in a disk that refuses to be read. */
export type RealPath = (absolute: string) => string

/**
 * Whether nothing can say which file a path names: the path, or the nearest
 * ancestor of it that exists, cannot be read. A path that is merely missing
 * names what it spells.
 */
function isUnreadable(absolute: string, realPath: RealPath): boolean {
  let current = absolute
  for (;;) {
    try {
      realPath(current)
      return false
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return true
    }
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}

/**
 * The real path a path names, where that can be told (`resolvedLongPath`).
 * Windows gives a file a second, short name (`NAME~1`), and a missing name
 * of that shape may have stood for any long one, so nothing resolves it
 * there: undefined. Where no file system has short names, a missing name is
 * what it spells, under its nearest ancestor that resolves.
 */
function identityOf(absolute: string): string | undefined {
  const resolved = resolvedLongPath(absolute)
  if (resolved !== undefined || process.platform === 'win32') return resolved
  const parent = path.dirname(absolute)
  const above = parent === absolute ? undefined : identityOf(parent)
  return above === undefined ? undefined : path.join(above, path.basename(absolute))
}

/**
 * A path as the journal names it: the real file under the real workspace,
 * relative, with forward slashes. Links, junctions, drive spellings, 8.3
 * names and (where the file system ignores it) case are resolved first, so
 * two spellings of one file are one path here. Undefined for one answer
 * only: the path was resolved, and it is not a file of the workspace.
 * Everything else is not known to be anything, and throws, so that whoever
 * asked refuses instead of taking it for someone else's file: a path that
 * cannot be read or resolved (with that reason), and a file of the
 * workspace whose name the journal cannot hold (`modulePath`'s own refusal;
 * it reads as a secret).
 */
export function workspaceFile(
  workspaceFolder: string,
  file: string,
  realPath: RealPath = realpathSync.native,
): string | undefined {
  const root = path.resolve(workspaceFolder)
  const absolute = path.resolve(workspaceFolder, file)
  const isRead = !isUnreadable(root, realPath) && !isUnreadable(absolute, realPath)
  const folder = isRead ? identityOf(root) : undefined
  const resolved = isRead ? identityOf(absolute) : undefined
  if (folder === undefined || resolved === undefined)
    throw new Error(UI_TEXT.playbookEvidenceUnreadable)
  const relative = path.relative(folder, resolved)
  const isOutside =
    relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..'
  return isOutside ? undefined : modulePath(relative)
}

/** What two spellings of one file share: Windows names files without regard to case. */
function fileKey(file: string): string {
  return process.platform === 'win32' ? file.toLowerCase() : file
}

/**
 * The one classification of a review (D96.16), for the window and the
 * governor alike: each reviewed file that a child of the conversation
 * changed, by resolved file identity, with the child that changed it. The
 * conversation's own session is never its child. Empty: an ordinary review,
 * for which nothing else may be read. With no child's file to compare, no
 * path is resolved at all; otherwise a path that cannot be read throws
 * (`workspaceFile`), because the review cannot then be called ordinary.
 */
export function reviewedChanges(
  workspaceFolder: string,
  sessionId: string,
  files: readonly string[],
  children: readonly PanelChild[],
  realPath?: RealPath,
): { readonly file: string; readonly child: PanelChild }[] {
  const changes: { readonly file: string; readonly child: PanelChild }[] = []
  const others = children.filter((child) => child.sessionId !== sessionId && child.files.length > 0)
  if (others.length === 0) return changes
  const reviewed = new Map<string, string>()
  for (const raw of files) {
    const file = workspaceFile(workspaceFolder, raw, realPath)
    if (file !== undefined) reviewed.set(fileKey(file), file)
  }
  if (reviewed.size === 0) return changes
  for (const child of others) {
    const seen = new Set<string>()
    for (const raw of child.files) {
      const changed = workspaceFile(workspaceFolder, raw, realPath)
      const file = changed === undefined ? undefined : reviewed.get(fileKey(changed))
      if (file === undefined || seen.has(file)) continue
      seen.add(file)
      changes.push({ file, child })
    }
  }
  return changes
}

/** The journal's current module for a key: the last one declared under it. */
function moduleOfKey(states: readonly ModuleState[], key: string): ModuleState | undefined {
  return states.findLast((state) => state.module.key === key)
}

export interface PanelLaneDeps {
  /** The canonical workspace the journal is keyed by. */
  readonly workspaceFolder: string
  readonly hookAdmission: PlaybookHookAdmission
  /** The journal as the policy last published it. */
  readonly records: () => readonly PlaybookRecord[]
}

export interface PanelReviewModule extends PlaybookReviewContext {
  /** The directory keys whose findings this module's round takes. */
  readonly keys: readonly string[]
}

/**
 * Which other modules the policy will take a declaration to overlap: a
 * recorded rename from one of their files, or content it fingerprints as
 * theirs. Paths never overlap here (each module holds literal files of its
 * own directory), so only moved or copied code can link two modules.
 */
function movedFrom(
  deps: PanelLaneDeps,
  candidate: PlaybookModule,
  states: readonly ModuleState[],
  records: readonly PlaybookRecord[],
): string[] {
  const renames = renamedFiles(deps.workspaceFolder, deps.hookAdmission)
  const identities = fileIdentities(deps.workspaceFolder, candidate)
  return states
    .filter(
      (state) =>
        state.module.id !== candidate.id &&
        state.module.key !== candidate.key &&
        (renames.some(
          (rename) =>
            candidate.files.includes(rename.to) && state.historicalFiles.includes(rename.from),
        ) ||
          hasRecordedContent(records, state.module.id, identities)),
    )
    .map((state) => state.module.id)
}

/**
 * The module a set of child-changed files under one key declares. An
 * existing module keeps its id; when its file set grows it is declared again
 * as itself (`renamedFrom` its own id), which the policy counts as the same
 * module. Code moved in from another module names that module as lineage, so
 * its strikes come along instead of being left behind.
 */
function declared(
  deps: PanelLaneDeps,
  key: string,
  files: readonly string[],
  states: readonly ModuleState[],
  records: readonly PlaybookRecord[],
): PlaybookModule {
  const existing = moduleOfKey(states, key)
  const all = sorted([...(existing?.module.files ?? []), ...files])
  if (all.length > REVIEW_FINDINGS_MAX) throw new Error(UI_TEXT.playbookUnavailable)
  const candidate: PlaybookModule =
    existing === undefined
      ? { id: randomUUID(), key, files: all, source: 'directory' }
      : { ...existing.module, files: all }
  const moved = movedFrom(deps, candidate, states, records).filter(
    (id) => existing?.linked.has(id) !== true,
  )
  if (moved.length === 0) {
    return existing !== undefined && all.length !== existing.module.files.length
      ? { ...candidate, lineage: { renamedFrom: existing.module.id } }
      : candidate
  }
  // A module that took in another's code is their successor, under a new id
  // the predecessors hand their counts to.
  const predecessors = sorted([...(existing ? [existing.module.id] : []), ...moved])
  const [first] = predecessors
  if (first === undefined) throw new Error(UI_TEXT.playbookUnavailable)
  return {
    id: randomUUID(),
    key,
    files: all,
    source: 'directory',
    lineage: predecessors.length === 1 ? { splitFrom: first } : { mergedFrom: predecessors },
  }
}

/** A module's family as the policy leases it: itself, its lineage, and theirs. */
function familyOf(module: PlaybookModule, states: readonly ModuleState[]): string[] {
  const family = new Set([module.id, ...predecessorIds(module)])
  for (const state of states)
    if (family.has(state.module.id)) for (const id of state.linked) family.add(id)
  return [...family]
}

/** The journal's modules in the order they were first declared. */
function declaredStates(records: readonly PlaybookRecord[]): ModuleState[] {
  return Array.from(moduleStates(records), ([, state]) => state)
}

/**
 * The modules a review of `files` counts in: one per directory key that a
 * child of the conversation changed a reviewed file in, with linked modules
 * (one family, one lease) taken as one. Empty when no child changed any
 * reviewed file: that review is an ordinary one.
 */
export function reviewModules(
  deps: PanelLaneDeps,
  sessionId: string,
  files: readonly string[],
  children: readonly PanelChild[],
): PanelReviewModule[] {
  const byKey = new Map<string, { files: string[]; child: PanelChild }>()
  // Later children win a key: the latest change is the one under review.
  for (const { file, child } of reviewedChanges(deps.workspaceFolder, sessionId, files, children)) {
    const key = moduleKeyOf(file)
    byKey.set(key, { files: [...(byKey.get(key)?.files ?? []), file], child })
  }
  if (byKey.size === 0) return []
  const records = deps.records()
  const states = declaredStates(records)
  const modules: (PanelReviewModule & { readonly family: readonly string[] })[] = []
  for (const key of sorted(byKey.keys())) {
    const group = byKey.get(key)
    if (group === undefined) throw new Error(UI_TEXT.playbookUnavailable)
    const module = declared(deps, key, group.files, states, records)
    const family = familyOf(module, states)
    const kin = modules.findIndex((other) => other.family.some((id) => family.includes(id)))
    const relative = modules[kin]
    if (relative !== undefined) {
      // One family holds one lease: its first module takes this key's findings too.
      modules[kin] = { ...relative, keys: [...relative.keys, key] }
      continue
    }
    const agents: PlaybookReviewAgents = {
      implementerId: bounded(group.child.agentId),
      implementerSessionId: bounded(group.child.sessionId),
      reviewerId: conversationAgent(sessionId),
      reviewerSessionId: bounded(sessionId),
    }
    modules.push({ module, agents, keys: [key], family })
  }
  return modules.map(({ module, agents, keys }) => ({ module, agents, keys }))
}

/** A module's standing as the journal has it, for the conversation that reviews it. */
export interface PanelModuleStanding {
  readonly module: PlaybookModule
  /** The module's latest counted round. */
  readonly round: PlaybookRound
  readonly strikes: number
  readonly design: PlaybookDesignDecision | undefined
  readonly isEscalated: boolean
}

function isPanelRedesign(design: PlaybookDesignDecision | undefined): boolean {
  return design?.outcome === 'pending' && design.redesignLane.startsWith(REDESIGN_LANE_PREFIX)
}

/**
 * The modules a conversation has under review: those whose latest round it
 * reviewed, one per family and key (a successor stands for what it took in).
 */
export function conversationModules(
  records: readonly PlaybookRecord[],
  sessionId: string,
): PanelModuleStanding[] {
  const reviewer = bounded(sessionId)
  const states = declaredStates(records)
  const taken = new Set<string>()
  const standings: PanelModuleStanding[] = []
  for (const state of states.toReversed()) {
    const round = state.current
    if (
      round?.reviewerSessionId !== reviewer ||
      taken.has(state.module.id) ||
      moduleOfKey(states, state.module.key) !== state
    )
      continue
    for (const id of [state.module.id, ...state.linked]) taken.add(id)
    standings.push({
      module: state.module,
      round,
      strikes: state.strikes,
      design: state.design,
      isEscalated: state.escalated,
    })
  }
  return standings.toReversed()
}

/** Whether a module still owes something: findings, a redesign, or its review. */
export function isOpenModule(standing: PanelModuleStanding): boolean {
  return (
    standing.isEscalated ||
    standing.round.findings.length > 0 ||
    (standing.design !== undefined && standing.design.outcome !== 'impossible')
  )
}

/**
 * The modules a dispatch from the conversation is a fix (or redesign) round
 * on. A follow-up to a child is a round on the open modules that child
 * implemented; a new child or a best-of-N run, whose files nobody knows yet,
 * is a round on every open module of the conversation. None open: nothing
 * to govern, and the dispatch is not the playbook's.
 */
export function dispatchModules(
  records: readonly PlaybookRecord[],
  sessionId: string,
  targetId: string | undefined,
): PanelModuleStanding[] {
  const open = conversationModules(records, sessionId).filter((standing) => isOpenModule(standing))
  if (targetId === undefined) return open
  const target = bounded(targetId)
  const own = open.filter((standing) => standing.round.implementerId === target)
  return own.length > 0 ? own : open
}

function redesignLane(module: PlaybookModule, design: PlaybookDesignDecision): PlaybookLane {
  return {
    id: design.redesignLane,
    milestoneId: design.id,
    kind: 'redesign',
    module,
    starts: [CONTRACTS_LANE],
    estimateHours: 0,
    merged: false,
    reviewed: false,
    addsTestsOrGates: false,
    drills: [],
    integrationTrunk: '',
    mergedTrunks: [],
    designDecisionId: design.id,
  }
}

/** The lane id a new redesign takes. */
export function newRedesignLane(): string {
  return `${REDESIGN_LANE_PREFIX}${randomUUID()}`
}

/**
 * The panel's board: one two-lane milestone per pending redesign it
 * recorded. The design decision is the milestone's contract: it exists in
 * the journal only because the person accepted it in the panel, which is
 * what `merged` and `reviewed` say of it. No worker, no CI.
 */
export function panelBoard(records: readonly PlaybookRecord[]): PlaybookBoard {
  const seen = new Set<string>()
  const lanes: PlaybookLane[] = []
  for (const state of declaredStates(records)) {
    const design = state.design
    if (design === undefined || !isPanelRedesign(design) || seen.has(design.id)) continue
    seen.add(design.id)
    const lane = redesignLane(state.module, design)
    lanes.push(
      { ...lane, id: CONTRACTS_LANE, kind: 'contracts', starts: [], merged: true, reviewed: true },
      lane,
    )
  }
  return { lanes, mergedPrerequisites: [], workers: [], hasCi: false }
}

/**
 * The work a dispatch does on one module: a redesign lane when the module
 * has a pending decision, else a fix round. The brief is built from journal
 * facts only (the module, its open findings by id), never from the prompt.
 */
export function dispatchWork(
  kind: PanelDispatchKind,
  sessionId: string,
  targetId: string | undefined,
  standing: PanelModuleStanding,
  refs: readonly string[],
  baseCommit: string,
): PlaybookWork {
  const { module, design, round } = standing
  const findings = round.findings.map(
    (finding) =>
      `${finding.id} ${finding.severity} ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}${finding.class === undefined ? '' : ` ${finding.class}`}`,
  )
  const isRedesign = design !== undefined && isPanelRedesign(design)
  return {
    id: randomUUID(),
    module,
    ...(isRedesign && { lane: { milestoneId: design.id, id: design.redesignLane } }),
    refs,
    requester: {
      agentId: targetId === undefined ? conversationAgent(sessionId) : bounded(targetId),
      teamId: PLAYBOOK_PANEL_TEAM,
    },
    brief: {
      objective: `${isRedesign ? 'redesign' : 'fix'} ${module.key} (${kind})`,
      scope: [...module.files],
      acceptance: findings.length > 0 ? findings : [`review ${module.key}`],
      baseCommit,
    },
    commands: [{ kind: 'edit', paths: [...module.files], effect: 'write', subject: module.key }],
  }
}
