import type { AgentSession, TurnSubmission } from '../../core/agent/agentBackend'
import path from 'node:path'
import { workspaceKey } from '../../runtime/dataFolder'
import type { ShellDialect } from '../../core/backends/modelapi/shellSyntax'
import type { ScheduleDeliveryDeps, ScheduleRunSettlement } from '../../core/schedules/delivery'
import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import { ScheduleGrants } from '../../core/schedules/grant'
import { UnattendedRun, type ScheduleRunDeps } from '../../core/schedules/unattended'
import type { RealPathIo } from '../../core/workspacePath'
import type { AgentEvent } from '../../shared/agentEvents'
import { SCHEDULE_MODEL_TEXT, UI_TEXT } from '../../shared/constants'
import { noScheduleCost, type ScheduleRunContext, type ScheduleV2 } from '../../shared/scheduleV2'
import {
  ScheduleAgentSession,
  ScheduleBackgroundTargets,
  type ScheduleBackgroundTargetDeps,
  type BackendSession,
  type ScheduleContextSubmitter,
} from './backgroundTarget'

type Terminal = Extract<AgentEvent, { type: 'turnCompleted' | 'turnWithdrawn' }>

export interface ScheduleEditorDeliveryPorts {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly dialect: ShellDialect
  readonly io: RealPathIo
  readonly signal: AbortSignal
  /** A borrowed target's owner can detach independently of the workspace. */
  signalFor?(session: BackendSession): AbortSignal
  /** Trust, credentials, settings and the owning workspace remain live. */
  isActive(): boolean
  readonly host: ScheduleBackgroundTargetDeps['host']
  readonly options: ScheduleBackgroundTargetDeps['options']
  readonly publish: ScheduleBackgroundTargetDeps['publish']
  findLive(schedule: ScheduleV2):
    | {
        readonly agent: AgentSession
        readonly activeTurnId?: string
        readonly status: string
      }
    | undefined
  row(session: BackendSession, text: string): void
  deferQuestions(
    session: BackendSession,
    event: Extract<AgentEvent, { type: 'questionRequested' }>,
    context: ScheduleRunContext,
  ): Promise<void>
  readonly safety: ScheduleRunDeps['safety']
  /** Paid delivery requires an authoritative ledger; terminal events alone
   * never establish cost. C-M115-3 installs consent and both reservations. */
  paid?(
    schedule: ScheduleV2,
    session: BackendSession,
  ): Promise<{
    readonly policy: NonNullable<ScheduleRunDeps['paid']>
    cost(): Promise<ScheduleRunSettlement['cost']>
  }>
}

interface PendingRun {
  readonly schedule: ScheduleV2
  readonly context: ScheduleRunContext
  readonly terminal: Promise<Terminal>
  resolve?: (terminal: Terminal) => void
  reject?: (error: Error) => void
  run?: UnattendedRun
  cost?: () => Promise<ScheduleRunSettlement['cost']>
  stopListening?: () => void
  stopLifecycle?: () => void
  signal?: AbortSignal
  agent?: BackendSession
  submitted?: TurnSubmission
}

/** Lazy host composition. The scheduler owns claims and ordering; the backend
 * owns unattended safety and the final turn. No ordinary send can bypass it. */
export function createScheduleDeliveryBinding(
  ports: ScheduleEditorDeliveryPorts,
  authority: ScheduleAuthorityStore,
): Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'> {
  const pending = new Map<string, PendingRun>()
  const contexts: ScheduleContextSubmitter = {
    async submit(agent, context, dispatch): Promise<TurnSubmission> {
      const entry = pending.get(context.runId)
      if (entry === undefined || JSON.stringify(context) !== JSON.stringify(entry.context))
        throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      if (
        !ports.isActive() ||
        ports.signal.aborted ||
        entry.schedule.workspaceKey !== workspaceKey(path.resolve(ports.workspaceRoot))
      )
        throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      if (agent.sendScheduledTurn === undefined || agent.steerScheduledTurn === undefined)
        throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      entry.agent = agent
      entry.stopLifecycle?.()
      entry.signal = AbortSignal.any([ports.signal, ports.signalFor?.(agent) ?? ports.signal])
      const abort = () => entry.reject?.(new Error(UI_TEXT.scheduleV2.messages.targetClosed))
      entry.signal.addEventListener('abort', abort, { once: true })
      entry.stopLifecycle = () => entry.signal?.removeEventListener('abort', abort)
      if (entry.signal.aborted) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
      if (entry.run === undefined) {
        const paid = await ports.paid?.(entry.schedule, agent)
        if (
          paid === undefined &&
          'backend' in entry.schedule.target &&
          entry.schedule.target.backend === 'modelApi'
        )
          throw new Error(UI_TEXT.schedulePaidOff)
        entry.cost = () => (paid === undefined ? Promise.resolve(noScheduleCost()) : paid.cost())
        entry.run = new UnattendedRun({
          context,
          modelText: SCHEDULE_MODEL_TEXT,
          workspaceRoot: ports.workspaceRoot,
          platform: ports.platform,
          io: ports.io,
          matcher: new ScheduleGrants(ports.dialect),
          now: Date.now,
          isActive: () =>
            ports.isActive() && entry.signal?.aborted !== true && pending.has(context.runId),
          readGrant: async () => {
            const current = await authority.read(entry.schedule.workspaceKey, entry.schedule.id)
            return current === undefined ||
              current.paused ||
              current.mode !== entry.schedule.mode ||
              JSON.stringify(current.paidConsent) !== JSON.stringify(entry.schedule.paidConsent)
              ? undefined
              : current.grant
          },
          audit: (audit) => authority.append(audit),
          row: (text) => {
            ports.row(agent, text)
          },
          deferQuestions: (event, runContext) => ports.deferQuestions(agent, event, runContext),
          safety: (action, requester) => ports.safety(action, requester),
          ...(paid !== undefined && { paid: paid.policy }),
        })
      }
      if (!entry.run.isActive()) throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      const terminals = new Map<string, Terminal>()
      const promoted = new Map<string, string>()
      let submitted: TurnSubmission | undefined
      const stop = agent.onEvent((event) => {
        if (event.type === 'userMessageTurnChanged') {
          promoted.set(event.userMessageId, event.turnId)
          if (submitted?.userMessageId === event.userMessageId)
            entry.submitted = submitted = { ...submitted, turnId: event.turnId }
        } else if (event.type === 'turnCompleted' || event.type === 'turnWithdrawn') {
          terminals.set(event.turnId, event)
        }
        if (submitted === undefined) return
        const terminal = terminals.get(submitted.turnId)
        if (terminal !== undefined) entry.resolve?.(terminal)
      })
      entry.stopListening?.()
      entry.stopListening = stop
      try {
        submitted = await dispatch(entry.run)
        const promotedTurn =
          submitted.userMessageId === undefined ? undefined : promoted.get(submitted.userMessageId)
        if (promotedTurn !== undefined) submitted = { ...submitted, turnId: promotedTurn }
        entry.submitted = submitted
        const terminal = terminals.get(submitted.turnId)
        if (terminal !== undefined) entry.resolve?.(terminal)
        return submitted
      } catch (error: unknown) {
        stop()
        throw error
      }
    },
  }
  const targets = new ScheduleBackgroundTargets({
    contexts,
    host: (backend, key) => ports.host(backend, key),
    options: (schedule) => ports.options(schedule),
    publish: (session, details) => ports.publish(session, details),
    findLive: (schedule) => {
      const live = ports.findLive(schedule)
      if (live === undefined || schedule.target.kind !== 'conversation')
        return Promise.resolve(undefined)
      const session = new ScheduleAgentSession(
        live.agent,
        schedule.target.backend,
        contexts,
        live.activeTurnId,
        [],
        live.status,
      )
      return Promise.resolve({
        session,
        release: () => {
          session.dispose()
          return Promise.resolve()
        },
      })
    },
  })
  return {
    targets,
    prompt: (schedule, event) => {
      if (schedule.action.kind !== 'prompt')
        throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
      // The event was validated/frozen by delivery. Keep it fenced and wholly
      // inside user input; it cannot become a grant, system note or tool list.
      return event === undefined
        ? schedule.action.prompt
        : `${schedule.action.prompt}\n\n${SCHEDULE_MODEL_TEXT.eventUntrusted}\n\`\`\`json\n${JSON.stringify({ trust: 'untrusted', event })}\n\`\`\``
    },
    runs: {
      async run(_session, schedule, context, dispatch): Promise<ScheduleRunSettlement> {
        if (pending.has(context.runId)) throw new Error(UI_TEXT.scheduleAlreadyRun)
        const handlers: Pick<PendingRun, 'resolve' | 'reject'> = {}
        const terminal = new Promise<Terminal>((resolve, reject) => {
          handlers.resolve = resolve
          handlers.reject = reject
        })
        const entry: PendingRun = { schedule, context, terminal, ...handlers }
        pending.set(context.runId, entry)
        const abort = () => entry.reject?.(new Error(UI_TEXT.scheduleV2.messages.targetClosed))
        ports.signal.addEventListener('abort', abort, { once: true })
        // A lifecycle abort can arrive during admission, before we await terminal.
        void entry.terminal.catch(String)
        let result: Omit<ScheduleRunSettlement, 'cost'>
        try {
          try {
            if (ports.signal.aborted) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
            await dispatch()
            if (entry.run === undefined)
              result = {
                outcome: 'missed',
                reason: UI_TEXT.scheduleV2.messages.targetClosed,
                refusedActions: [],
              }
            else {
              const terminal = await entry.terminal
              let outcome: ScheduleRunSettlement['outcome'] = 'skipped'
              if (terminal.type === 'turnCompleted')
                outcome = terminal.terminal === 'completed' ? 'ran' : 'failed'
              result = {
                outcome,
                ...(terminal.reason !== undefined && { reason: terminal.reason }),
                refusedActions: entry.run.refusedActions,
              }
            }
          } catch {
            if (ports.signal.aborted || entry.signal?.aborted === true || !_session.isOpen()) {
              // Withdrawal addresses this run's queued message, never the user's
              // running turn. Admission may have returned only after close.
              if (entry.submitted?.disposition === 'queued') {
                const withdrawal = await entry.agent?.withdrawQueued?.({
                  ...entry.submitted,
                  userMessageId: entry.submitted.userMessageId,
                })
                if (withdrawal?.status !== 'withdrawn')
                  throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
              } else if (entry.submitted?.disposition === 'started') await entry.agent?.cancel()
              result = {
                outcome: 'skipped',
                reason: UI_TEXT.scheduleV2.messages.targetClosed,
                refusedActions: entry.run?.refusedActions ?? [],
              }
            } else {
              result = {
                outcome: 'failed',
                reason: UI_TEXT.scheduleCommandFailed,
                refusedActions: entry.run?.refusedActions ?? [],
              }
            }
          }
          // Settle the paid ledger once; the runtime retains conservative
          // liability if this callback throws.
          return { ...result, cost: await (entry.cost?.() ?? Promise.resolve(noScheduleCost())) }
        } finally {
          ports.signal.removeEventListener('abort', abort)
          entry.stopListening?.()
          entry.stopLifecycle?.()
          pending.delete(context.runId)
        }
      },
    },
  }
}
