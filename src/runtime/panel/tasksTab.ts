// The tasks tab of a runtime panel conversation (M104 lane B; M87, PLAN.md D66):
// the conversation's todo list in a tab of its own, the controller's
// `TasksTabPort` carried over MHP as a `tasks` surface bound to the
// conversation's session. The editor renders the tasks page; this answers its
// messages (`tasksReady`, `revealConversation`) and publishes the list.
//
// - "Open in a Tab" asks the editor for a `tasks` surface, or brings the one
//   it has to the front (`surfaces/focus`).
// - The surface holds the list the conversation had when it opened, then each
//   update; a surface the editor reloads asks again with `tasksReady`.
// - An MHP surface is bound to one session for good: when the conversation
//   moves to another session its tab is closed with the old one's surfaces,
//   and "ended" is shown only to a surface still open.
// - The editor has no command that moves the tab to a window of its own that
//   the runtime knows of, so the tab never offers it.
import { logRejection, type Logger } from '../../host/logger'
import type { TasksTabPort, TasksTabView } from '../../host/views/tasksTabPort'
import type { TasksHostMessage } from '../../shared/tasksProtocol'
import type { PanelView } from './surfaces'

export interface RuntimeTasksTabDeps {
  /** The ids of the `tasks` surfaces the editor has open for the conversation now. */
  readonly openSurfaces: () => readonly string[]
  /** Asks the editor for a `tasks` surface bound to the conversation's session. */
  readonly openSurface: () => Promise<void>
  /** Brings a surface to the front of the editor. */
  readonly focusSurface: (surfaceId: string) => Promise<void>
  /** "Open the conversation": the chat surface of the same session comes to the front. */
  readonly revealConversation: () => Promise<void>
  readonly log: Logger
}

export class RuntimeTasksTab implements TasksTabPort, PanelView {
  private view: TasksTabView | undefined
  private isEnded = false
  private readonly listeners = new Set<(message: TasksHostMessage) => void>()

  public constructor(private readonly deps: RuntimeTasksTabDeps) {}

  private message(view: TasksTabView): TasksHostMessage {
    return {
      type: 'tasksState',
      conversation: view.conversation,
      items: [...view.items],
      ended: this.isEnded,
      canMoveToWindow: false,
    }
  }

  private send(): void {
    if (this.view === undefined) return
    const message = this.message(this.view)
    for (const listener of this.listeners) listener(message)
  }

  public open(view: TasksTabView): void {
    this.view = view
    this.isEnded = false
    const [existing] = this.deps.openSurfaces()
    if (existing === undefined) {
      // REPORTED: the editor could not show the tab; the log has the kind, the conversation goes on.
      void this.deps.openSurface().catch(logRejection(this.deps.log, 'tasks tab open'))
      return
    }
    this.send()
    void this.deps.focusSurface(existing).catch(logRejection(this.deps.log, 'tasks tab focus'))
  }

  public update(view: TasksTabView): void {
    if (this.isEnded) return
    this.view = view
    this.send()
  }

  public ended(): void {
    this.isEnded = true
    this.send()
  }

  /** The conversation was let go: its tab shows nothing more. */
  public dispose(): void {
    this.listeners.clear()
    this.view = undefined
  }

  public handle(message: Parameters<PanelView['handle']>[0]): void {
    switch (message?.type) {
      case 'tasksReady': {
        this.send()
        break
      }
      case 'revealConversation': {
        if (!this.isEnded)
          void this.deps.revealConversation().catch(logRejection(this.deps.log, 'tasks tab reveal'))
        break
      }
      default: {
        // `moveTasksToWindow` (never offered) and anything else the contract admits for this surface.
        this.deps.log.trace('MHP_TASKS_MESSAGE_IGNORED')
      }
    }
  }

  public subscribe(listener: (message: TasksHostMessage) => void): () => void {
    this.listeners.add(listener)
    // The editor holds the frame until the page is ready.
    if (this.view !== undefined) listener(this.message(this.view))
    return () => {
      this.listeners.delete(listener)
    }
  }
}
