import path from 'node:path'
import { realpath } from 'node:fs/promises'
import type { AcpBackend } from '../../acp/agent'
import type { AcpScheduleSession } from '../../acp/schedules'
import type { AgentSession } from '../../core/agent/agentBackend'
import type { ScheduleDeliveryDeps, ScheduleTargetLease } from '../../core/schedules/delivery'
import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import {
  createScheduleDeliveryBinding,
  type ScheduleEditorDeliveryPorts,
} from '../../host/schedules/deliveryBinding'
import type { BackendSession } from '../../host/schedules/backgroundTarget'
import { isChildTurn } from '../../shared/agentEvents'
import { CONTRIBUTOR_MODEL_SUFFIX, UI_TEXT } from '../../shared/constants'
import { createScheduleBilling, type ScheduleBillingPorts } from '../../host/schedules/paidBinding'
import type { ScheduleCallerContext } from './args'
import type { ScheduleV2 } from '../../shared/scheduleV2'
import { workspaceKey } from '../dataFolder'
import type { createWorkspaceRegistry } from './registry'

export interface RuntimeScheduleDeliveryPorts {
  billing?(
    cwd: string,
    modelId: string,
    caller?: ScheduleCallerContext,
  ): Promise<ScheduleBillingPorts>
  backendFor(backend: AcpBackend['kind']): Promise<AcpBackend>
  readonly allowsContributorModels: boolean
  row(text: string): void
  deferQuestions(
    session: AgentSession,
    backend: AcpBackend['kind'],
    ...args: Parameters<AcpScheduleSession['deferQuestions']>
  ): Promise<void>
  readonly paid?: ScheduleEditorDeliveryPorts['paid']
}

function unavailable(): Error {
  return new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
}

/** Shared delivery owns claims and grants. This supplier owns runtime sessions. */
export function createRuntimeScheduleDelivery(
  ports: RuntimeScheduleDeliveryPorts,
  authority: ScheduleAuthorityStore,
  registry: ReturnType<typeof createWorkspaceRegistry>,
) {
  const abort = new AbortController()
  const live = new Map<
    string,
    {
      readonly owner: AcpScheduleSession
      readonly root: string
      readonly abort: AbortController
      activeTurnId: string | undefined
      status: string
    }
  >()
  const background = new Map<BackendSession, { agent: AgentSession; backend: AcpBackend['kind'] }>()
  const bindings = new Map<
    string,
    Promise<Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>>
  >()
  const readyBindings = new Map<string, Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>>()
  const sessionAborts = new Map<BackendSession, AbortController>()
  const liveKey = (root: string, backend: AcpBackend['kind'], sessionId: string) =>
    JSON.stringify([workspaceKey(root), backend, sessionId])
  const leaseFor = (lease: ScheduleTargetLease, lifetime = abort.signal): ScheduleTargetLease => {
    const session = lease.session
    const signal = AbortSignal.any([abort.signal, lifetime])
    return {
      release: () => lease.release(),
      session: {
        backend: session.backend,
        sessionId: session.sessionId,
        isOpen: () => !signal.aborted && session.isOpen(),
        isRunning: () => session.isRunning(),
        send: (prompt, context) => session.send(prompt, context),
        steer: (prompt, context) => session.steer(prompt, context),
        queue: (prompt, context) => session.queue(prompt, context),
        withdraw: (id) => session.withdraw(id),
        cancel: () => session.cancel(),
        waitUntilIdle: (waiting) => session.waitUntilIdle(AbortSignal.any([waiting, signal])),
        queueWhenIdle: (prompt, context, waiting) =>
          session.queueWhenIdle(prompt, context, AbortSignal.any([waiting, signal])),
      },
    }
  }
  const ownerFor = (session: BackendSession): AcpScheduleSession | undefined => {
    for (const entry of live.values()) if (entry.owner.agent === session) return entry.owner
    return undefined
  }
  const bindingFor = (schedule: ScheduleV2) => {
    let pending = bindings.get(schedule.workspaceKey)
    if (pending === undefined) {
      pending = (async () => {
        const root = await registry.root(schedule.workspaceKey)
        if (root === undefined || abort.signal.aborted) throw unavailable()
        const fullSessions = new Map<BackendSession, AgentSession>()
        const hostFor = async (backend: AcpBackend['kind']) => {
          if (abort.signal.aborted) throw unavailable()
          const runtime = await ports.backendFor(backend)
          const readiness = await runtime.readiness(false)
          if (runtime.kind !== backend || readiness.state !== 'ready') throw unavailable()
          const host = await runtime.hostFor(root)
          const owned = new Set<BackendSession>()
          return {
            info: host.info,
            onExit: (listener: Parameters<typeof host.onExit>[0]) =>
              host.onExit((event) => {
                for (const session of owned) sessionAborts.get(session)?.abort()
                listener(event)
              }),
            startSession: async (...args: Parameters<typeof host.startSession>) => {
              const session = await host.startSession(...args)
              if (abort.signal.aborted) {
                session.dispose()
                throw unavailable()
              }
              fullSessions.set(session, session)
              owned.add(session)
              sessionAborts.set(session, new AbortController())
              return session
            },
            resumeSession: async (...args: Parameters<typeof host.resumeSession>) => {
              const loaded = await host.resumeSession(...args)
              if (abort.signal.aborted) {
                loaded.session.dispose()
                throw unavailable()
              }
              fullSessions.set(loaded.session, loaded.session)
              owned.add(loaded.session)
              sessionAborts.set(loaded.session, new AbortController())
              return loaded
            },
          }
        }
        const row = (session: BackendSession, text: string) => {
          const owner = ownerFor(session)
          if (owner === undefined) ports.row(text)
          else owner.row(text)
        }
        let paid: ScheduleEditorDeliveryPorts['paid']
        if (ports.billing !== undefined)
          paid = async (job, agent, context, authority) => {
            // Native subscription turns need no Model API billing route.
            if ('backend' in job.target && job.target.backend === 'museCode')
              return await ports.paid?.(job, agent, context, authority)
            if (ports.billing === undefined) throw unavailable()
            return await createScheduleBilling(await ports.billing(root, agent.modelId)).paid(
              job,
              agent,
              context,
              authority,
            )
          }
        else if (ports.paid !== undefined) paid = async (...args) => await ports.paid?.(...args)
        const binding = createScheduleDeliveryBinding(
          {
            workspaceRoot: root,
            platform: process.platform,
            dialect: process.platform === 'win32' ? 'powershell' : 'bash',
            io: { realPath: realpath },
            signal: abort.signal,
            signalFor: (session) => sessionAborts.get(session)?.signal ?? abort.signal,
            isActive: () => !abort.signal.aborted,
            host: (backend) => hostFor(backend),
            options: async (job) => {
              if (!('backend' in job.target)) throw unavailable()
              const host = await hostFor(job.target.backend)
              // Use the same listed default as ACP; never invent a provider model.
              const runtime = await ports.backendFor(job.target.backend)
              const backendHost = await runtime.hostFor(root)
              const models = await backendHost.listModels()
              const offered = models.filter(
                (item) =>
                  ports.allowsContributorModels || !item.modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX),
              )
              const model = offered.find((item) => item.isDefault) ?? offered[0]
              if (model === undefined || host.info.kind !== job.target.backend) throw unavailable()
              return {
                workspaceRoot: root,
                modelId: model.modelId,
                approvalMode: 'promptUnmatched',
              }
            },
            findLive: (job) => {
              if (job.target.kind !== 'conversation') return
              const entry = live.get(liveKey(root, job.target.backend, job.target.sessionId))
              return entry === undefined
                ? undefined
                : {
                    agent: entry.owner.agent,
                    status: entry.status,
                    ...(entry.activeTurnId !== undefined && { activeTurnId: entry.activeTurnId }),
                  }
            },
            publish: (session, details) => {
              const agent = fullSessions.get(session)
              if (agent === undefined || abort.signal.aborted) throw unavailable()
              background.set(session, { agent, backend: details.backend })
              row(session, details.notice)
              const stop = session.onEvent((event) => {
                if (
                  event.type === 'itemCompleted' &&
                  event.item.kind === 'agentMessage' &&
                  event.item.text !== undefined
                )
                  row(session, event.item.text)
              })
              return () => {
                stop()
                background.delete(session)
                fullSessions.delete(session)
                sessionAborts.delete(session)
              }
            },
            row,
            deferQuestions: async (session, event, context) => {
              const owner = ownerFor(session)
              if (owner !== undefined) {
                await owner.deferQuestions(event, context)
                return
              }
              const entry = background.get(session)
              if (entry === undefined) throw unavailable()
              await ports.deferQuestions(entry.agent, entry.backend, event, context)
            },
            safety: () => {
              // UnattendedRun enforces the portable class/path policy. The
              // runtime installs no additional physical or vault adapters.
            },
            ...(paid !== undefined && { paid }),
          },
          authority,
        )
        readyBindings.set(schedule.workspaceKey, binding)
        return binding
      })()
      bindings.set(schedule.workspaceKey, pending)
      void pending.catch(() => {
        if (bindings.get(schedule.workspaceKey) === pending) bindings.delete(schedule.workspaceKey)
      })
    }
    return pending
  }
  return {
    async consent(schedule: ScheduleV2, cwd: string, caller?: ScheduleCallerContext) {
      if (ports.billing === undefined || abort.signal.aborted) return
      const owner =
        schedule.target.kind === 'conversation'
          ? live.get(liveKey(path.resolve(cwd), schedule.target.backend, schedule.target.sessionId))
          : undefined
      const backend = await ports.backendFor('modelApi')
      const host = await backend.hostFor(cwd)
      const models = await host.listModels()
      const offered = models.filter(
        (model) =>
          ports.allowsContributorModels || !model.modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX),
      )
      const modelId =
        owner?.owner.agent.modelId ??
        offered.find((model) => model.isDefault)?.modelId ??
        offered[0]?.modelId
      if (modelId === undefined) throw unavailable()
      return await createScheduleBilling(await ports.billing(cwd, modelId, caller)).consent(
        schedule,
      )
    },
    delivery: {
      targets: {
        find: async (schedule) => {
          const binding = await bindingFor(schedule)
          // Capture the same owner findLive borrows before acquisition yields;
          // a replacement with the same id cannot lend its lifetime to this lease.
          const owner =
            schedule.target.kind === 'conversation'
              ? live.get(
                  JSON.stringify([
                    schedule.workspaceKey,
                    schedule.target.backend,
                    schedule.target.sessionId,
                  ]),
                )
              : undefined
          const lease = await binding.targets.find(schedule)
          return lease === undefined ? undefined : leaseFor(lease, owner?.abort.signal)
        },
        open: async (schedule) => {
          const binding = await bindingFor(schedule)
          return leaseFor(await binding.targets.open(schedule))
        },
        fresh: async (schedule, occurrence) => {
          const binding = await bindingFor(schedule)
          return leaseFor(await binding.targets.fresh(schedule, occurrence))
        },
      },
      runs: {
        run: async (session, schedule, context, dispatch) => {
          const binding = await bindingFor(schedule)
          return await binding.runs.run(session, schedule, context, dispatch)
        },
      },
      prompt: (schedule, event) => {
        const binding = readyBindings.get(schedule.workspaceKey)
        if (binding === undefined) throw unavailable()
        return binding.prompt(schedule, event)
      },
    } satisfies Pick<ScheduleDeliveryDeps, 'targets' | 'runs' | 'prompt'>,
    attach(cwd: string, owner: AcpScheduleSession): () => void {
      if (abort.signal.aborted) throw unavailable()
      const root = path.resolve(cwd)
      const key = liveKey(root, owner.backend, owner.agent.sessionId)
      if (live.has(key)) throw unavailable()
      const entry = {
        owner,
        root,
        abort: new AbortController(),
        activeTurnId: owner.activeTurnId,
        status: owner.activeTurnId === undefined ? 'idle' : 'running',
      }
      live.set(key, entry)
      sessionAborts.set(owner.agent, entry.abort)
      const childIds = new Set<string>()
      const stop = owner.agent.onEvent((event) => {
        if (
          'item' in event &&
          event.item.kind === 'subagent' &&
          event.item.childSessionId !== undefined
        )
          childIds.add(event.item.childSessionId)
        if (
          'turnId' in event &&
          typeof event.turnId === 'string' &&
          isChildTurn(event.turnId, childIds)
        )
          return
        if (event.type === 'turnStarted') entry.activeTurnId = event.turnId
        else if (event.type === 'turnCompleted' && entry.activeTurnId === event.turnId)
          entry.activeTurnId = undefined
        if (event.type === 'sessionStatus') entry.status = event.status
      })
      return () => {
        entry.abort.abort()
        if (live.get(key) === entry) live.delete(key)
        if (sessionAborts.get(owner.agent) === entry.abort) sessionAborts.delete(owner.agent)
        stop()
      }
    },
    async close(): Promise<void> {
      abort.abort()
      await Promise.allSettled(Array.from(background.values(), (entry) => entry.agent.cancel()))
      live.clear()
      sessionAborts.clear()
      bindings.clear()
      readyBindings.clear()
    },
  }
}
