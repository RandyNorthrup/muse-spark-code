// The session goal (M45, PLAN.md D38), pinned above the composer while the
// conversation has one: the objective, its status in words, a progress bar,
// what the agent is doing now and next, and Muse Code's verbs as buttons
// (pause or resume, change the objective, clear). What each button asks
// comes back from the host as `goalChanged`, so the strip only ever shows
// the goal the backend holds.

import { type KeyboardEvent, type SubmitEvent, useEffect, useRef, useState } from 'react'
import type { SessionGoal } from '../../shared/agentEvents'
import { GOAL_STATUS, type GoalCommandVerb, UI_TEXT } from '../../shared/constants'
import { fill, formatPercent } from '../../shared/l10n/text'
import { goalStatusLabel } from '../toolPresentation'
import { GoalBar, GoalWork } from './GoalParts'

export interface GoalPanelProps {
  readonly goal: SessionGoal | undefined
  /** Behind a modal (M25). */
  readonly isInert?: boolean
  /** A verb for the host; `edit` carries the new objective. */
  readonly onCommand: (verb: GoalCommandVerb, objective?: string) => void
}

// The statuses that stopped the goal short of done, shown alike.
const STOPPED_STATUSES: ReadonlySet<string> = new Set([
  GOAL_STATUS.blocked,
  GOAL_STATUS.usageLimited,
  GOAL_STATUS.budgetLimited,
])

/**
 * The dot beside the status, as a tool row's: working, done or stopped; a
 * paused goal, or a status Muse Code adds later, keeps the plain dot. The
 * status is always in words beside it.
 */
function dotClass(status: string): string {
  if (status === GOAL_STATUS.active) {
    return 'tool-dot tool-dot-running'
  }
  if (status === GOAL_STATUS.complete) {
    return 'tool-dot tool-dot-ok'
  }
  return STOPPED_STATUSES.has(status) ? 'tool-dot tool-dot-failed' : 'tool-dot'
}

function ObjectiveForm({
  objective,
  onSave,
  onCancel,
}: {
  readonly objective: string
  readonly onSave: (objective: string) => void
  readonly onCancel: () => void
}) {
  const [draft, setDraft] = useState(objective)
  const inputRef = useRef<HTMLInputElement>(null)
  // The field takes the focus as it opens, with the text selected to retype.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (draft.trim() !== '') {
      onSave(draft.trim())
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    // Escape closes the field, not the panel's menus behind it.
    event.preventDefault()
    event.stopPropagation()
    onCancel()
  }
  return (
    <form className="goal-edit" onSubmit={submit}>
      <input
        ref={inputRef}
        className="question-input goal-edit-input"
        type="text"
        dir="auto"
        aria-label={UI_TEXT.goalEditLabel}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="tool-more" disabled={draft.trim() === ''}>
        {UI_TEXT.goalEditSave}
      </button>
      <button type="button" className="tool-more" onClick={onCancel}>
        {UI_TEXT.goalEditCancel}
      </button>
    </form>
  )
}

export function GoalPanel({ goal, isInert = false, onCommand }: GoalPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  // A field closed from inside gives the focus back to Edit, not to the page.
  const focusReturn = useRef(false)
  useEffect(() => {
    if (isEditing || !focusReturn.current) {
      return
    }
    focusReturn.current = false
    editRef.current?.focus()
  }, [isEditing])
  if (goal === undefined) {
    return null
  }
  const isActive = goal.status === GOAL_STATUS.active
  const isPaused = goal.status === GOAL_STATUS.paused
  // Only an active or paused goal can be changed (MSP `invalid_goal_state`).
  const canEdit = isActive || isPaused
  const isFormShown = isEditing && canEdit
  const percent = goal.percentComplete
  const closeForm = () => {
    focusReturn.current = true
    setIsEditing(false)
  }
  const save = (objective: string) => {
    closeForm()
    if (objective !== goal.objective) {
      onCommand('edit', objective)
    }
  }
  return (
    <section className="goal" aria-label={UI_TEXT.goalStripLabel} inert={isInert}>
      <div className="goal-head">
        <span className="goal-title">{UI_TEXT.goalTitle}</span>
        <span className={dotClass(goal.status)} aria-hidden="true" />
        <span className="goal-status">{goalStatusLabel(goal.status)}</span>
        <span className="goal-percent">
          {fill(UI_TEXT.goalPercent, { percent: formatPercent(percent) })}
        </span>
        <div className="goal-controls">
          {isActive ? (
            <button
              type="button"
              className="tool-more"
              title={UI_TEXT.goalPauseTitle}
              onClick={() => {
                onCommand('pause')
              }}
            >
              {UI_TEXT.goalPause}
            </button>
          ) : null}
          {isPaused ? (
            <button
              type="button"
              className="tool-more"
              title={UI_TEXT.goalResumeTitle}
              onClick={() => {
                onCommand('resume')
              }}
            >
              {UI_TEXT.goalResume}
            </button>
          ) : null}
          {canEdit ? (
            <button
              ref={editRef}
              type="button"
              className="tool-more"
              title={UI_TEXT.goalEditTitle}
              aria-expanded={isFormShown}
              onClick={() => {
                setIsEditing(!isFormShown)
              }}
            >
              {UI_TEXT.goalEdit}
            </button>
          ) : null}
          <button
            type="button"
            className="tool-more"
            title={UI_TEXT.goalClearTitle}
            onClick={() => {
              setIsEditing(false)
              onCommand('clear')
            }}
          >
            {UI_TEXT.goalClear}
          </button>
        </div>
      </div>
      {isFormShown ? (
        <ObjectiveForm objective={goal.objective} onSave={save} onCancel={closeForm} />
      ) : (
        <div className="goal-objective" dir="auto">
          {goal.objective}
        </div>
      )}
      <GoalBar percent={percent} />
      {goal.currentWork === undefined && goal.nextWork === undefined ? null : (
        <GoalWork currentWork={goal.currentWork} nextWork={goal.nextWork} />
      )}
    </section>
  )
}
