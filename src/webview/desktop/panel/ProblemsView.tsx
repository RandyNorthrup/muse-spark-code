// Muse Desktop (M111, D91.13) lane BP: the Problems view. M68's
// diagnostics grouped by file, worst first; opening a row reveals the
// file in the editor (the line reveal is ED's, with the editor).

import { type KeyboardEvent, type RefObject, useEffect, useMemo, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { webviewKey } from '../../../shared/keybindings'
import { fill } from '../../../shared/l10n/text'
import type { PanelProblem } from '../../../shared/desktop/bridge'
import { formatProblemLocation, groupProblemsByFile } from './problemsFormat'

export interface ProblemsViewProps {
  readonly problems: readonly PanelProblem[]
  readonly listRef: RefObject<HTMLUListElement | null>
  readonly onOpenFile: (path: string, line: number) => void
}

export function ProblemsView(properties: ProblemsViewProps) {
  const { problems, listRef, onOpenFile } = properties
  const [activeRow, setActiveRow] = useState(0)
  // Each group's first flat index, so rows keep stable identities.
  const indexed = useMemo(() => {
    const groups = groupProblemsByFile(problems)
    const counts = groups.map((group) => group.rows.length)
    return groups.map((group, groupIndex) => ({
      path: group.path,
      rows: group.rows,
      first: counts.slice(0, groupIndex).reduce((sum, count) => sum + count, 0),
    }))
  }, [problems])
  const rows = useMemo(
    () => indexed.flatMap((entry) => entry.rows.map((row) => ({ group: entry.path, row }))),
    [indexed],
  )
  // The list shrinks under the selection when diagnostics clear; the
  // selection follows instead of pointing past the end.
  const safeActive = rows.length === 0 ? 0 : Math.min(activeRow, rows.length - 1)

  useEffect(() => {
    listRef.current
      ?.querySelector(`#muse-problem-row-${String(safeActive)}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [listRef, safeActive])

  if (rows.length === 0) {
    return <p className="muse-panel-empty">{UI_TEXT.desktop.workbenchNoProblems}</p>
  }

  const openRow = (index: number): void => {
    const entry = rows[index]
    if (entry !== undefined) onOpenFile(entry.row.path, entry.row.line)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const action = webviewKey('desktop.problems', event)
    if (action === undefined) return
    event.preventDefault()
    switch (action) {
      case 'open': {
        openRow(safeActive)
        break
      }
      case 'next': {
        setActiveRow(Math.min(safeActive + 1, rows.length - 1))
        break
      }
      case 'previous': {
        setActiveRow(Math.max(safeActive - 1, 0))
        break
      }
      case 'first': {
        setActiveRow(0)
        break
      }
      default: {
        setActiveRow(rows.length - 1)
      }
    }
  }

  return (
    <ul
      ref={listRef}
      className="muse-panel-problems"
      role="listbox"
      aria-label={UI_TEXT.desktop.workbenchProblems}
      aria-activedescendant={`muse-problem-row-${String(safeActive)}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {indexed.map((entry) => (
        <li key={entry.path} role="group" aria-label={entry.path}>
          <span className="muse-panel-problems-path" dir="ltr" aria-hidden="true">
            {entry.path}
          </span>
          <ul role="presentation" className="muse-panel-problems-rows">
            {entry.rows.map((row, rowIndex) => {
              const index = entry.first + rowIndex
              return (
                <li
                  key={`${entry.path}:${String(index)}`}
                  id={`muse-problem-row-${String(index)}`}
                  role="option"
                  aria-selected={index === safeActive}
                  aria-label={fill(UI_TEXT.desktop.panelProblemLabel, {
                    severity: UI_TEXT.desktop.panelSeverity[row.severity],
                    message: row.message,
                    path: row.path,
                    line: row.line,
                  })}
                  data-active={index === safeActive}
                  onClick={() => {
                    setActiveRow(index)
                    listRef.current?.focus()
                    openRow(index)
                  }}
                >
                  <span
                    className={`muse-panel-severity muse-panel-severity-${row.severity}`}
                    aria-hidden="true"
                  />
                  <span className="muse-panel-problem-message">{row.message}</span>
                  <span className="muse-panel-problem-location" dir="ltr">
                    {formatProblemLocation(row.line, row.column)}
                  </span>
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}
