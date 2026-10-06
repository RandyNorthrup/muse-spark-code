import {
  SteerRefusedError,
  type AgentHost,
  type AgentSession,
  type QueuedMessageRef,
  type SessionHistoryOutcome,
  type StartSessionOptions,
  type TurnSubmission,
} from '../../core/agent/agentBackend'
import type {
  ScheduleConversationTargets,
  ScheduleDeliverySession,
  ScheduleTargetLease,
} from '../../core/schedules/delivery'
import type { AgentEvent } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import { mspApprovalMode } from '../../shared/permissionModes'
import type { ScheduleRunContext, ScheduleV2 } from '../../shared/scheduleV2'

type BackendSession = Pick<
  AgentSession,
  | 'sessionId'
  | 'modelId'
  | 'onEvent'
  | 'sendTurn'
  | 'steer'
  | 'cancel'
  | 'withdrawQueued'
  | 'dispose'
  | 'rename'
>

/** U registers this individual message before the backend admits it. This is
 * required even for a steer sharing an interactive turn or a queued message. */
export interface ScheduleContextSubmitter {
  submit(
    session: BackendSession,
    context: ScheduleRunContext,
    dispatch: () => Promise<TurnSubmission>,
  ): Promise<TurnSubmission>
}

/** Stop is the backend's public cancel, including Muse Code's approval cleanup.
 * No provider wire shape or alternate cancellation command is introduced. */
export class ScheduleAgentSession implements ScheduleDeliverySession {
  private activeTurnId: string | undefined
  private eventRevision = 0
  private isClosed = false
  private readonly idleListeners = new Set<() => void>()
  private readonly queued = new Map<string, QueuedMessageRef>()
  private readonly stopListening: () => void
  readonly sessionId: string

  constructor(
    private readonly session: BackendSession,
    readonly backend: ScheduleDeliverySession['backend'],
    private readonly contexts: ScheduleContextSubmitter,
    activeTurnId?: string,
  ) {
    this.sessionId = session.sessionId
    this.activeTurnId = activeTurnId
    this.stopListening = session.onEvent((event) => {
      this.observe(event)
    })
  }

  private observe(event: AgentEvent): void {
    if (event.type === 'turnCompleted' || event.type === 'turnWithdrawn') {
      for (const [id, ref] of this.queued) {
        if (ref.turnId === event.turnId) this.queued.delete(id)
      }
    }
    if (event.type === 'turnStarted') {
      this.eventRevision += 1
      this.activeTurnId = event.turnId
    } else if (
      (event.type === 'turnCompleted' && event.turnId === this.activeTurnId) ||
      (event.type === 'sessionStatus' && event.status === 'idle')
    ) {
      this.eventRevision += 1
      this.activeTurnId = undefined
      for (const listener of this.idleListeners) listener()
    } else if (event.type === 'userMessageTurnChanged') {
      for (const [id, ref] of this.queued) {
        if (ref.userMessageId === event.userMessageId)
          this.queued.set(id, { ...ref, turnId: event.turnId })
      }
    }
  }

  private async submit(prompt: string, context: ScheduleRunContext): Promise<TurnSubmission> {
    if (!this.isOpen()) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
    const revision = this.eventRevision
    const submitted = await this.contexts.submit(this.session, context, () =>
      this.session.sendTurn([{ type: 'text', text: prompt }], prompt),
    )
    // An entire short turn can finish before its admission ack returns.
    if (revision === this.eventRevision && submitted.disposition === 'started') {
      this.activeTurnId = submitted.turnId
    }
    return submitted
  }

  isRunning(): boolean {
    return this.activeTurnId !== undefined
  }
  isOpen(): boolean {
    return !this.isClosed
  }

  waitUntilIdle(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !this.isOpen()) return Promise.resolve(false)
    if (!this.isRunning()) return Promise.resolve(true)
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.isOpen() && this.isRunning() && !signal.aborted) return
        this.idleListeners.delete(check)
        signal.removeEventListener('abort', check)
        resolve(this.isOpen() && !signal.aborted)
      }
      this.idleListeners.add(check)
      signal.addEventListener('abort', check, { once: true })
      // Covers an abort or completion between the initial check and subscription.
      check()
    })
  }

  async steer(prompt: string, context: ScheduleRunContext): Promise<void> {
    if (!this.isOpen()) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
    const turnId = this.activeTurnId
    if (turnId === undefined) throw new SteerRefusedError(UI_TEXT.scheduleBusy)
    await this.contexts.submit(this.session, context, () =>
      this.session.steer(turnId, [{ type: 'text', text: prompt }]),
    )
  }

  async send(prompt: string, context: ScheduleRunContext): Promise<void> {
    if (this.isRunning()) throw new Error(UI_TEXT.scheduleBusy)
    await this.submit(prompt, context)
  }

  async queue(prompt: string, context: ScheduleRunContext): Promise<string> {
    const submitted = await this.submit(prompt, context)
    if (submitted.disposition === 'queued' || submitted.disposition === 'steered') {
      this.queued.set(context.runId, {
        turnId: submitted.turnId,
        userMessageId: submitted.userMessageId,
        disposition: submitted.disposition,
      })
    }
    return context.runId
  }

  async withdraw(messageId: string): Promise<boolean> {
    const ref = this.queued.get(messageId)
    if (ref === undefined || this.session.withdrawQueued === undefined) return false
    const result = await this.session.withdrawQueued(ref)
    if (result.status !== 'withdrawn') return false
    this.queued.delete(messageId)
    return true
  }

  cancel(): Promise<void> {
    return this.session.cancel()
  }

  /** Detach adapter listeners. Ownership of the backend session stays with its lease. */
  dispose(): void {
    this.isClosed = true
    this.stopListening()
    this.queued.clear()
    for (const listener of this.idleListeners) listener()
    this.idleListeners.clear()
  }
}

interface BackgroundEntry {
  readonly agent: BackendSession
  readonly session: ScheduleAgentSession
  readonly detach: () => void
  leases: number
}

export interface ScheduleBackgroundTargetDeps {
  /** Existing panel/ACP sessions are borrowed, never disposed by this host. */
  findLive(schedule: ScheduleV2): Promise<ScheduleTargetLease | undefined>
  host(
    backend: ScheduleDeliverySession['backend'],
    workspaceKey: string,
  ): Promise<Pick<AgentHost, 'info' | 'startSession' | 'resumeSession' | 'onExit'>>
  /** Resolve workspace/model/MCP configuration through the existing host. */
  options(schedule: ScheduleV2): Promise<StartSessionOptions>
  readonly contexts: ScheduleContextSubmitter
  /** Bind history/transcript and Agent map without a panel switch. The title is
   * always provided, including on Muse Code where rename is unavailable. */
  publish(
    session: BackendSession,
    details: {
      readonly workspaceKey: string
      readonly backend: ScheduleDeliverySession['backend']
      readonly title: string
      readonly notice: string
      readonly history: SessionHistoryOutcome | undefined
    },
  ): () => void
}

/** No vscode import: runtime/ACP/native editors bind the same host and ports. */
export class ScheduleBackgroundTargets implements ScheduleConversationTargets {
  private readonly resumed = new Map<string, Promise<BackgroundEntry>>()
  constructor(private readonly deps: ScheduleBackgroundTargetDeps) {}

  private key(schedule: ScheduleV2): string {
    if (schedule.target.kind !== 'conversation') throw new Error(UI_TEXT.scheduleInvalid)
    return JSON.stringify([
      schedule.workspaceKey,
      schedule.target.backend,
      schedule.target.sessionId,
    ])
  }

  private lease(entry: BackgroundEntry, key?: string): ScheduleTargetLease {
    entry.leases += 1
    let isReleased = false
    return {
      session: entry.session,
      release: () => {
        if (!isReleased) {
          isReleased = true
          entry.leases -= 1
          if (entry.leases === 0) {
            if (key !== undefined) this.resumed.delete(key)
            entry.session.dispose()
            entry.detach()
            entry.agent.dispose()
          }
        }
        return Promise.resolve()
      },
    }
  }

  private async load(schedule: ScheduleV2, occurrenceMs?: number): Promise<BackgroundEntry> {
    if (schedule.target.kind !== 'conversation' && schedule.target.kind !== 'newConversation') {
      throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
    }
    const backend = schedule.target.backend
    const host = await this.deps.host(backend, schedule.workspaceKey)
    if (host.info.kind !== backend) throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
    const options = await this.deps.options(schedule)
    const loaded =
      occurrenceMs === undefined && schedule.target.kind === 'conversation'
        ? await host.resumeSession(schedule.target.sessionId, options.modelId, options.mcpServers)
        : undefined
    const agent =
      loaded?.session ??
      (await host.startSession({ ...options, approvalMode: mspApprovalMode(schedule.mode) }))
    const session = new ScheduleAgentSession(
      agent,
      backend,
      this.deps.contexts,
      loaded?.activeTurnId,
    )
    const title =
      occurrenceMs === undefined
        ? (loaded?.history.name ?? schedule.name)
        : fill(UI_TEXT.scheduleV2.messages.conversationTitle, {
            name: schedule.name,
            date: formatDateTime(occurrenceMs),
          })
    const stopExit = host.onExit(() => {
      session.dispose()
    })
    try {
      // Older Muse Code cannot rename. Its history adapter still keeps the title.
      if (occurrenceMs !== undefined && host.info.canEditSessions) await agent.rename(title)
      const unpublish = this.deps.publish(agent, {
        workspaceKey: schedule.workspaceKey,
        backend,
        title,
        notice: fill(UI_TEXT.scheduleV2.messages.backgroundNotice, { name: schedule.name }),
        history: loaded?.history,
      })
      return {
        agent,
        session,
        leases: 0,
        detach: () => {
          stopExit()
          unpublish()
        },
      }
    } catch (error: unknown) {
      stopExit()
      session.dispose()
      agent.dispose()
      throw error
    }
  }

  async find(schedule: ScheduleV2): Promise<ScheduleTargetLease | undefined> {
    const live = await this.deps.findLive(schedule)
    if (live !== undefined) return live
    const pending = this.resumed.get(this.key(schedule))
    return pending === undefined ? undefined : this.lease(await pending, this.key(schedule))
  }

  async open(schedule: ScheduleV2): Promise<ScheduleTargetLease> {
    const key = this.key(schedule)
    let pending = this.resumed.get(key)
    if (pending === undefined) {
      pending = this.load(schedule)
      this.resumed.set(key, pending)
    }
    try {
      return this.lease(await pending, key)
    } catch (error: unknown) {
      if (this.resumed.get(key) === pending) this.resumed.delete(key)
      throw error
    }
  }

  async fresh(schedule: ScheduleV2, occurrenceMs: number): Promise<ScheduleTargetLease> {
    return this.lease(await this.load(schedule, occurrenceMs))
  }
}
