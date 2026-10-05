// The team's item-to-row mapping (M96 lane U2, PLAN.md D75): host items of
// the team kinds become the transcript's cards. Exported so tests exercise
// the mapping directly; `uiState`'s `entryFor`/`mergeItem` delegate here so
// the mapping has one home. An item of a team kind without its card payload
// keeps today's `item` row, so a shape that differs costs the card, never
// the row (D36: shown as it came, never dropped).

import type { ItemSnapshot } from '../../shared/agentEvents'
import { TEAM_ITEM_KINDS } from '../../shared/teamView'
import type { TranscriptEntry } from './transcriptEntries'

/** A team item's card, or undefined when the item carries no card payload. */
export function teamEntryForItem(item: ItemSnapshot): TranscriptEntry | undefined {
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
        review: item.teamMerge.review,
        branchMoved: item.teamMerge.branchMoved,
        conflicted: item.teamMerge.conflicted,
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
 * its status. The confirmed answer (`teamDecision`) travels in the status
 * the host reports.
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
  return fresh ?? { ...entry, status: item.status }
}
