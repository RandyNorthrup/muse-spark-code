import type { TurnSubmission } from '../../core/agent/agentBackend'
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
import type { ScheduleBillingPorts, createScheduleBilling } from './paidBinding'
import type { ScheduleCallerContext } from '../../runtime/schedules/args'

type Terminal = Extract<AgentEvent, { type: 'turnCompleted' | 'turnWithdrawn' }>

export interface ScheduleEditorDeliveryPorts {
  readonly billing?: ScheduleBillingPorts
  readonly caller?: () => ScheduleCallerContext
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly dialect: ShellDialect
  readonly io: RealPathIo
  readonly signal: AbortSignal
  signalFor?(session: BackendSession): AbortSignal
  /** Trust, credentials, settings and the owning workspace remain live. */
  isActive(): boolean
  generation?(): number
  readonly host: ScheduleBackgroundTargetDeps['host']
  readonly options: ScheduleBackgroundTargetDeps['options']
  readonly bindSession?: ScheduleBackgroundTargetDeps['bindSession']
  readonly releaseOptions?: ScheduleBackgroundTargetDeps['releaseOptions']
  readonly publish: ScheduleBackgroundTargetDeps['publish']
  findLive(schedule: ScheduleV2):
    | {
        readonly agent: BackendSession
        readonly activeTurnId?: string
        readonly status: string
        readonly signal?: AbortSignal
      }
    | undefined
  row(session: BackendSession, text: string): void
  submitted?(
    session: BackendSession,
    context: ScheduleRunContext,
    text: string,
    submission: TurnSubmission,
  ): void
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
    context: ScheduleRunContext,
    authority: ScheduleAuthorityStore,
  ): Promise<{
    readonly policy: NonNullable<ScheduleRunDeps['paid']>
    cost(): Promise<ScheduleRunSettlement['cost']>
    readonly consent?: ScheduleV2['paidConsent']
  }>
}

interface PendingRun {
  signal: AbortSignal
  agent?: BackendSession
  submitted?: TurnSubmission
  stopLifecycle?: () => void
  readonly schedule: ScheduleV2
  readonly context: ScheduleRunContext
  readonly terminal: Promise<Terminal>
  resolve?: (terminal: Terminal) => void
  reject?: (error: Error) => void
  run?: UnattendedRun
  cost?: () => Promise<ScheduleRunSettlement['cost']>
  stopListening?: () => void
  consent?: ScheduleV2['paidConsent']
}

/** Lazy host composition. The scheduler owns claims and ordering; the backend
 * owns unattended safety and the final turn. No ordinary send can bypass it. */
export function createScheduleDeliveryBinding(
  ports: ScheduleEditorDeliveryPorts,
  authority: ScheduleAuthorityStore,
  billing?: ReturnType<typeof createScheduleBilling>,
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
        entry.signal.aborted ||
        entry.schedule.workspaceKey !== workspaceKey(path.resolve(ports.workspaceRoot))
      )
        throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      if (agent.sendScheduledTurn === undefined || agent.steerScheduledTurn === undefined)
        throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      entry.agent = agent
      entry.signal = AbortSignal.any([entry.signal, ports.signalFor?.(agent) ?? ports.signal])
      const abort = () => entry.reject?.(new Error(UI_TEXT.scheduleV2.messages.targetClosed))
      entry.signal.addEventListener('abort', abort, { once: true })
      entry.stopLifecycle = () => {
        entry.signal.removeEventListener('abort', abort)
      }
      if (entry.signal.aborted) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
      if (entry.run === undefined) {
        const paid =
          billing !== undefined &&
          'backend' in entry.schedule.target &&
          entry.schedule.target.backend === 'modelApi'
            ? await billing.paid(entry.schedule, agent, context, authority)
            : await ports.paid?.(entry.schedule, agent, context, authority)
        entry.consent = paid?.consent ?? entry.schedule.paidConsent
        if (
          paid === undefined &&
          'backend' in entry.schedule.target &&
          entry.schedule.target.backend === 'modelApi'
        )
          throw new Error(UI_TEXT.schedulePaidOff)
        entry.cost = () => (paid === undefined ? Promise.resolve(noScheduleCost()) : paid.cost())
        const modelId = agent.modelId
        const windowGeneration = ports.generation?.()
        const authorityGeneration = authority.generation?.(
          entry.schedule.workspaceKey,
          entry.schedule.id,
        )
        let isAuthorityIsCurrent = true
        entry.run = new UnattendedRun({
          context,
          modelText: SCHEDULE_MODEL_TEXT,
          workspaceRoot: ports.workspaceRoot,
          platform: ports.platform,
          io: ports.io,
          matcher: new ScheduleGrants(ports.dialect),
          now: Date.now,
          isActive: () =>
            isAuthorityIsCurrent &&
            ports.isActive() &&
            !entry.signal.aborted &&
            !ports.signal.aborted &&
            pending.has(context.runId) &&
            agent.modelId === modelId &&
            ports.generation?.() === windowGeneration &&
            authority.generation?.(entry.schedule.workspaceKey, entry.schedule.id) ===
              authorityGeneration,
          checkDispatch: async () => {
            const live = await authority.read(entry.schedule.workspaceKey, entry.schedule.id)
            const check = () => {
              isAuthorityIsCurrent =
                live !== undefined &&
                !live.paused &&
                live.mode === entry.schedule.mode &&
                JSON.stringify(live.grant) === JSON.stringify(context.grant) &&
                JSON.stringify(live.paidConsent) === JSON.stringify(entry.consent)
              if (!isAuthorityIsCurrent || !entry.run?.isActive())
                throw new Error(UI_TEXT.scheduleV2.messages.changedConsent)
            }
            check()
            return check
          },
          readGrant: async () => {
            const current = await authority.read(entry.schedule.workspaceKey, entry.schedule.id)
            return current === undefined ||
              current.paused ||
              current.mode !== entry.schedule.mode ||
              JSON.stringify(current.paidConsent) !== JSON.stringify(entry.consent)
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
      const publish = () => {
        if (submitted !== undefined && entry.schedule.action.kind === 'prompt')
          ports.submitted?.(agent, context, entry.schedule.action.prompt, submitted)
      }
      const stop = agent.onEvent((event) => {
        if (event.type === 'userMessageTurnChanged') {
          promoted.set(event.userMessageId, event.turnId)
          if (
            submitted?.userMessageId === event.userMessageId ||
            submitted?.turnId === event.userMessageId
          ) {
            entry.submitted = submitted = { ...submitted, turnId: event.turnId }
            publish()
          }
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
        const seen = new Set<string>()
        let promotedTurn = promoted.get(submitted.userMessageId ?? submitted.turnId)
        while (promotedTurn !== undefined && !seen.has(promotedTurn)) {
          seen.add(promotedTurn)
          submitted = { ...submitted, turnId: promotedTurn }
          promotedTurn = promoted.get(promotedTurn)
        }
        entry.submitted = submitted
        const terminal = terminals.get(submitted.turnId)
        if (terminal !== undefined) entry.resolve?.(terminal)
        publish()
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
    ...(ports.bindSession !== undefined && {
      bindSession: (session: BackendSession, options) => ports.bindSession?.(session, options),
    }),
    ...(ports.releaseOptions !== undefined && {
      releaseOptions: (options) => ports.releaseOptions?.(options),
    }),
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
        live.signal,
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
      async run(session, schedule, context, dispatch): Promise<ScheduleRunSettlement> {
        if (pending.has(context.runId)) throw new Error(UI_TEXT.scheduleAlreadyRun)
        const signal =
          session instanceof ScheduleAgentSession
            ? AbortSignal.any([ports.signal, session.signal])
            : ports.signal
        const handlers: Pick<PendingRun, 'resolve' | 'reject'> = {}
        const terminal = new Promise<Terminal>((resolve, reject) => {
          handlers.resolve = resolve
          handlers.reject = reject
        })
        const entry: PendingRun = { schedule, context, terminal, signal, ...handlers }
        pending.set(context.runId, entry)
        const abort = () => entry.reject?.(new Error(UI_TEXT.scheduleV2.messages.targetClosed))
        signal.addEventListener('abort', abort, { once: true })
        // A lifecycle abort can arrive during admission, before we await terminal.
        void entry.terminal.catch(String)
        let result: Omit<ScheduleRunSettlement, 'cost'>
        try {
          if (signal.aborted) throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
          await dispatch()
          if (entry.run === undefined) result = { outcome: 'missed', refusedActions: [] }
          else {
            const terminal = await entry.terminal
            let outcome: ScheduleRunSettlement['outcome'] = 'skipped'
            if (terminal.type === 'turnCompleted')
              outcome = terminal.terminal === 'completed' ? 'ran' : 'failed'
            result = {
              outcome,
              ...(terminal.type === 'turnCompleted' &&
                terminal.reason !== undefined && { reason: terminal.reason }),
              refusedActions: entry.run.refusedActions,
            }
            if (entry.run.dispatchRefusal !== undefined || !entry.run.isActive())
              result = {
                ...result,
                outcome: 'refused',
                reason: entry.run.dispatchRefusal ?? UI_TEXT.scheduleV2.messages.changedConsent,
              }
          }
        } catch (error: unknown) {
          // Losing the host is not a settled turn. Retain the durable admission
          // fence for recovery rather than recording a bill before settlement.
          if (entry.signal.aborted || !session.isOpen()) {
            if (entry.submitted?.disposition === 'queued') {
              const withdrawal = await entry.agent?.withdrawQueued?.({
                ...entry.submitted,
                userMessageId: entry.submitted.userMessageId,
              })
              if (withdrawal?.status !== 'withdrawn') throw error
            } else if (entry.submitted?.disposition === 'started') await entry.agent?.cancel()
            result = {
              outcome: 'skipped',
              reason: UI_TEXT.scheduleV2.messages.targetClosed,
              refusedActions: entry.run?.refusedActions ?? [],
            }
          } else
            result = {
              outcome:
                entry.run !== undefined &&
                (entry.run.dispatchRefusal !== undefined || !entry.run.isActive())
                  ? 'refused'
                  : 'failed',
              reason:
                entry.run?.dispatchRefusal ??
                (entry.run !== undefined && !entry.run.isActive()
                  ? UI_TEXT.scheduleV2.messages.changedConsent
                  : UI_TEXT.scheduleCommandFailed),
              refusedActions: entry.run?.refusedActions ?? [],
            }
        } finally {
          signal.removeEventListener('abort', abort)
        }
        try {
          // A ledger failure keeps S's admitted recovery fence; never retry a
          // settlement callback or invent a zero bill after it throws.
          return { ...result, cost: await (entry.cost?.() ?? Promise.resolve(noScheduleCost())) }
        } finally {
          entry.stopListening?.()
          entry.stopLifecycle?.()
          pending.delete(context.runId)
        }
      },
    },
  }
}
