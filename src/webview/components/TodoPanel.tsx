// The pinned task list (`session/todoListChanged`), shown above the composer
// while the agent keeps one.

import { useId, useState } from 'react'
import type { TodoItem } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import { ExpandChevron } from './icons'

const STATUS_MARKS: Readonly<Record<string, string>> = {
  completed: '✓',
  inProgress: '›',
  cancelled: '×',
  pending: '·',
}

export function TodoPanel({
  items,
  isInert = false,
  onOpenInTab,
}: {
  readonly items: readonly TodoItem[]
  /** Behind a modal (M25). */
  readonly isInert?: boolean
  readonly onOpenInTab?: () => void
}) {
  const [isExpanded, setExpanded] = useState(true)
  const listId = useId()
  const current = items.find((item) => item.status === 'inProgress')
  const progress = fill(UI_TEXT.todoProgress, {
    done: formatNumber(items.filter((item) => item.status === 'completed').length),
    total: formatNumber(items.length),
  })
  if (items.length === 0) {
    return null
  }
  return (
    <section className="todo" aria-label={UI_TEXT.todoTitle} inert={isInert}>
      <div className="todo-header">
        <button
          type="button"
          className="todo-title chat-control"
          aria-expanded={isExpanded}
          aria-controls={listId}
          onClick={() => {
            setExpanded(!isExpanded)
          }}
        >
          <ExpandChevron isOpen={isExpanded} />
          <span>{UI_TEXT.todoTitle}</span> <span className="todo-progress">{progress}</span>
        </button>
        {onOpenInTab !== undefined && (
          <button
            type="button"
            className="todo-open chat-control"
            title={UI_TEXT.todoOpenInTabTitle}
            onClick={onOpenInTab}
          >
            {UI_TEXT.todoOpenInTab}
          </button>
        )}
      </div>
      {!isExpanded && current !== undefined && (
        <div className="todo-current" dir="auto" title={current.activeForm ?? current.text}>
          {current.activeForm ?? current.text}
        </div>
      )}
      <ul id={listId} className="todo-list" hidden={!isExpanded}>
        {items.map((item, index) => (
          // Two tasks may share a text (M25); the position tells them apart.
          <li key={`${String(index)}:${item.text}`} className={`todo-item todo-${item.status}`}>
            <span className="todo-mark" aria-hidden="true">
              {STATUS_MARKS[item.status] ?? STATUS_MARKS['pending']}
            </span>
            <span dir="auto">
              {item.status === 'inProgress' ? (item.activeForm ?? item.text) : item.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
