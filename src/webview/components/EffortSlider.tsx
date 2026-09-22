// The effort "dots": one per tier the current model serves, filled up to the
// selected one. Each dot names its tier in a tooltip and to assistive
// technology. Used by the "/" palette row and the Modes menu footer.

import { EFFORT_LABELS, type EffortLevel } from '../../shared/constants'
import { effortIndex } from '../../shared/effort'

export interface EffortSliderProps {
  readonly levels: readonly EffortLevel[]
  readonly current: EffortLevel
  /** Undefined renders the dots read-only. */
  readonly onSelect: ((level: EffortLevel) => void) | undefined
}

export function EffortSlider({ levels, current, onSelect }: EffortSliderProps) {
  const currentIndex = effortIndex(levels, current)
  return (
    <span className="palette-slider" role="group" aria-label="Effort">
      {levels.map((level, index) => (
        <button
          key={level}
          type="button"
          className={index <= currentIndex ? 'slider-step slider-step-on' : 'slider-step'}
          title={EFFORT_LABELS[level]}
          aria-label={EFFORT_LABELS[level]}
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
