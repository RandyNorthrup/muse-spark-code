// The pinned task list (`session/todoListChanged`), shown above the composer
// while the agent keeps one.

import type { TodoItem } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'

const STATUS_MARKS: Readonly<Record<string, string>> = {
  completed: '✓',
  inProgress: '›',
  cancelled: '×',
  pending: '·',
}

export function TodoPanel({
  items,
  isInert = false,
}: {
  readonly items: readonly TodoItem[]
  /** Behind a modal (M25). */
  readonly isInert?: boolean
}) {
  if (items.length === 0) {
    return null
  }
  return (
    <section className="todo" aria-label={UI_TEXT.todoTitle} inert={isInert}>
      <div className="todo-title">{UI_TEXT.todoTitle}</div>
      <ul className="todo-list">
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
