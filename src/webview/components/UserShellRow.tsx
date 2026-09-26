// The user's own shell command, the TUI's `!` (M46, PLAN.md D39): what they
// ran, how it ended (its exit code or signal, and how long it took) and what
// it printed, which opens whole in an editor tab as a tool's output does
// (M15). It runs outside any turn, so a turn's end leaves it alone. Where
// the backend can stop one (the Model API's; Muse Code names no task for
// it), a running command has a Stop.

import { memo } from 'react'
import { UI_TEXT, USER_SHELL_PREFIX } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatDurationMs } from '../agentFormat'
import { failedOutcomeText, isFailedStatus, type UserShellEntry } from '../state/uiState'
import { Clipped } from './ToolBlocks'
import { statusDotClass, type ToolRowProps } from './ToolRow'

export interface UserShellRowProps {
  readonly entry: UserShellEntry
  /** The backend can stop the user's own commands (the Model API's). */
  readonly canStop: boolean
  readonly onOpenOutput: ToolRowProps['onOpenOutput']
  readonly onStopTask: (itemId: string) => void
}

/** "Exit code 3 · 1s": how the command ended, as far as the host said. */
function endLine(entry: UserShellEntry): string | undefined {
  const parts = [
    entry.exitCode === undefined
      ? undefined
      : fill(UI_TEXT.userShellExitCode, { code: String(entry.exitCode) }),
    entry.exitSignal === undefined
      ? undefined
      : fill(UI_TEXT.userShellExitSignal, { signal: String(entry.exitSignal) }),
    entry.durationMs === undefined ? undefined : formatDurationMs(entry.durationMs),
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function UserShellRowView({ entry, canStop, onOpenOutput, onStopTask }: UserShellRowProps) {
  const isRunning = entry.status === 'inProgress'
  const command = `${USER_SHELL_PREFIX}${entry.command}`
  const ended = endLine(entry)
  const openOutput = () => {
    onOpenOutput(entry.id, UI_TEXT.userShellLabel, entry.output, entry.outputRef?.id)
  }
  return (
    <li
      className="tool user-shell"
      data-status={entry.status}
      data-entry-id={entry.id}
      data-role="tool"
    >
      <div className="tool-header">
        <span className="user-shell-title">
          <span className={statusDotClass(entry.status)} aria-hidden="true" />
          <span className="tool-label">{UI_TEXT.userShellLabel}</span>
          <code className="user-shell-command" dir="ltr">
            {command}
          </code>
        </span>
        {isRunning && canStop ? (
          <button
            type="button"
            className="tool-more tool-task-action"
            aria-label={`${UI_TEXT.stopTask}: ${command}`}
            title={UI_TEXT.stopUserShellTitle}
            disabled={entry.taskRequest !== undefined}
            onClick={() => {
              onStopTask(entry.id)
            }}
          >
            {UI_TEXT.stopTask}
          </button>
        ) : null}
      </div>
      {ended === undefined ? null : <div className="tool-change">{ended}</div>}
      {isFailedStatus(entry.status) && entry.failureReason !== undefined ? (
        <div className="tool-failure">
          {failedOutcomeText(entry.status)}: {entry.failureReason}
        </div>
      ) : null}
      {entry.output === '' ? null : (
        <div className="tool-body">
          <div className="shell">
            <div className="shell-box">
              <span className="shell-label">{UI_TEXT.outLabel}</span>
              <Clipped text={entry.output} className="shell-out" onOpen={openOutput} />
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

/** Memoised like the tool rows (M25): it renders only when its entry changes. */
export const UserShellRow = memo(UserShellRowView)
