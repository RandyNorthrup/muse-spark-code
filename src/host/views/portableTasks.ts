import type { HostServices, MhpResult } from '../../shared/hostApi/methods'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import { UI_TEXT } from '../../shared/constants'
import {
  tasksHostMessageSchema,
  tasksWebviewMessageSchema,
  type TasksHostMessage,
} from '../../shared/tasksProtocol'
import type { PanelView } from '../../runtime/panel/surfaces'
import type { Logger } from '../logger'
import type { TasksTabPort, TasksTabView } from './tasksTabPort'

/** The read-only Tasks tab, owned by the conversation rather than an editor API. */
export class PortableTasks implements TasksTabPort {
  private current: TasksTabView | undefined
  private isEnded = false
  private isDisposed = false
  private surface:
    { readonly id: MhpResult<'surfaces/open'>['surfaceId']; readonly sessionId: string } | undefined
  private opening: { readonly sessionId: string; readonly work: Promise<void> } | undefined
  private generation = 0
  private readonly openings = new Set<Promise<void>>()
  private moving: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private readonly acquired = new Set<MhpResult<'surfaces/open'>['surfaceId']>()
  private readonly listeners = new Set<(message: TasksHostMessage) => void>()

  public constructor(
    private readonly host: HostServices,
    private readonly sessionId: () => string,
    private readonly revealConversation: () => void,
    private readonly log: Logger,
    private readonly notice: (text: string) => void,
  ) {}

  private post(): void {
    if (this.isDisposed || this.current === undefined) return
    const message = tasksHostMessageSchema.parse({
      type: 'tasksState',
      conversation: this.current.conversation,
      items: this.current.items,
      ended: this.isEnded,
      canMoveToWindow: !this.isEnded && this.surface !== undefined,
    })
    for (const listener of this.listeners) listener(message)
  }

  private async close(id: MhpResult<'surfaces/open'>['surfaceId']): Promise<void> {
    await this.host.request('surfaces/close', { surfaceId: id })
    this.acquired.delete(id)
  }

  private isCurrent(sessionId: string, generation: number): boolean {
    return !this.isDisposed && sessionId === this.sessionId() && generation === this.generation
  }

  private async acquire(
    placement: 'tab' | 'window',
    sessionId: string,
    generation: number,
  ): Promise<void> {
    if (!this.isCurrent(sessionId, generation)) return
    const result = await this.host.request('surfaces/open', {
      kind: 'tasks',
      placement,
      sessionId,
    })
    this.acquired.add(result.surfaceId)
    if (!this.isCurrent(sessionId, generation)) {
      await this.close(result.surfaceId)
      return
    }
    if (this.surface?.id !== result.surfaceId) this.listeners.clear()
    this.surface = { id: result.surfaceId, sessionId }
    this.post()
  }

  private async move(): Promise<void> {
    if (this.moving !== undefined) {
      await this.moving
      return
    }
    if (this.isEnded || this.surface === undefined || this.isDisposed) return
    const previous = this.surface
    const generation = this.generation
    this.moving = (async () => {
      await this.acquire('window', previous.sessionId, generation)
      if (this.surface?.id !== previous.id) {
        await this.close(previous.id)
      }
    })()
    try {
      await this.moving
    } finally {
      this.moving = undefined
    }
  }

  private async release(): Promise<void> {
    this.isDisposed = true
    this.listeners.clear()
    await Promise.allSettled([...this.openings, this.moving])
    this.surface = undefined
    let hasFailure = false
    for (const id of this.acquired) {
      try {
        await this.close(id)
      } catch {
        hasFailure = true
        this.log.warn('MHP_TASKS_CLOSE_FAILED')
      }
    }
    if (hasFailure) throw new Error('MHP_TASKS_CLOSE_FAILED')
  }
  /** Awaitable entry for composition/tests; the controller's void port reports failures. */
  public async show(view: TasksTabView): Promise<void> {
    if (this.isDisposed) throw new Error('MHP_PRESENTATION_DISPOSED')
    this.current = view
    this.isEnded = false
    this.post()
    const sessionId = this.sessionId()
    if (this.opening?.sessionId === sessionId) {
      await this.opening.work
      return
    }
    if (this.surface?.sessionId === sessionId) {
      await this.host.request('surfaces/focus', { surfaceId: this.surface.id })
      return
    }
    const old = this.surface
    this.surface = undefined
    this.listeners.clear()
    const generation = ++this.generation
    const work = (async () => {
      if (old !== undefined) await this.close(old.id)
      await this.acquire('tab', sessionId, generation)
    })()
    this.opening = { sessionId, work }
    this.openings.add(work)
    try {
      await work
    } finally {
      this.openings.delete(work)
      if (generation === this.generation) this.opening = undefined
    }
  }

  public open(view: TasksTabView): void {
    void this.show(view).catch(() => {
      this.log.warn('MHP_TASKS_OPEN_FAILED')
      if (!this.isDisposed) this.notice(UI_TEXT.actionFailed)
    })
  }

  public update(view: TasksTabView): void {
    if (this.isDisposed || this.isEnded) return
    this.current = view
    this.post()
  }

  public ended(): void {
    this.isEnded = true
    this.post()
  }

  /** Only the ID obtained from HostServices and this conversation's session can bind. */
  public view(binding: MhpPanelBinding): PanelView | undefined {
    if (
      this.isDisposed ||
      binding.surfaceKind !== 'tasks' ||
      this.surface === undefined ||
      binding.surface !== String(this.surface.id) ||
      binding.sessionId !== this.surface.sessionId ||
      binding.sessionId !== this.sessionId()
    )
      return
    return {
      subscribe: (listener) => {
        if (this.isDisposed || String(this.surface?.id) !== binding.surface)
          return () => {
            // A late subscriber acquired no resource.
          }
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
      handle: async (raw) => {
        if (
          this.isDisposed ||
          String(this.surface?.id) !== binding.surface ||
          binding.sessionId !== this.sessionId()
        )
          throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
        const message = tasksWebviewMessageSchema.parse(raw)
        switch (message.type) {
          case 'tasksReady': {
            this.post()
            break
          }
          case 'revealConversation': {
            if (!this.isEnded) this.revealConversation()
            break
          }
          case 'moveTasksToWindow': {
            try {
              await this.move()
            } catch {
              this.log.warn('MHP_TASKS_MOVE_FAILED')
              this.notice(UI_TEXT.actionFailed)
            }
          }
        }
      },
    }
  }

  /** Carrier close notifications must reach this hook to permit reopening. */
  public closed(surfaceId: string): void {
    for (const owned of this.acquired) {
      if (String(owned) === surfaceId) {
        this.acquired.delete(owned)
        break
      }
    }
    if (String(this.surface?.id) !== surfaceId) return
    this.surface = undefined
    this.listeners.clear()
  }

  public dispose(): Promise<void> {
    this.disposal ??= this.release()
    return this.disposal
  }
}
