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
import { effortLabel, isEffortLevel } from '../../shared/effort'

export interface EffortSliderProps {
  readonly levels: readonly EffortLevel[]
  readonly current: EffortLevel
  /** Undefined renders the dots read-only. */
  readonly onSelect: ((level: EffortLevel) => void) | undefined
  /** In a row that is itself the control: dots for the mouse only. */
  readonly isInsideOption?: boolean
  /** Lane W supplies the validated Muse Code catalogue through the shared bridge. */
  readonly model?: {
    readonly variants: readonly string[] | 'unknown'
    readonly reasoningEffortVariants?: readonly {
      readonly tier: string
      readonly description?: string
    }[]
    readonly defaultReasoningEffort?: string
    readonly current?: string
    readonly onSelect?: (tier: string) => void
  }
}

function stepClass(index: number, currentIndex: number): string {
  return index <= currentIndex ? 'slider-step slider-step-on' : 'slider-step'
}

export function EffortSlider({
  levels,
  current,
  onSelect,
  isInsideOption,
  model,
}: EffortSliderProps) {
  const variants = model?.variants
  const hasCatalogue = variants !== undefined && variants !== 'unknown'
  const selected = hasCatalogue ? (model?.current ?? model?.defaultReasoningEffort) : current
  const steps = hasCatalogue
    ? variants.map((tier) => ({
        tier,
        label:
          model?.reasoningEffortVariants?.find((variant) => variant.tier === tier)?.description ??
          (isEffortLevel(tier) ? effortLabel(tier) : tier),
        select:
          model?.onSelect === undefined
            ? undefined
            : () => {
                model.onSelect?.(tier)
              },
      }))
    : levels.map((tier) => ({
        tier,
        label: effortLabel(tier),
        select:
          onSelect === undefined
            ? undefined
            : () => {
                onSelect(tier)
              },
      }))
  const currentIndex = steps.findIndex((step) => step.tier === selected)
  if (isInsideOption === true) {
    return (
      <span className="palette-slider" aria-hidden="true">
        {steps.map((step, index) => (
          <span
            key={step.tier}
            className={stepClass(index, currentIndex)}
            title={step.label}
            onClick={(event) => {
              event.stopPropagation()
              step.select?.()
            }}
          />
        ))}
      </span>
    )
  }
  return (
    <span className="palette-slider" role="group" aria-label={UI_TEXT.effortItem}>
      {steps.map((step, index) => (
        <button
          key={step.tier}
          type="button"
          className={stepClass(index, currentIndex)}
          title={step.label}
          aria-label={step.label}
          aria-pressed={step.tier === selected}
          disabled={step.select === undefined}
          tabIndex={-1}
          onMouseDown={(event) => {
            // Keep focus in the menu or filter box that owns the keyboard.
            event.preventDefault()
          }}
          onClick={(event) => {
            event.stopPropagation()
            step.select?.()
          }}
        />
      ))}
    </span>
  )
}
