import { webviewKey } from '../../../shared/keybindings'
// The searchable provider dropdown (M95 step 8.1): type-ahead over each
// row's name and one-line description, with filter chips (Cloud, On this
// computer, Subscription sign-in, Aggregator). Follows the combobox
// pattern: the input keeps focus, arrows move through the options, Enter
// picks one, Escape closes.

import { type KeyboardEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { scrollRowIntoView, wrapIndex } from '../../listNavigation'

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly category: string
}

export interface SelectChip {
  readonly value: string
  readonly label: string
}

export interface SearchableSelectProps {
  readonly label: string
  readonly placeholder: string
  readonly options: readonly SelectOption[]
  readonly chips: readonly SelectChip[]
  readonly activeChip: string | undefined
  readonly onChip: (chip: string | undefined) => void
  readonly onSelect: (value: string) => void
  readonly footer?: ReactNode
}

function isMatch(option: SelectOption, needle: string): boolean {
  const query = needle.trim().toLowerCase()
  return query === '' || `${option.label} ${option.description}`.toLowerCase().includes(query)
}

export function SearchableSelect({
  label,
  placeholder,
  options,
  chips,
  activeChip,
  onChip,
  onSelect,
  footer,
}: SearchableSelectProps) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const matches = useMemo(
    () =>
      options.filter(
        (option) =>
          isMatch(option, query) &&
          // A custom server is the user's own endpoint, not one provider's:
          // it stays listed under every chip.
          (activeChip === undefined ||
            option.category === activeChip ||
            option.category === 'custom'),
      ),
    [options, activeChip, query],
  )
  const active = matches[wrapIndex(activeIndex, 0, matches.length)]
  const open = (): void => {
    setIsOpen(true)
  }
  const close = (): void => {
    setIsOpen(false)
  }
  const step = (delta: number): void => {
    open()
    const next = wrapIndex(activeIndex, delta, matches.length)
    setActiveIndex(next)
    const row = matches[next]
    if (row !== undefined) {
      scrollRowIntoView(`${baseId}-option-`, row.value)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (
      webviewKey('models.select', event) !== 'next' &&
      webviewKey('models.select', event) !== 'previous' &&
      webviewKey('models.select', event) !== 'accept' &&
      webviewKey('models.select', event) !== 'close'
    ) {
      return
    }
    event.preventDefault()
    switch (webviewKey('models.select', event)) {
      case 'next': {
        step(1)
        break
      }
      case 'previous': {
        step(-1)
        break
      }
      case 'accept': {
        if (isOpen && active !== undefined) {
          onSelect(active.value)
        }
        break
      }
      case 'close': {
        if (isOpen) {
          close()
        }
        break
      }
    }
  }
  return (
    <div className="models-select">
      <div className="models-chips" role="group" aria-label={label}>
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={
              activeChip === chip.value ? 'models-chip models-chip-pressed' : 'models-chip'
            }
            aria-pressed={activeChip === chip.value}
            onClick={() => {
              onChip(activeChip === chip.value ? undefined : chip.value)
              setActiveIndex(0)
            }}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <label className="models-select-label" htmlFor={`${baseId}-input`}>
        {label}
      </label>
      <input
        id={`${baseId}-input`}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          !isOpen || active === undefined ? undefined : `${baseId}-option-${active.value}`
        }
        placeholder={placeholder}
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          open()
        }}
        onFocus={open}
        onBlur={() => {
          // A click on an option lands first; the option handles it.
          close()
        }}
        onKeyDown={onKeyDown}
      />
      {isOpen && (
        <ul className="models-select-list" id={listId} role="listbox" aria-label={label}>
          {matches.map((option, index) => (
            <li
              key={option.value}
              id={`${baseId}-option-${option.value}`}
              role="option"
              aria-selected={index === wrapIndex(activeIndex, 0, matches.length)}
              onMouseDown={(event) => {
                // Before the input's blur closes the list.
                event.preventDefault()
                onSelect(option.value)
              }}
            >
              <span className="models-select-label-row">{option.label}</span>
              <span className="models-select-description">{option.description}</span>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="models-select-empty" aria-disabled="true">
              {UI_TEXT.panelNoMatches}
            </li>
          )}
        </ul>
      )}
      {footer}
    </div>
  )
}
