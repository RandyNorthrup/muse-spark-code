import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { SequenceRunView } from '../../shared/sequences'

export interface SequenceRunRowProps {
  readonly run: SequenceRunView
  readonly onStop: () => void
}

/** The run above the composer (M88, PLAN.md D67): which sequence, which step, with Stop. */
export function SequenceRunRow(props: SequenceRunRowProps) {
  return (
    <div className="sequence-run" role="status">
      <p>
        {fill(UI_TEXT.sequenceRunning, {
          name: props.run.name,
          step: props.run.step,
          total: props.run.total,
        })}
      </p>
      <button
        type="button"
        onClick={() => {
          props.onStop()
        }}
      >
        {UI_TEXT.sequenceStop}
      </button>
    </div>
  )
}
