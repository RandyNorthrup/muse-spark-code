// The "/" command palette: a filter box over grouped rows, some carrying a
// value, a toggle or the effort slider, plus the model list as a second view.
// Fully keyboard-operable: the filter input keeps focus, Up/Down move,
// Enter activates, Left/Right step the slider, Esc goes back or closes.

import { type FocusEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { effortAt, effortIndex } from '../../shared/effort'
import {
  filterPalette,
  formatTokenWindow,
  type PaletteAction,
  type PaletteGroup,
  type PaletteItem,
  type PaletteWidget,
} from '../../shared/palette'
import type { ModelOption } from '../../shared/protocol'
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

export function modelRows(
  models: readonly ModelOption[],
  currentModelId: string | undefined,
  onSelectModel: (modelId: string) => void,
): readonly PaletteRow[] {
  return models.map((model) => ({
    id: `model:${model.modelId}`,
    label: model.displayLabel,
    detail:
      model.contextLimit === undefined
        ? undefined
        : `${formatTokenWindow(model.contextLimit)} ${UI_TEXT.modelContextSuffix}`,
    widget: undefined,
    isCurrent: model.modelId === currentModelId,
    activate: () => {
      onSelectModel(model.modelId)
    },
    step: undefined,
  }))
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
          aria-label={widget.isOn ? 'On' : 'Off'}
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
      {row.isCurrent ? <CheckIcon title="Current" /> : null}
      {row.widget === undefined ? null : <Widget widget={row.widget} onStep={row.step} />}
    </li>
  )
}

export function Palette(props: PaletteProps) {
  const { view, groups, models, currentModelId, onAction, onSelectModel, onBack, onClose } = props
  const [filter, setFilter] = useState('')
  const filterBox = useRef<HTMLInputElement>(null)
  const [storedIndex, setActiveIndex] = useState(0)

  const layout = useMemo(() => {
    if (view === 'models') {
      const needle = filter.toLowerCase()
      const matching = models.filter((model) => model.displayLabel.toLowerCase().includes(needle))
      return { entries: [], rows: modelRows(matching, currentModelId, onSelectModel) }
    }
    return layoutActions(filterPalette(groups, filter), onAction)
  }, [view, filter, models, currentModelId, onSelectModel, groups, onAction])
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

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const active = rows[activeIndex]
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        move(1)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        move(-1)
        break
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (active?.step !== undefined && active.widget?.kind === 'slider') {
          event.preventDefault()
          const { levels, current } = active.widget
          active.step(effortIndex(levels, current) + (event.key === 'ArrowRight' ? 1 : -1))
        }
        break
      }
      case 'Enter': {
        event.preventDefault()
        active?.activate()
        break
      }
      case 'Escape': {
        event.preventDefault()
        if (view === 'models') {
          onBack()
        } else {
          onClose()
        }
        break
      }
      default: {
        break
      }
    }
  }

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
  } else if (view === 'models') {
    body = (
      <ul
        id="palette-listbox"
        role="listbox"
        aria-label={UI_TEXT.modelListLabel}
        className="palette-list"
      >
        {rows.map((_, index) => renderRow(index))}
      </ul>
    )
  } else {
    body = (
      <ul
        id="palette-listbox"
        role="listbox"
        aria-label={UI_TEXT.paletteLabel}
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
  // Anything taking the focus outside the palette closes it; Tab into the
  // list keeps it open (M37).
  const onPaletteBlur = (event: FocusEvent<HTMLDivElement>) => {
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
      className="palette"
      role="dialog"
      aria-label={UI_TEXT.paletteLabel}
      onBlur={onPaletteBlur}
      onKeyDown={onPaletteKeyDown}
    >
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
          aria-expanded="true"
          aria-controls="palette-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeRow === undefined ? undefined : `${ROW_ID_PREFIX}${activeRow.id}`
          }
          placeholder={UI_TEXT.paletteFilterPlaceholder}
          value={filter}
          autoFocus
          onChange={(event) => {
            setFilter(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <ListBody>{body}</ListBody>
    </div>
  )
}
