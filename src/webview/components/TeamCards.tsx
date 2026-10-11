// The team's transcript cards (M96 lane U2, PLAN.md D75): the delegation
// card and plan, the switch row, the "waiting for you" card, the merge card
// and each task's report row, plus the worker label a worker's own approval
// or question card carries. Every label is the panel's own chrome, drawn
// from the task, never from worker text (threat T8).

import { useState } from 'react'
import { TEAM_MERGE_DETAILS_SHOWN, UI_TEXT } from '../../shared/constants'
import { formatNumber, plural } from '../../shared/l10n/text'
import type { TeamWorkerLabel } from '../../shared/teamView'
import type { TranscriptEntry } from '../state/uiState'

export type TeamPlanEntry = Extract<TranscriptEntry, { kind: 'teamPlan' }>
export type TeamSwitchEntry = Extract<TranscriptEntry, { kind: 'teamSwitch' }>
export type TeamWaitingEntry = Extract<TranscriptEntry, { kind: 'teamWaiting' }>
export type TeamMergeEntry = Extract<TranscriptEntry, { kind: 'teamMerge' }>
export type TeamReportEntry = Extract<TranscriptEntry, { kind: 'teamReport' }>

/** The waiting card's four choices (D75): queue, the main agent, raise, cancel. */
export type TeamWaitingChoice = 'queue' | 'self' | 'raise' | 'cancel'

/** The merge card's decision: through the orchestrator's `merge` (D75). */
export type TeamMergeDecision = 'merge' | 'discard'

export interface TeamCardActions {
  readonly onAnswerWaiting: (waitingId: string, choice: TeamWaitingChoice) => void
  readonly onDecideMerge: (taskId: string, decision: TeamMergeDecision) => void
  readonly onReviewDiff: (taskId: string) => void
}

/** A switch reason as the display language says it; one not listed shows as it came. */
export function teamSwitchReasonLabel(reason: string): string {
  return (
    Object.entries(UI_TEXT.teamSwitchReasons).find(([known]) => known === reason)?.[1] ?? reason
  )
}

/** A pool entry's state as the display language says it; unknown shows as it came. */
export function teamEntryStateLabel(state: string): string {
  return Object.entries(UI_TEXT.teamEntryStates).find(([known]) => known === state)?.[1] ?? state
}

/**
 * The worker label on a worker's own card: its role, agent and task, drawn
 * by the panel, never by the worker (D75, threat T8). The names are
 * technical, so they stay spliced.
 */
export function TeamWorkerLabel({ worker }: { readonly worker: TeamWorkerLabel }) {
  const text = `${worker.roleId} · ${worker.agentLabel} · ${worker.taskId}`
  return (
    <p className="team-worker-label" title={text}>
      {text}
    </p>
  )
}

/** The delegation card: each item delegated or kept, with its rubric reason. */
export function TeamPlanCard({ entry }: { readonly entry: TeamPlanEntry }) {
  return (
    <li className="activity activity-team-plan" data-status={entry.status}>
      <span className="activity-kind">{UI_TEXT.teamPlanTitle}</span>
      <span className="activity-status">{entry.dryRun ? UI_TEXT.teamPlanDryRun : null}</span>
      <ul className="team-plan-items" aria-label={UI_TEXT.teamPlanTitle}>
        {entry.items.map((item, index) => (
          <li
            // The plan's items have no ids of their own; their order is stable.
            key={`${item.disposition}:${item.role}:${String(index)}`}
            className={`team-plan-item team-plan-${item.disposition}`}
          >
            <span className="team-plan-disposition">
              {item.disposition === 'delegated' ? UI_TEXT.teamPlanDelegated : UI_TEXT.teamPlanKept}
            </span>{' '}
            <span className="team-plan-role" dir="auto">
              {item.role}
            </span>
            {item.brief === undefined ? null : (
              <span className="team-plan-brief" dir="auto">
                {' — '}
                {item.brief}
              </span>
            )}{' '}
            <span className="team-plan-reason" dir="auto">
              ({item.reason}
              {item.entry === undefined ? null : ` · ${item.entry}`})
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}

/** One transcript row per switch: the role, from and to, and the reason. */
export function TeamSwitchRow({ entry }: { readonly entry: TeamSwitchEntry }) {
  const text = `${entry.roleId}: ${entry.fromEntry} → ${entry.toEntry} · ${teamSwitchReasonLabel(entry.reason)}`
  return (
    <li className="activity activity-team-switch" data-status={entry.status}>
      <span className="activity-kind">{entry.roleId}</span>
      <span className="activity-status" dir="auto">
        {text}
      </span>
    </li>
  )
}

/** The four choices, read when the card renders so the installed language shows. */
function waitingChoices(): readonly { choice: TeamWaitingChoice; label: string }[] {
  return [
    { choice: 'queue', label: UI_TEXT.teamWaitingQueue },
    { choice: 'self', label: UI_TEXT.teamWaitingSelf },
    { choice: 'raise', label: UI_TEXT.teamWaitingRaise },
    { choice: 'cancel', label: UI_TEXT.teamWaitingCancel },
  ]
}

/** The "waiting for you" card: every entry exhausted, the role's `ask` policy. */
export function TeamWaitingCard({
  entry,
  onAnswer,
}: {
  readonly entry: TeamWaitingEntry
  /** Absent where the host takes no answer (history): the card reads only. */
  readonly onAnswer?: TeamCardActions['onAnswerWaiting'] | undefined
}) {
  // A full host update settles this local request, including a refusal.
  const [pending, setPending] = useState<TeamWaitingEntry | undefined>(undefined)
  if (onAnswer === undefined) {
    return (
      <li className="activity activity-team-waiting" data-status={entry.status}>
        <span className="activity-kind">{UI_TEXT.teamWaitingTitle}</span>
        <span className="activity-status" dir="auto">
          {[entry.roleId, entry.brief, entry.reasonText]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </span>
      </li>
    )
  }
  const isLocked =
    entry.status !== 'inProgress' || entry.teamDecision !== undefined || pending === entry
  const answer = onAnswer
  return (
    <li className="activity activity-team-waiting" data-status={entry.status}>
      <span className="activity-kind">{UI_TEXT.teamWaitingTitle}</span>
      <span className="activity-status" dir="auto">
        {[entry.roleId, entry.brief, entry.reasonText]
          .filter((part) => part !== undefined)
          .join(' · ')}
      </span>
      <div className="team-card-actions" role="group" aria-label={UI_TEXT.teamWaitingTitle}>
        {waitingChoices().map(({ choice, label }) => (
          <button
            key={choice}
            type="button"
            className="tool-more"
            disabled={isLocked}
            onClick={() => {
              setPending(entry)
              answer(entry.waitingId, choice)
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </li>
  )
}

function MergeDetails({
  label,
  paths,
}: {
  readonly label: string
  readonly paths: readonly string[] | undefined
}) {
  if (paths === undefined) return null
  const remaining = paths.length - TEAM_MERGE_DETAILS_SHOWN
  return (
    <div className="team-merge-details">
      <span>{label}</span>
      {paths.length === 0 ? (
        <span>{UI_TEXT.teamMergeNoPaths}</span>
      ) : (
        <ul aria-label={label}>
          {paths.slice(0, TEAM_MERGE_DETAILS_SHOWN).map((path, index) => (
            <li key={`${String(index)}:${path}`} dir="auto">
              {path}
            </li>
          ))}
          {remaining > 0 ? <li>{plural(UI_TEXT.teamMergeMorePaths, remaining)}</li> : null}
        </ul>
      )}
    </div>
  )
}

/** The merge card: the user's approval point, in every mode but Plan (D75). */
export function TeamMergeCard({
  entry,
  onDecide,
  onReviewDiff,
}: {
  readonly entry: TeamMergeEntry
  /** Absent where the host takes no decision (history): the card reads only. */
  readonly onDecide?: TeamCardActions['onDecideMerge'] | undefined
  readonly onReviewDiff?: TeamCardActions['onReviewDiff'] | undefined
}) {
  const [pending, setPending] = useState<TeamMergeEntry | undefined>(undefined)
  const isLocked =
    entry.status !== 'inProgress' || entry.teamDecision !== undefined || pending === entry
  const hasDetails = entry.affectedFiles !== undefined && entry.protectedPaths !== undefined
  const decide =
    onDecide === undefined
      ? undefined
      : (decision: TeamMergeDecision) => {
          setPending(entry)
          onDecide(entry.taskId, decision)
        }
  // A reviewed merge needs no badge; the other states name themselves.
  const reviewText = {
    reviewed: undefined,
    'same-model': UI_TEXT.teamMergeSameModel,
    'not-reviewed': UI_TEXT.teamMergeNotReviewed,
  }[entry.review]
  return (
    <li className="activity activity-team-merge" data-status={entry.status}>
      <span className="activity-kind">{UI_TEXT.teamMergeTitle}</span>
      <span className="activity-status" dir="auto">
        {[
          entry.brief,
          entry.branch,
          entry.filesChanged === undefined ? undefined : formatNumber(entry.filesChanged),
          reviewText,
        ]
          .filter((part) => part !== undefined)
          .join(' · ')}
      </span>
      <MergeDetails label={UI_TEXT.teamMergeAffectedFiles} paths={entry.affectedFiles} />
      <MergeDetails label={UI_TEXT.teamMergeProtectedPaths} paths={entry.protectedPaths} />
      <MergeDetails label={UI_TEXT.teamMergeConflictPaths} paths={entry.conflictPaths} />
      {entry.reviewVerdict === undefined ? null : (
        <p className="team-card-note" dir="auto">
          {UI_TEXT.teamMergeReviewVerdict}: {entry.reviewVerdict}
        </p>
      )}
      <MergeDetails label={UI_TEXT.reviewFindingsLabel} paths={entry.reviewerFindings} />
      {hasDetails ? null : <p className="team-card-note">{UI_TEXT.teamMergeDetailsMissing}</p>}
      {entry.branchMoved === true ? (
        <p className="team-card-note">{UI_TEXT.teamMergeBranchMoved}</p>
      ) : null}
      {entry.conflicted === true ? (
        <p className="team-card-note">{UI_TEXT.teamMergeConflict}</p>
      ) : null}
      {decide === undefined && onReviewDiff === undefined ? null : (
        <div className="team-card-actions" role="group" aria-label={UI_TEXT.teamMergeTitle}>
          {decide === undefined ? null : (
            <>
              <button
                type="button"
                className="tool-more"
                disabled={
                  isLocked || !hasDetails || entry.branchMoved === true || entry.conflicted === true
                }
                onClick={() => {
                  decide('merge')
                }}
              >
                {UI_TEXT.teamMergeAction}
              </button>
              <button
                type="button"
                className="tool-more"
                disabled={isLocked}
                onClick={() => {
                  decide('discard')
                }}
              >
                {UI_TEXT.teamDiscardAction}
              </button>
            </>
          )}
          {onReviewDiff === undefined ? null : (
            <button
              type="button"
              className="tool-more"
              onClick={() => {
                onReviewDiff(entry.taskId)
              }}
            >
              {UI_TEXT.teamReviewDiff}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** A finished task's report row. */
export function TeamReportRow({ entry }: { readonly entry: TeamReportEntry }) {
  const text = [entry.brief, entry.summary].filter((part) => part !== undefined).join(' — ')
  return (
    <li className="activity activity-team-report" data-status={entry.status}>
      <span className="activity-kind">{UI_TEXT.teamReportTitle}</span>
      <span className="activity-status" dir="auto">
        {entry.roleId} · {text}
      </span>
    </li>
  )
}

/** One lazy transcript entry point; the caller supplies only team rows. */
export function TeamCard({
  entry,
  actions,
}: {
  readonly entry:
    TeamPlanEntry | TeamSwitchEntry | TeamWaitingEntry | TeamMergeEntry | TeamReportEntry
  readonly actions: TeamCardActions | undefined
}) {
  switch (entry.kind) {
    case 'teamPlan': {
      return <TeamPlanCard entry={entry} />
    }
    case 'teamSwitch': {
      return <TeamSwitchRow entry={entry} />
    }
    case 'teamWaiting': {
      return <TeamWaitingCard entry={entry} onAnswer={actions?.onAnswerWaiting} />
    }
    case 'teamMerge': {
      return (
        <TeamMergeCard
          entry={entry}
          onDecide={actions?.onDecideMerge}
          onReviewDiff={actions?.onReviewDiff}
        />
      )
    }
    case 'teamReport': {
      return <TeamReportRow entry={entry} />
    }
  }
}
