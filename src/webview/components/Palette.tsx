// The "/" command palette: a filter box over grouped rows, some carrying a
// value, a toggle or the effort slider, plus the model list as a second view.
// Fully keyboard-operable: the filter input keeps focus, Up/Down move,
// Enter activates, Left/Right step the slider, Esc goes back or closes.
//
// Attached (M38): a "/" typed on an empty prompt shows the palette above the
// composer with no filter box of its own. The prompt keeps the focus and
// hands its keys over through `keys`; its `aria-activedescendant` follows
// `onActiveRowChange`.

import {
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { UI_TEXT } from '../../shared/constants'
import { effortAt, effortIndex } from '../../shared/effort'
import { fill } from '../../shared/l10n/text'
import {
  contextWindowLabel,
  filterPalette,
  formatTokenWindow,
  type PaletteAction,
  type PaletteGroup,
  type PaletteItem,
  type PaletteWidget,
} from '../../shared/palette'
import type { ModelOption } from '../../shared/protocol'
import { formatUsd } from '../../core/usage/insights'
import { scrollRowIntoView, wrapIndex } from '../listNavigation'
import { EffortSlider } from './EffortSlider'
import { BackIcon, CheckIcon } from './icons'
import { ListBody } from './ListBody'

export type PaletteView = 'actions' | 'models'

export interface PaletteProps {
  readonly view: PaletteView
  readonly groups: readonly PaletteGroup[]
  readonly models: readonly ModelOption[]
  readonly currentModelId: string | undefined
  readonly onAction: (action: PaletteAction) => void
  readonly onSelectModel: (modelId: string) => void
  readonly onBack: () => void
  readonly onClose: () => void
  /** Shown by a "/" in the prompt, which keeps the focus and the keys (M38). */
  readonly isAttached?: boolean
  /** Where the prompt sends its keys while the palette is attached. */
  readonly keys?: Ref<PaletteKeys>
  /** The active row's element id, for the prompt's aria-activedescendant. */
  readonly onActiveRowChange?: (elementId: string | undefined) => void
}

/** The palette's keyboard, for a prompt that keeps the focus (M38). */
export interface PaletteKeys {
  /** True when the key was the palette's (its default is then prevented). */
  readonly didHandleKey: (event: KeyboardEvent<HTMLElement>) => boolean
}

/** One selectable row, in display order. */
export interface PaletteRow {
  readonly id: string
  readonly label: string
  readonly detail: string | undefined
  readonly widget: PaletteWidget | undefined
  readonly isCurrent: boolean
  readonly activate: () => void
  /** Present on the effort row: Left/Right and the step buttons. */
  readonly step: ((index: number) => void) | undefined
}

/** What the actions view renders: titles, disabled notes and rows. */
export type PaletteEntry =
  | { readonly kind: 'title'; readonly key: string; readonly title: string }
  | { readonly kind: 'disabled'; readonly key: string; readonly item: PaletteItem }
  | { readonly kind: 'row'; readonly key: string; readonly index: number }

const ROW_ID_PREFIX = 'palette-row-'
export const PALETTE_LISTBOX_ID = 'palette-listbox'

function rowFor(item: PaletteItem, onAction: (action: PaletteAction) => void): PaletteRow {
  const { action, widget } = item
  if (action.type === 'setEffort' && widget?.kind === 'slider') {
    const { levels } = widget
    const current = effortIndex(levels, action.effort)
    const step = (index: number) => {
      onAction({ type: 'setEffort', effort: effortAt(levels, index) })
    }
    return {
      id: item.id,
      label: item.label,
      detail: item.detail,
      widget,
      isCurrent: false,
      // Enter steps up and wraps, so the row is usable without arrow keys.
      activate: () => {
        step((current + 1) % levels.length)
      },
      step,
    }
  }
  return {
    id: item.id,
    label: item.label,
    detail: item.detail,
    widget: item.widget,
    isCurrent: false,
    activate: () => {
      onAction(action)
    },
    step: undefined,
  }
}

/** Lays the filtered groups out as entries plus the parallel row list. */
export function layoutActions(
  groups: readonly PaletteGroup[],
  onAction: (action: PaletteAction) => void,
): { readonly entries: readonly PaletteEntry[]; readonly rows: readonly PaletteRow[] } {
  const entries: PaletteEntry[] = []
  const rows: PaletteRow[] = []
  for (const group of groups) {
    entries.push({ kind: 'title', key: `title:${group.id}`, title: group.title })
    for (const item of group.items) {
      if (item.isDisabled === true) {
        entries.push({ kind: 'disabled', key: `disabled:${item.id}`, item })
        continue
      }
      entries.push({ kind: 'row', key: item.id, index: rows.length })
      rows.push(rowFor(item, onAction))
    }
  }
  return { entries, rows }
}

/** How a price reads in the picker: the pair, `unpriced`, `local` or `plan`. */
function priceText(model: ModelOption): string | undefined {
  switch (model.pricing) {
    case 'priced': {
      return model.inputUsdPerMTokens === undefined || model.outputUsdPerMTokens === undefined
        ? undefined
        : fill(UI_TEXT.pickerPricePair, {
            input: formatUsd(model.inputUsdPerMTokens),
            output: formatUsd(model.outputUsdPerMTokens),
          })
    }
    case 'unpriced': {
      return UI_TEXT.modelUnpriced
    }
    case 'local': {
      return UI_TEXT.modelLocal
    }
    case 'plan': {
      return UI_TEXT.modelPlan
    }
    case undefined: {
      return undefined
    }
  }
}

/** "{window} context · {price}", either half alone, or nothing to say. */
function modelDetail(model: ModelOption): string | undefined {
  const { contextLimit } = model
  const price = priceText(model)
  if (contextLimit === undefined) {
    return price
  }
  if (price === undefined) {
    return contextWindowLabel(contextLimit)
  }
  // The template names the unit itself, so the window goes in bare (M95).
  return fill(UI_TEXT.pickerModelDetail, { window: formatTokenWindow(contextLimit), price })
}

/** One provider's models in the picker's models view, in first-seen order. */
export interface ModelSection {
  readonly key: string
  readonly title: string
  readonly rows: readonly PaletteRow[]
}

/**
 * The models view's sections (M95): pinned favourites first, then one group
 * per provider (Meta's own models under their own name). Pure, so the panel
 * and its tests share it.
 */
export function modelSections(
  models: readonly ModelOption[],
  currentModelId: string | undefined,
  onSelectModel: (modelId: string) => void,
): readonly ModelSection[] {
  const rowFor = (model: ModelOption): PaletteRow => ({
    id: `model:${model.modelId}`,
    label: model.displayLabel,
    detail: modelDetail(model),
    widget: undefined,
    isCurrent: model.modelId === currentModelId,
    activate: () => {
      onSelectModel(model.modelId)
    },
    step: undefined,
  })
  const pinned = models.filter((model) => model.isPinned === true)
  const rest = models.filter((model) => model.isPinned !== true)
  const sections: ModelSection[] = []
  if (pinned.length > 0) {
    sections.push({
      key: 'pinned',
      title: UI_TEXT.pickerPinnedGroup,
      rows: pinned.map((model) => rowFor(model)),
    })
  }
  const groups = new Map<string, { readonly title: string; readonly rows: PaletteRow[] }>()
  for (const model of rest) {
    const key = model.providerId ?? 'meta'
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        title: model.providerLabel ?? UI_TEXT.pickerMetaGroup,
        rows: [rowFor(model)],
      })
    } else {
      group.rows.push(rowFor(model))
    }
  }
  for (const [key, group] of groups) {
    sections.push({ key, title: group.title, rows: group.rows })
  }
  return sections
}

/** The models view's footer: the provider quick-pick and the panel (M95). */
export function providerRows(onAction: (action: PaletteAction) => void): readonly PaletteRow[] {
  return [
    {
      id: 'addModelProvider',
      label: UI_TEXT.addModelProviderRow,
      detail: undefined,
      widget: undefined,
      isCurrent: false,
      activate: () => {
        onAction({ type: 'addModelProvider' })
      },
      step: undefined,
    },
    {
      id: 'manageModels',
      label: UI_TEXT.manageModelsRow,
      detail: undefined,
      widget: undefined,
      isCurrent: false,
      activate: () => {
        onAction({ type: 'manageModels' })
      },
      step: undefined,
    },
  ]
}

function Widget({
  widget,
  onStep,
}: {
  readonly widget: PaletteWidget
  readonly onStep: ((index: number) => void) | undefined
}) {
  switch (widget.kind) {
    case 'value': {
      return <span className="palette-value">{widget.text}</span>
    }
    case 'toggle': {
      return (
        <span
          className={widget.isOn ? 'toggle toggle-on' : 'toggle'}
          role="switch"
          aria-checked={widget.isOn}
          aria-label={widget.isOn ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}
        >
          <span className="toggle-knob" />
        </span>
      )
    }
    case 'slider': {
      return (
        <EffortSlider
          levels={widget.levels}
          current={widget.current}
          isInsideOption
          onSelect={
            onStep === undefined
              ? undefined
              : (level) => {
                  onStep(effortIndex(widget.levels, level))
                }
          }
        />
      )
    }
  }
}

function RowView({
  row,
  index,
  isActive,
  onActivate,
  onHover,
}: {
  readonly row: PaletteRow
  readonly index: number
  readonly isActive: boolean
  readonly onActivate: () => void
  readonly onHover: (index: number) => void
}) {
  return (
    <li
      id={`${ROW_ID_PREFIX}${row.id}`}
      role="option"
      aria-selected={isActive}
      className={isActive ? 'palette-item palette-item-active' : 'palette-item'}
      onMouseEnter={() => {
        onHover(index)
      }}
      onMouseDown={(event) => {
        // Keep the filter input focused; the click still activates.
        event.preventDefault()
      }}
      onClick={onActivate}
    >
      <span className="palette-item-text">
        <span className="palette-item-label">{row.label}</span>
        {row.detail === undefined ? null : (
          <span className="palette-item-detail">{row.detail}</span>
        )}
      </span>
      {row.isCurrent ? <CheckIcon title={UI_TEXT.menuCurrent} /> : null}
      {row.widget === undefined ? null : <Widget widget={row.widget} onStep={row.step} />}
    </li>
  )
}

/** The models view's layout: grouped rows, then the provider rows (M95). */
function layoutModels(
  models: readonly ModelOption[],
  filter: string,
  currentModelId: string | undefined,
  onSelectModel: (modelId: string) => void,
  onAction: (action: PaletteAction) => void,
): { readonly entries: readonly PaletteEntry[]; readonly rows: readonly PaletteRow[] } {
  const needle = filter.toLowerCase()
  const isMatch = (text: string | undefined): boolean =>
    text?.toLowerCase().includes(needle) ?? false
  const matching = models.filter(
    (model) =>
      isMatch(model.displayLabel) || isMatch(model.providerLabel) || isMatch(model.modelId),
  )
  const sections = modelSections(matching, currentModelId, onSelectModel)
  const isGrouped = sections.length > 1
  const rows: PaletteRow[] = []
  const entries: PaletteEntry[] = []
  for (const section of sections) {
    // One group keeps today's flat list; titles name groups only past that.
    const title: readonly PaletteEntry[] = isGrouped
      ? [{ kind: 'title', key: `title:${section.key}`, title: section.title }]
      : []
    entries.push(...title)
    for (const row of section.rows) {
      entries.push({ kind: 'row', key: row.id, index: rows.length })
      rows.push(row)
    }
  }
  const footer = providerRows(onAction).filter((row) => needle === '' || isMatch(row.label))
  for (const row of footer) {
    entries.push({ kind: 'row', key: row.id, index: rows.length })
    rows.push(row)
  }
  return { entries, rows }
}

export function Palette(props: PaletteProps) {
  const { view, groups, models, currentModelId, onAction, onSelectModel, onBack, onClose } = props
  const { isAttached = false, keys, onActiveRowChange } = props
  const [filter, setFilter] = useState('')
  const filterBox = useRef<HTMLInputElement>(null)
  const [storedIndex, setActiveIndex] = useState(0)

  const layout = useMemo(
    () =>
      view === 'models'
        ? layoutModels(models, filter, currentModelId, onSelectModel, onAction)
        : layoutActions(filterPalette(groups, filter), onAction),
    [view, filter, models, currentModelId, onSelectModel, groups, onAction],
  )
  const { entries, rows } = layout

  // The stored index may point past the end after the filter narrowed the
  // rows; derive the effective one instead of resetting state in an effect.
  // The parent remounts the palette (key={view}) when the view changes, which
  // is what resets the filter and the index.
  const activeIndex = storedIndex < rows.length ? storedIndex : 0

  useEffect(() => {
    const active = rows[activeIndex]
    if (active !== undefined) {
      scrollRowIntoView(ROW_ID_PREFIX, active.id)
    }
  }, [rows, activeIndex])

  const move = (delta: number) => {
    setActiveIndex(wrapIndex(activeIndex, delta, rows.length))
  }

  const didHandleKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    const active = rows[activeIndex]
    switch (event.key) {
      case 'ArrowDown': {
        move(1)
        break
      }
      case 'ArrowUp': {
        move(-1)
        break
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (active?.step === undefined || active.widget?.kind !== 'slider') {
          return false
        }
        const { levels, current } = active.widget
        active.step(effortIndex(levels, current) + (event.key === 'ArrowRight' ? 1 : -1))
        break
      }
      case 'Enter': {
        active?.activate()
        break
      }
      case 'Escape': {
        if (view === 'models') {
          onBack()
        } else {
          onClose()
        }
        break
      }
      default: {
        return false
      }
    }
    event.preventDefault()
    return true
  }
  useImperativeHandle(keys, () => ({ didHandleKey }))

  const renderRow = (index: number) => {
    const row = rows[index]
    return row === undefined ? null : (
      <RowView
        key={row.id}
        row={row}
        index={index}
        isActive={index === activeIndex}
        onActivate={row.activate}
        onHover={setActiveIndex}
      />
    )
  }

  let body
  if (rows.length === 0) {
    body = <p className="menu-empty">{UI_TEXT.paletteNoMatches}</p>
  } else {
    body = (
      <ul
        id={PALETTE_LISTBOX_ID}
        role="listbox"
        aria-label={view === 'models' ? UI_TEXT.modelListLabel : UI_TEXT.paletteLabel}
        className="palette-list"
      >
        {entries.map((entry) => {
          switch (entry.kind) {
            case 'title': {
              return (
                <li key={entry.key} role="presentation" className="palette-group-title">
                  {entry.title}
                </li>
              )
            }
            case 'disabled': {
              if (view === 'models') return null
              return (
                <li
                  key={entry.key}
                  role="presentation"
                  className="palette-item palette-item-disabled"
                >
                  <span className="palette-item-text">
                    <span className="palette-item-label">{entry.item.label}</span>
                  </span>
                  {entry.item.widget === undefined ? null : (
                    <Widget widget={entry.item.widget} onStep={undefined} />
                  )}
                </li>
              )
            }
            case 'row': {
              return renderRow(entry.index)
            }
          }
        })}
      </ul>
    )
  }

  const activeRow = rows[activeIndex]
  const activeRowId = activeRow === undefined ? undefined : `${ROW_ID_PREFIX}${activeRow.id}`
  useEffect(() => {
    onActiveRowChange?.(activeRowId)
  }, [onActiveRowChange, activeRowId])
  // Anything taking the focus outside the palette closes it; Tab into the
  // list keeps it open (M37). Attached, the focus is the prompt's, which
  // closes it itself.
  const onPaletteBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (isAttached) {
      return
    }
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onClose()
    }
  }
  // Escape from the list; the filter box handles its own.
  const onPaletteKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.target === filterBox.current) {
      return
    }
    event.preventDefault()
    if (view === 'models') {
      onBack()
    } else {
      onClose()
    }
  }
  return (
    <div
      className={isAttached ? 'palette palette-attached' : 'palette'}
      role="dialog"
      aria-label={UI_TEXT.paletteLabel}
      onBlur={onPaletteBlur}
      onKeyDown={onPaletteKeyDown}
    >
      {isAttached ? null : (
        <div className="palette-header">
          {view === 'models' ? (
            <button
              type="button"
              className="icon-button"
              title={UI_TEXT.paletteBack}
              aria-label={UI_TEXT.paletteBack}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={onBack}
            >
              <BackIcon />
            </button>
          ) : null}
          <input
            ref={filterBox}
            className="palette-filter"
            type="text"
            role="combobox"
            // Only a list that is there can be controlled (seen in a
            // translated table, M40: a filter matching nothing left the
            // reference dangling).
            aria-expanded={rows.length > 0}
            aria-controls={rows.length > 0 ? PALETTE_LISTBOX_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={activeRowId}
            placeholder={UI_TEXT.paletteFilterPlaceholder}
            value={filter}
            autoFocus
            onChange={(event) => {
              setFilter(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              didHandleKey(event)
            }}
          />
        </div>
      )}
      <ListBody>{body}</ListBody>
    </div>
  )
}
