// The tasks tab (M87, PLAN.md D66 item 6) as a conversation controller sees
// it: one editor tab per chat surface, mirroring that surface's conversation's
// todo list, which the user can move into a window of its own. The tasks
// panel implements it with a WebviewPanel; a host that passes none answers
// "Open in a tab" with a notice that it failed. It carries no VS Code type,
// so the controller runs in any host (M61, PLAN.md D60).

import type { TodoItem } from '../../shared/agentEvents'

/** What the tab shows, whole each time: the conversation's name and its list. */
export interface TasksTabView {
  /** The conversation's name, or the untitled name when it has none. */
  readonly conversation: string
  readonly items: readonly TodoItem[]
}

export interface TasksTabPort {
  /** Opens the tab beside the editor, or reveals it, showing this conversation's list. */
  open(view: TasksTabView): void
  /** The conversation the tab opened for changed its list or its name. */
  update(view: TasksTabView): void
  /**
   * That conversation ended: cleared, replaced by another in the panel, or
   * its panel closed. The tab says so and takes no update until it opens again.
   */
  ended(): void
}
