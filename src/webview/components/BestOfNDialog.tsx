// Best-of-N on the Model API (M77, PLAN.md D49): the same prompt in N
// worktrees, their diff stats side by side, and "take this one". The form
// validates the bounds before it sends; the host asks the one paid-use
// popup, runs the attempts and posts every change back. The form stays until
// the host's update brings a run other than the one on screen at Start: a
// start the host refuses (a notice, no update) leaves it to fix and retry.

import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  BEST_OF_N_MAX_ATTEMPTS,
  BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT,
  BEST_OF_N_MIN_ATTEMPTS,
  BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT,
  UI_TEXT,
} from '../../shared/constants'
import {
  defaultBestOfNRequest,
  validateBestOfNRequest,
  type BestOfNAttempt,
  type BestOfNAttemptStatus,
  type BestOfNRun,
  type BestOfNRunStatus,
  type BestOfNValidationError,
} from '../../shared/bestOfN'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import { ListBody } from './ListBody'

export interface BestOfNDialogProps {
  /** undefined until the first run of this window starts. */
  readonly run: BestOfNRun | undefined
  /** False while the `bestOfN` paid feature is off: the host would refuse. */
  readonly isPaidOn: boolean
  readonly defaultPrompt: string
  readonly onStart: (prompt: string, attempts: number, requestCeilingPerAttempt: number) => void
  readonly onTake: (attemptId: string) => void
  readonly onOpen: (attemptId: string) => void
  readonly onCancelRun: () => void
  readonly onClose: () => void
}

function attemptStatusWord(status: BestOfNAttemptStatus): string {
  switch (status) {
    case 'queued': {
      return UI_TEXT.bestOfNStatusQueued
    }
    case 'running': {
      return UI_TEXT.bestOfNStatusRunning
    }
    case 'completed': {
      return UI_TEXT.bestOfNStatusCompleted
    }
    case 'failed': {
      return UI_TEXT.bestOfNStatusFailed
    }
    case 'cancelled': {
      return UI_TEXT.bestOfNStatusCancelled
    }
  }
}

function runStatusWord(status: BestOfNRunStatus): string {
  switch (status) {
    case 'running': {
      return UI_TEXT.bestOfNRunStatusRunning
    }
    case 'completed': {
      return UI_TEXT.bestOfNRunStatusCompleted
    }
    case 'failed': {
      return UI_TEXT.bestOfNRunStatusFailed
    }
    case 'cancelled': {
      return UI_TEXT.bestOfNRunStatusCancelled
    }
  }
}

function fieldError(
  errors: readonly BestOfNValidationError[],
  field: BestOfNValidationError,
): string | undefined {
  if (!errors.includes(field)) {
    return undefined
  }
  switch (field) {
    case 'prompt': {
      return UI_TEXT.bestOfNInvalidPrompt
    }
    case 'attempts': {
      return fill(UI_TEXT.bestOfNInvalidAttempts, {
        min: formatNumber(BEST_OF_N_MIN_ATTEMPTS),
        max: formatNumber(BEST_OF_N_MAX_ATTEMPTS),
      })
    }
    case 'ceiling': {
      return fill(UI_TEXT.bestOfNInvalidCeiling, {
        min: formatNumber(BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT),
        max: formatNumber(BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT),
      })
    }
  }
}

function attemptMeta(attempt: BestOfNAttempt): string {
  const parts = [plural(UI_TEXT.bestOfNRequests, attempt.requestsMade)]
  if (attempt.ceilingReached) {
    parts.push(UI_TEXT.bestOfNCeilingReached)
  }
  if (attempt.approvalsDenied > 0) {
    parts.push(plural(UI_TEXT.bestOfNApprovalsDenied, attempt.approvalsDenied))
  }
  if (attempt.status === 'failed' && attempt.failureReason !== undefined) {
    parts.push(fill(UI_TEXT.bestOfNAttemptFailed, { reason: attempt.failureReason }))
  }
  return parts.join(' · ')
}

function AttemptRow({
  attempt,
  canTake,
  onTake,
  onOpen,
}: {
  readonly attempt: BestOfNAttempt
  readonly canTake: boolean
  readonly onTake: () => void
  readonly onOpen: () => void
}) {
  return (
    <li className="palette-item bestofn-attempt">
      <span className="palette-item-text">
        <span className="palette-item-label">
          {attempt.branch}
          <span className="badge">{attemptStatusWord(attempt.status)}</span>
        </span>
        <span className="palette-item-detail">{attemptMeta(attempt)}</span>
        <span className="palette-item-detail">
          {plural(UI_TEXT.boardChanges, attempt.files.length)}
        </span>
      </span>
      <span className="bestofn-actions">
        {canTake && attempt.status === 'completed' ? (
          <button
            type="button"
            className="button-secondary"
            onClick={onTake}
            aria-label={`${UI_TEXT.bestOfNTake}: ${attempt.branch}`}
          >
            {UI_TEXT.bestOfNTake}
          </button>
        ) : null}
        {attempt.status === 'queued' ? null : (
          <button
            type="button"
            className="button-secondary"
            onClick={onOpen}
            aria-label={`${UI_TEXT.worktreeOpen}: ${attempt.branch}`}
          >
            {UI_TEXT.worktreeOpen}
          </button>
        )}
      </span>
    </li>
  )
}

/** One side's attempt picker: the left and right selects share it. */
function CompareSelect({
  id,
  label,
  value,
  attempts,
  onSelect,
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly attempts: readonly BestOfNAttempt[]
  readonly onSelect: (attemptId: string) => void
}) {
  return (
    <div>
      <label className="bestofn-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onSelect(event.target.value)
        }}
      >
        {attempts.map((attempt) => (
          <option key={attempt.attemptId} value={attempt.attemptId}>
            {attempt.branch}
          </option>
        ))}
      </select>
    </div>
  )
}

function ComparePane({
  attempt,
  side,
}: {
  readonly attempt: BestOfNAttempt
  readonly side: string
}) {
  return (
    <div className="bestofn-pane">
      <h3 className="bestofn-pane-title">
        {side}: {attempt.branch}
      </h3>
      {attempt.diff === undefined ? (
        <p className="menu-empty">{plural(UI_TEXT.boardChanges, attempt.files.length)}</p>
      ) : (
        <>
          <pre className="bestofn-diff">{attempt.diff}</pre>
          {attempt.isDiffClipped === true ? (
            <p className="menu-empty">{UI_TEXT.bestOfNDiffClipped}</p>
          ) : null}
        </>
      )}
    </div>
  )
}

export function BestOfNDialog(props: BestOfNDialogProps) {
  const { run, isPaidOn, defaultPrompt } = props
  const { onStart, onTake, onCancelRun, onClose } = props
  const [isFormOpen, setFormOpen] = useState(run === undefined)
  // The run on screen when Start was pressed; the host accepted once another arrives.
  const [startedOver, setStartedOver] = useState<{ readonly runId: string | undefined }>()
  const isStartAccepted =
    startedOver !== undefined && run !== undefined && run.runId !== startedOver.runId
  const initial = useMemo(() => defaultBestOfNRequest(defaultPrompt), [defaultPrompt])
  const [prompt, setPrompt] = useState(initial.prompt)
  const [attemptsText, setAttemptsText] = useState(String(initial.attempts))
  const [ceilingText, setCeilingText] = useState(String(initial.requestCeilingPerAttempt))
  const [leftId, setLeftId] = useState<string | undefined>(undefined)
  const [rightId, setRightId] = useState<string | undefined>(undefined)

  const attempts = Number(attemptsText)
  const ceiling = Number(ceilingText)
  const errors = validateBestOfNRequest({ prompt, attempts, requestCeilingPerAttempt: ceiling })
  const promptError = fieldError(errors, 'prompt')
  const attemptsError = fieldError(errors, 'attempts')
  const ceilingError = fieldError(errors, 'ceiling')

  const completed = useMemo(
    () => (run?.runAttempts ?? []).filter((attempt) => attempt.status === 'completed'),
    [run],
  )
  const left = completed.find((attempt) => attempt.attemptId === leftId) ?? completed[0]
  const right = completed.find((attempt) => attempt.attemptId === rightId) ?? completed[1]

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    onClose()
  }

  const form = (
    <>
      <label className="bestofn-label" htmlFor="bestofn-prompt">
        {UI_TEXT.bestOfNPromptLabel}
      </label>
      <textarea
        id="bestofn-prompt"
        className="bestofn-prompt"
        value={prompt}
        autoFocus
        rows={3}
        aria-invalid={promptError !== undefined}
        aria-describedby={promptError === undefined ? undefined : 'bestofn-prompt-error'}
        onChange={(event) => {
          setPrompt(event.target.value)
        }}
      />
      {promptError === undefined ? null : (
        <p id="bestofn-prompt-error" className="menu-empty">
          {promptError}
        </p>
      )}
      <div className="bestofn-numbers">
        <div>
          <label className="bestofn-label" htmlFor="bestofn-attempts">
            {UI_TEXT.bestOfNAttemptsLabel}
          </label>
          <input
            id="bestofn-attempts"
            className="bestofn-number"
            type="number"
            min={BEST_OF_N_MIN_ATTEMPTS}
            max={BEST_OF_N_MAX_ATTEMPTS}
            value={attemptsText}
            aria-invalid={attemptsError !== undefined}
            aria-describedby={attemptsError === undefined ? undefined : 'bestofn-attempts-error'}
            onChange={(event) => {
              setAttemptsText(event.target.value)
            }}
          />
          {attemptsError === undefined ? null : (
            <p id="bestofn-attempts-error" className="menu-empty">
              {attemptsError}
            </p>
          )}
        </div>
        <div>
          <label className="bestofn-label" htmlFor="bestofn-ceiling">
            {UI_TEXT.bestOfNCeilingLabel}
          </label>
          <input
            id="bestofn-ceiling"
            className="bestofn-number"
            type="number"
            min={BEST_OF_N_MIN_REQUESTS_PER_ATTEMPT}
            max={BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT}
            value={ceilingText}
            aria-invalid={ceilingError !== undefined}
            aria-describedby={ceilingError === undefined ? undefined : 'bestofn-ceiling-error'}
            onChange={(event) => {
              setCeilingText(event.target.value)
            }}
          />
          {ceilingError === undefined ? null : (
            <p id="bestofn-ceiling-error" className="menu-empty">
              {ceilingError}
            </p>
          )}
        </div>
      </div>
      {isPaidOn ? null : <p className="menu-empty">{UI_TEXT.bestOfNPaidOff}</p>}
      <button
        type="button"
        className="button-primary"
        disabled={errors.length > 0 || !isPaidOn}
        onClick={() => {
          onStart(prompt.trim(), attempts, ceiling)
          setStartedOver({ runId: run?.runId })
        }}
      >
        {UI_TEXT.bestOfNStart}
      </button>
    </>
  )

  const compare =
    run === undefined || completed.length === 0 ? null : (
      <div className="bestofn-compare">
        <div className="bestofn-selects">
          <CompareSelect
            id="bestofn-left"
            label={UI_TEXT.bestOfNLeftPane}
            value={left?.attemptId ?? ''}
            attempts={completed}
            onSelect={setLeftId}
          />
          <CompareSelect
            id="bestofn-right"
            label={UI_TEXT.bestOfNRightPane}
            value={right?.attemptId ?? ''}
            attempts={completed}
            onSelect={setRightId}
          />
        </div>
        <div className="bestofn-panes">
          {left === undefined ? null : (
            <ComparePane attempt={left} side={UI_TEXT.bestOfNLeftPane} />
          )}
          {right === undefined || right.attemptId === left?.attemptId ? null : (
            <ComparePane attempt={right} side={UI_TEXT.bestOfNRightPane} />
          )}
        </div>
      </div>
    )

  const runView =
    run === undefined ? null : (
      <>
        <p className="palette-item-detail">{UI_TEXT.bestOfNTakeExplanation}</p>
        <p className="palette-item-detail">
          {runStatusWord(run.status)}
          {run.takenBranch === undefined
            ? null
            : ` · ${fill(UI_TEXT.bestOfNTakenMark, { branch: run.takenBranch })}`}
        </p>
        <ul className="palette-list">
          {run.runAttempts.map((attempt) => (
            <AttemptRow
              key={attempt.attemptId}
              attempt={attempt}
              canTake={run.takenBranch === undefined}
              onTake={() => {
                onTake(attempt.attemptId)
              }}
              onOpen={() => {
                props.onOpen(attempt.attemptId)
              }}
            />
          ))}
        </ul>
        {run.status === 'running' ? (
          <button type="button" className="button-secondary" onClick={onCancelRun} autoFocus>
            {UI_TEXT.bestOfNCancelRun}
          </button>
        ) : (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setPrompt(run.prompt)
              setStartedOver(undefined)
              setFormOpen(true)
            }}
            autoFocus
          >
            {UI_TEXT.bestOfNStart}
          </button>
        )}
        {compare}
      </>
    )

  return (
    <div
      className="palette history"
      role="dialog"
      aria-label={UI_TEXT.bestOfNTitle}
      onKeyDown={onDialogKeyDown}
    >
      <div className="palette-header">
        <h2 className="bestofn-title">{UI_TEXT.bestOfNTitle}</h2>
      </div>
      <ListBody>{isFormOpen && !isStartAccepted ? form : runView}</ListBody>
    </div>
  )
}
