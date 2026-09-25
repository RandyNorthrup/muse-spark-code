// The effort "dots": one per tier the current model serves, filled up to the
// selected one. Each dot names its tier in a tooltip and to assistive
// technology. Used by the "/" palette row and the Modes menu footer.
//
// Inside a palette row (an ARIA option) the dots must not be controls of
// their own: a button nested in an option is still reachable by assistive
// technology, whatever its tabindex (WCAG 4.1.2, M37). There they are a
// picture for the mouse, hidden from assistive technology, and the row
// itself carries the value ("Effort (Extra high)") and takes Left / Right.

import { type EffortLevel, UI_TEXT } from '../../shared/constants'
import { effortIndex, effortLabel } from '../../shared/effort'

export interface EffortSliderProps {
  readonly levels: readonly EffortLevel[]
  readonly current: EffortLevel
  /** Undefined renders the dots read-only. */
  readonly onSelect: ((level: EffortLevel) => void) | undefined
  /** In a row that is itself the control: dots for the mouse only. */
  readonly isInsideOption?: boolean
}

function stepClass(index: number, currentIndex: number): string {
  return index <= currentIndex ? 'slider-step slider-step-on' : 'slider-step'
}

export function EffortSlider({ levels, current, onSelect, isInsideOption }: EffortSliderProps) {
  const currentIndex = effortIndex(levels, current)
  if (isInsideOption === true) {
    return (
      <span className="palette-slider" aria-hidden="true">
        {levels.map((level, index) => (
          <span
            key={level}
            className={stepClass(index, currentIndex)}
            title={effortLabel(level)}
            onClick={(event) => {
              event.stopPropagation()
              onSelect?.(level)
            }}
          />
        ))}
      </span>
    )
  }
  return (
    <span className="palette-slider" role="group" aria-label={UI_TEXT.effortItem}>
      {levels.map((level, index) => (
        <button
          key={level}
          type="button"
          className={stepClass(index, currentIndex)}
          title={effortLabel(level)}
          aria-label={effortLabel(level)}
          aria-pressed={level === current}
          disabled={onSelect === undefined}
          tabIndex={-1}
          onMouseDown={(event) => {
            // Keep focus in the menu or filter box that owns the keyboard.
            event.preventDefault()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onSelect?.(level)
          }}
        />
      ))}
    </span>
  )
}
