import { webviewKey } from '../../../shared/keybindings'
// A sortable keyboard grid that becomes cards at narrow widths (M95:
// the dropdowns follow the combobox pattern, the table is a grid with
// arrow keys and Enter; at 320 px the table is a list of cards). Sort
// headers are buttons; the active row is tracked with
// aria-activedescendant so the grid keeps the single Tab stop.

import { type KeyboardEvent, type ReactNode, useState } from 'react'

export interface DataColumn {
  readonly key: string
  readonly label: string
  readonly sortable: boolean
}

export interface DataRow {
  readonly id: string
  /** What a screen reader names the row (the model reference). */
  readonly label: string
  readonly cells: readonly ReactNode[]
}

export interface DataTableProps {
  readonly caption: string
  readonly columns: readonly DataColumn[]
  readonly rows: readonly DataRow[]
  readonly sortKey: string | undefined
  readonly sortDirection: 'asc' | 'desc'
  readonly emptyText: string
  readonly onSort: (key: string) => void
  readonly onRowActivate: (id: string) => void
}

function ariaSort(
  column: DataColumn,
  sortKey: string | undefined,
  sortDirection: 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' {
  if (!column.sortable || column.key !== sortKey) {
    return 'none'
  }
  return sortDirection === 'asc' ? 'ascending' : 'descending'
}

export function DataTable({
  caption,
  columns,
  rows,
  sortKey,
  sortDirection,
  emptyText,
  onSort,
  onRowActivate,
}: DataTableProps) {
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const activeIndex = rows.findIndex((row) => row.id === activeId)
  if (rows.length === 0) {
    return <p className="models-table-empty">{emptyText}</p>
  }
  const move = (delta: number): void => {
    if (rows.length === 0) {
      return
    }
    const next = activeIndex === -1 ? (delta > 0 ? 0 : rows.length - 1) : activeIndex + delta
    const wrapped = (next + rows.length) % rows.length
    const row = rows[wrapped]
    if (row !== undefined) {
      setActiveId(row.id)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>): void => {
    if (event.target !== event.currentTarget) {
      return
    }
    switch (webviewKey('models.table', event)) {
      case 'next': {
        event.preventDefault()
        move(1)
        break
      }
      case 'previous': {
        event.preventDefault()
        move(-1)
        break
      }
      case 'first': {
        event.preventDefault()
        const first = rows[0]
        if (first !== undefined) {
          setActiveId(first.id)
        }
        break
      }
      case 'last': {
        event.preventDefault()
        const last = rows.at(-1)
        if (last !== undefined) {
          setActiveId(last.id)
        }
        break
      }
      case 'accept': {
        if (activeIndex !== -1) {
          const row = rows[activeIndex]
          if (row !== undefined) {
            event.preventDefault()
            onRowActivate(row.id)
          }
        }
        break
      }
      case 'close': {
        setActiveId(undefined)
        break
      }
      default: {
        break
      }
    }
  }
  return (
    <table
      className="models-table"
      role="grid"
      aria-label={caption}
      aria-activedescendant={
        activeIndex === -1 || activeId === undefined ? undefined : `models-row-${activeId}`
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" aria-sort={ariaSort(column, sortKey, sortDirection)}>
              {column.sortable ? (
                <button
                  type="button"
                  className="models-sort"
                  onClick={() => {
                    onSort(column.key)
                  }}
                >
                  {column.label}
                </button>
              ) : (
                column.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            id={`models-row-${row.id}`}
            role="row"
            aria-label={row.label}
            aria-selected={row.id === activeId}
            onClick={() => {
              setActiveId(row.id)
            }}
          >
            {row.cells.map((cell, index) => (
              // The row carries the label; cells are presentational.
              <td key={columns[index]?.key ?? index} role="gridcell">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
