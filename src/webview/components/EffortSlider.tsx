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
import { effortLabel, isEffortLevel, type CatalogueTiers } from '../../shared/effort'
import { fill } from '../../shared/l10n/text'

/**
 * The slider's catalogue path for one row (C-M106-3R3): the panel footer and
 * the palette share this, so the captured variants and default reach the
 * rendered tiers through the model list the controller sends. Undefined
 * where the row carries no catalogue, and the slider falls back to the
 * family table. A tier outside the extension's vocabulary renders with its
 * catalogue name; selecting one stays the caller's typed path.
 */
export function catalogueSliderProps(
  source: CatalogueTiers | undefined,
  current: string,
  onSelectTier: (tier: string) => void,
):
  | (CatalogueTiers & { readonly current: string; readonly onSelect: (tier: string) => void })
  | undefined {
  if (source?.variants === undefined) return undefined
  return {
    variants: source.variants,
    ...(source.reasoningEffortVariants !== undefined && {
      reasoningEffortVariants: source.reasoningEffortVariants.map((variant) =>
        variant.description === undefined
          ? { tier: variant.tier }
          : { tier: variant.tier, description: variant.description },
      ),
    }),
    ...(source.defaultReasoningEffort !== undefined && {
      defaultReasoningEffort: source.defaultReasoningEffort,
    }),
    current,
    onSelect: onSelectTier,
  }
}

export interface EffortSliderProps {
  readonly levels: readonly EffortLevel[]
  readonly current: EffortLevel
  /** Undefined renders the dots read-only. */
  readonly onSelect: ((level: EffortLevel) => void) | undefined
  /** In a row that is itself the control: dots for the mouse only. */
  readonly isInsideOption?: boolean
  /** Lane W supplies the validated Muse Code catalogue through the shared bridge. */
  readonly model?:
    | (CatalogueTiers & {
        readonly current?: string
        readonly onSelect?: (tier: string) => void
      })
    | undefined
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
  const hasCatalogue = variants !== undefined
  const selected = hasCatalogue ? (model?.current ?? model?.defaultReasoningEffort) : current
  const steps = hasCatalogue
    ? (variants === 'unknown' ? [] : variants).map((tier) => {
        const description = model?.reasoningEffortVariants?.find(
          (variant) => variant.tier === tier,
        )?.description
        if (!isEffortLevel(tier)) {
          // A tier outside the extension's vocabulary renders with its
          // catalogue name, disabled, and says why in its tooltip and
          // accessible name (RVCM1063C #2/#6).
          const unsupported = fill(UI_TEXT.effortTierUnsupported, { tier: description ?? tier })
          return { tier, label: unsupported, select: undefined }
        }
        return {
          tier,
          label: description ?? effortLabel(tier),
          select:
            model?.onSelect === undefined || !levels.includes(tier)
              ? undefined
              : () => {
                  model.onSelect?.(tier)
                },
        }
      })
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

/** The Modes footer and its labels load only with the effort control. */
export function EffortMenuFooter({
  catalogue,
  ...props
}: EffortSliderProps & {
  readonly catalogue: CatalogueTiers | undefined
}) {
  return (
    <div className="effort-row">
      <span className="effort-row-label">
        {UI_TEXT.effortItem} ({effortLabel(props.current)})
      </span>
      <EffortSlider
        {...props}
        model={catalogueSliderProps(catalogue, props.current, (tier) => {
          if (isEffortLevel(tier)) props.onSelect?.(tier)
        })}
      />
    </div>
  )
}
