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

export function TodoPanel({ items }: { readonly items: readonly TodoItem[] }) {
  if (items.length === 0) {
    return null
  }
  return (
    <section className="todo" aria-label={UI_TEXT.todoTitle}>
      <div className="todo-title">{UI_TEXT.todoTitle}</div>
      <ul className="todo-list">
        {items.map((item) => (
          <li key={item.text} className={`todo-item todo-${item.status}`}>
            <span className="todo-mark" aria-hidden="true">
              {STATUS_MARKS[item.status] ?? STATUS_MARKS['pending']}
            </span>
            <span>{item.status === 'inProgress' ? (item.activeForm ?? item.text) : item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
