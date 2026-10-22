// Handoff execution (M120 lane H, PLAN.md D103 and D212): safe points,
// stopping the tree, capturing work, the resume brief and the chain record.
//
// A move (return-to-preferred, stall, time box, cap, refusal, the user) or
// a recall never loses work: the worker stops at a safe point, the capture
// names the commits, the diff, the new files and the progress note by
// reference (never the bytes), and the next candidate resumes from the
// record's chain. Pure: work arrives as references and states, never by
// reading a repository here.

import { UI_TEXT, fill } from '../../shared/l10n/text'
import {
  teamCapturedWorkSchema,
  teamHandoffRecordSchema,
  type TeamCapturedWork,
  type TeamChainEntry,
  type TeamHandoffRecord,
  type TeamMoveTrigger,
  type TeamRecallEnding,
} from '../../shared/teamHandoff'

/** What the worker reports when it stops: its task, attempt and captured work. */
export interface StoppedWork {
  readonly taskId: string
  readonly roleId: string
  readonly attemptNumber: number
  readonly endedAtMs: number
  readonly commits: readonly string[]
  readonly diffRef?: string | undefined
  readonly newFiles: readonly string[]
  readonly noteRef?: string | undefined
  readonly ending: TeamRecallEnding
}

/** A task rests at a safe point between observable steps: never mid-write. */
export function isSafePoint(state: string): boolean {
  return ['ready', 'blocked', 'done', 'retired'].includes(state)
}

/** The capture the stop stores: references only, never the bytes themselves. */
export function captureWork(stopped: StoppedWork): TeamCapturedWork {
  return teamCapturedWorkSchema.parse({
    commits: [...stopped.commits],
    ...(stopped.diffRef !== undefined && { diffRef: stopped.diffRef }),
    newFiles: [...stopped.newFiles],
    ...(stopped.noteRef !== undefined && { noteRef: stopped.noteRef }),
  })
}

/** Appends one move link to the task's chain, oldest first. */
export function chainMove(
  record: TeamHandoffRecord | undefined,
  taskId: string,
  roleId: string,
  atMs: number,
  trigger: TeamMoveTrigger,
  fromCandidateId: string,
  toCandidateId: string,
  work: TeamCapturedWork,
): TeamHandoffRecord {
  const chain: TeamChainEntry[] = [...(record?.chain ?? [])]
  const entry: TeamChainEntry = {
    kind: 'move',
    atMs,
    trigger,
    fromCandidateId,
    toCandidateId,
    work,
  }
  const last = chain.at(-1)
  if (last !== undefined && entry.atMs < last.atMs) {
    throw new Error('team:chainOrder')
  }
  chain.push(entry)
  return teamHandoffRecordSchema.parse({ taskId, roleId, chain })
}

/** Appends one recall link to the task's chain. */
export function chainRecall(
  record: TeamHandoffRecord | undefined,
  taskId: string,
  roleId: string,
  atMs: number,
  candidateId: string,
  mainRole: string,
  ending: TeamRecallEnding,
  work?: TeamCapturedWork,
): TeamHandoffRecord {
  const chain: TeamChainEntry[] = [...(record?.chain ?? [])]
  const entry: TeamChainEntry = {
    kind: 'recall',
    atMs,
    candidateId,
    mainRole,
    ending,
    ...(work !== undefined && { work }),
  }
  const last = chain.at(-1)
  if (last !== undefined && entry.atMs < last.atMs) {
    throw new Error('team:chainOrder')
  }
  chain.push(entry)
  return teamHandoffRecordSchema.parse({ taskId, roleId, chain })
}

/** The resume brief the next candidate reads: what moved, why, and where the work is. */
export function resumeBrief(record: TeamHandoffRecord, toCandidateId: string): string {
  const last = record.chain.at(-1)
  if (last === undefined) {
    return fill(UI_TEXT.teamResumeBriefEmpty, {
      task: record.taskId,
      candidate: toCandidateId,
    })
  }
  if (last.kind === 'borrow') {
    return fill(UI_TEXT.teamResumeBriefBorrow, {
      task: record.taskId,
      candidate: toCandidateId,
      lender: last.candidateId,
      role: last.borrowingRole,
    })
  }
  if (last.kind === 'recall') {
    return fill(UI_TEXT.teamResumeBriefRecall, {
      task: record.taskId,
      candidate: toCandidateId,
      ending: last.ending,
      diff: last.work?.diffRef ?? UI_TEXT.teamResumeBriefNoDiff,
      commits: last.work?.commits.join(', ') ?? UI_TEXT.teamResumeBriefNoCommits,
      files: last.work?.newFiles.join(', ') ?? UI_TEXT.teamResumeBriefNoFiles,
    })
  }
  return fill(UI_TEXT.teamResumeBriefMove, {
    task: record.taskId,
    candidate: toCandidateId,
    from: last.fromCandidateId,
    trigger: last.trigger,
    diff: last.work.diffRef ?? UI_TEXT.teamResumeBriefNoDiff,
    commits: last.work.commits.join(', ') || UI_TEXT.teamResumeBriefNoCommits,
    files: last.work.newFiles.join(', ') || UI_TEXT.teamResumeBriefNoFiles,
  })
}
