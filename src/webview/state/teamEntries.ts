// The team's item-to-row mapping (M96 lane U2, PLAN.md D75): host items of
// the team kinds become the transcript's cards. Exported so tests exercise
// the mapping directly; `uiState`'s `entryFor`/`mergeItem` delegate here so
// the mapping has one home. An item of a team kind without its card payload
// keeps today's `item` row, so a shape that differs costs the card, never
// the row (D36: shown as it came, never dropped).

import { UI_TEXT } from '../../shared/constants'
import { agentStatusLabel } from '../agentFormat'
import type { TeamTreeData, TeamWorker } from '../../shared/teamView'
import type { ItemSnapshot } from '../../shared/agentEvents'
import { TEAM_ITEM_KINDS } from '../../shared/teamView'
import type { TranscriptEntry } from './transcriptEntries'

type TeamTranscriptEntry = Extract<
  TranscriptEntry,
  { kind: 'teamPlan' | 'teamSwitch' | 'teamWaiting' | 'teamMerge' | 'teamReport' }
>

/** A team item's card, or undefined when the item carries no card payload. */
export function teamEntryForItem(item: ItemSnapshot): TeamTranscriptEntry | undefined {
  if (!TEAM_ITEM_KINDS.has(item.kind)) {
    return undefined
  }
  switch (item.kind) {
    case 'teamPlan': {
      if (item.teamPlan === undefined) {
        return undefined
      }
      return {
        kind: 'teamPlan',
        id: item.itemId,
        status: item.status,
        items: item.teamPlan.items,
        dryRun: item.teamPlan.dryRun,
      }
    }
    case 'teamSwitch': {
      if (item.teamSwitch === undefined) {
        return undefined
      }
      return {
        kind: 'teamSwitch',
        id: item.itemId,
        status: item.status,
        roleId: item.teamSwitch.roleId,
        fromEntry: item.teamSwitch.fromEntry,
        toEntry: item.teamSwitch.toEntry,
        reason: item.teamSwitch.reason,
      }
    }
    case 'teamWaiting': {
      if (item.teamWaiting === undefined) {
        return undefined
      }
      return {
        kind: 'teamWaiting',
        id: item.itemId,
        status: item.status,
        waitingId: item.teamWaiting.waitingId,
        roleId: item.teamWaiting.roleId,
        brief: item.teamWaiting.brief,
        reasonText: item.teamWaiting.reasonText,
        teamDecision: item.teamDecision,
      }
    }
    case 'teamMerge': {
      if (item.teamMerge === undefined) {
        return undefined
      }
      return {
        kind: 'teamMerge',
        id: item.itemId,
        status: item.status,
        taskId: item.teamMerge.taskId,
        roleId: item.teamMerge.roleId,
        brief: item.teamMerge.brief,
        branch: item.teamMerge.branch,
        filesChanged: item.teamMerge.filesChanged,
        affectedFiles: item.teamMerge.affectedFiles,
        protectedPaths: item.teamMerge.protectedPaths,
        conflictPaths: item.teamMerge.conflictPaths,
        reviewVerdict: item.teamMerge.reviewVerdict,
        reviewerFindings: item.teamMerge.reviewerFindings,
        review: item.teamMerge.review,
        branchMoved: item.teamMerge.branchMoved,
        conflicted: item.teamMerge.conflicted,
        teamDecision: item.teamDecision,
      }
    }
    case 'teamReport': {
      if (item.teamReport === undefined) {
        return undefined
      }
      return {
        kind: 'teamReport',
        id: item.itemId,
        status: item.status,
        taskId: item.teamReport.taskId,
        roleId: item.teamReport.roleId,
        brief: item.teamReport.brief,
        summary: item.teamReport.summary,
      }
    }
    default: {
      return undefined
    }
  }
}

/**
 * Fold a full item re-emission into its card: the host's latest status and
 * payload win; a re-emission without the payload keeps the card and moves
 * its status and confirmed answer (`teamDecision`).
 */
export function mergeTeamEntry(
  entry: TranscriptEntry,
  item: ItemSnapshot,
): TranscriptEntry | undefined {
  if (
    entry.kind !== 'teamPlan' &&
    entry.kind !== 'teamSwitch' &&
    entry.kind !== 'teamWaiting' &&
    entry.kind !== 'teamMerge' &&
    entry.kind !== 'teamReport'
  ) {
    return undefined
  }
  const fresh = teamEntryForItem({ ...item, itemId: entry.id, kind: entry.kind })
  const updated = fresh ?? entry
  if (updated.kind === 'teamWaiting' || updated.kind === 'teamMerge') {
    return {
      ...updated,
      status: item.status,
      teamDecision: item.teamDecision ?? ('teamDecision' in entry ? entry.teamDecision : undefined),
    }
  }
  return { ...updated, status: item.status }
}

/** Queued, interrupted and unknown states never imply active execution. */
export function isRunningTeamWorker(status: string): boolean {
  return ['running', 'inProgress', 'waitingForApproval'].includes(status)
}

export function isFinishedTeamWorker(status: string): boolean {
  return [
    'done',
    'completed',
    'merged',
    'discarded',
    'failed',
    'cancelled',
    'capped',
    'interrupted',
  ].includes(status)
}

/** Known team statuses are panel words; preserve future statuses as supplied. */
export function teamWorkerStatusLabel(status: string): string {
  switch (status) {
    case 'running': {
      return UI_TEXT.agentStatuses.inProgress
    }
    case 'done': {
      return UI_TEXT.agentStatuses.completed
    }
    case 'capped': {
      return UI_TEXT.teamEntryStates.capped
    }
    case 'merged': {
      return UI_TEXT.teamWorkerMerged
    }
    case 'discarded': {
      return UI_TEXT.teamWorkerDiscarded
    }
    case 'waitingForApproval': {
      return UI_TEXT.approvalDockLabel
    }
    default: {
      return agentStatusLabel(status)
    }
  }
}

/** All task nodes, including those outside a pool entry. */
export function teamWorkers(tree: TeamTreeData): readonly TeamWorker[] {
  return tree.roles.flatMap((role) => [
    ...role.entries.flatMap((entry) => entry.workers),
    ...role.queued,
    ...role.unmerged,
    ...role.interrupted,
  ])
}

export function teamTaskCount(tree: TeamTreeData): number {
  return teamWorkers(tree).length
}

export function teamRunningTaskCount(tree: TeamTreeData): number {
  return tree.roles.reduce(
    (total, role) =>
      total +
      role.entries.reduce(
        (sum, entry) =>
          sum + entry.workers.filter((worker) => isRunningTeamWorker(worker.status)).length,
        0,
      ),
    0,
  )
}
