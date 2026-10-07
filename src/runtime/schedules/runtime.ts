import { UI_TEXT } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { acpSchedules, type AcpScheduleContext } from '../../acp/schedules'
import { runScheduleCommand, type ScheduleControlPort } from './command'
import { settleScheduleCommand, type ScheduleCommandResult } from './settle'
import type { ScheduleCommandOptions, ScheduleCallerContext } from './args'
import type { RuntimeSchedulesBinding } from './binding'
import type { RuntimeScheduleHost } from './host'
import type { ScheduleBackgroundCoordinator } from './background'
import type { ScheduleSurface } from './surface'
import type { ScheduleReportCliPort } from './reportCli'
import { scheduleLauncherReason, type ScheduleWakeAuthorization } from './registration'

export interface ScheduleRuntimeDeps {
  readonly reportCli?: ScheduleReportCliPort
  /** S supplies a scoped control, with a real close for that invocation. */
  readonly controlFor: (cwd: string, caller: ScheduleCallerContext) => Promise<ScheduleControlPort>
  readonly host: RuntimeScheduleHost
  readonly surface: ScheduleSurface
  readonly background: ScheduleBackgroundCoordinator
  /** S starts/stops its polling engine with the workspace's process lifetime. */
  readonly watchWorkspace: (cwd: string) => Promise<() => Promise<void>>
  /** S's validated persisted workspace registry, never an untrusted event path. */
  readonly dueWorkspaces: () => Promise<readonly string[]>
  readonly close: () => Promise<void>
  /** Re-read and verify the native definition/record before each engine admission. */
  readonly verifyWake: (registrationId?: string) => Promise<ScheduleWakeAuthorization>
  readonly platform?: NodeJS.Platform
}

/** Concrete glue over the injected S/U/D engine, never a second scheduler. */
export class ScheduleRuntime implements RuntimeSchedulesBinding {
  private readonly leases = new Set<() => Promise<void>>()
  private readonly acp
  private closed = false
  private isMacWake = false
  constructor(private readonly deps: ScheduleRuntimeDeps) {
    this.acp = acpSchedules((context) =>
      this.control(context.cwd, {
        ...context,
        source: 'acp',
        isInteractive: true,
        scheduledPrompts: context.scheduledPrompts === true,
      }),
    )
  }
  private assertOpen(): void {
    if (this.closed) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  }
  private async control(cwd: string, caller: ScheduleCallerContext): Promise<ScheduleControlPort> {
    this.assertOpen()
    const control = await this.deps.controlFor(cwd, caller)
    if (this.closed) {
      await control.close()
      this.assertOpen()
    }
    return {
      request: (input) =>
        this.deps.surface.request(
          input,
          workspaceKey(cwd),
          (request, context) => control.request(request, context),
          caller,
        ),
      runDue: async () => {
        const releases: (() => Promise<void>)[] = []
        const failures: unknown[] = []
        try {
          // dueWorkspaces are keys, not paths: hold them directly instead of
          // re-hashing them through holdWorkspace's path handling.
          const workspaces = await this.deps.dueWorkspaces()
          for (const workspace of workspaces) {
            const release = this.deps.host.hold(workspace)
            releases.push(() => {
              release()
              return Promise.resolve()
            })
          }
          await control.runDue()
        } catch (error: unknown) {
          failures.push(error)
        } finally {
          const results = await Promise.allSettled(releases.map((release) => release()))
          for (const result of results)
            if (result.status === 'rejected') failures.push(result.reason)
        }
        if (failures.length > 0)
          throw new AggregateError(failures, UI_TEXT.scheduleV2.runtime.unavailable)
      },
      close: () => control.close(),
    }
  }
  async command(
    options: ScheduleCommandOptions,
    cwd: string,
    isInteractive = false,
  ): Promise<ScheduleCommandResult> {
    this.isMacWake =
      options.operation === 'run-due' && (this.deps.platform ?? process.platform) === 'darwin'
    let authorization: ScheduleWakeAuthorization = {
      scheduledPrompts: options.scheduledPrompts === true,
      ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
    }
    if (options.operation === 'run-due') {
      try {
        if (this.isMacWake) await this.deps.background.wakeBarrier()
      } catch {
        const reason = UI_TEXT.scheduleV2.runtime.wakeBarrierTimeout
        return {
          exitCode: 1,
          output: options.isJson ? JSON.stringify({ kind: 'refused', reason }) : reason,
        }
      }
      try {
        authorization = await this.deps.verifyWake(options.registrationId)
      } catch (error: unknown) {
        const reason = scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.runtime.invalidRequest
        return {
          exitCode: 1,
          output: options.isJson ? JSON.stringify({ kind: 'refused', reason }) : reason,
        }
      }
    }
    const control = await this.control(cwd, {
      source: 'cli',
      isInteractive,
      ...authorization,
    })
    return await settleScheduleCommand(
      () => runScheduleCommand(options, cwd, control, this.deps.reportCli),
      () => (options.operation === 'run-due' ? this.close() : Promise.resolve()),
    )
  }
  async run(text: string, context: AcpScheduleContext): Promise<string> {
    this.assertOpen()
    return await this.acp.run(text, context)
  }
  async holdWorkspace(cwd: string): Promise<() => Promise<void>> {
    this.assertOpen()
    const unhold = this.deps.host.hold(workspaceKey(cwd))
    let unwatch: () => Promise<void>
    try {
      unwatch = await this.deps.watchWorkspace(cwd)
    } catch (error: unknown) {
      unhold()
      throw error
    }
    let isReleased = false
    const release = async () => {
      if (isReleased) return
      isReleased = true
      this.leases.delete(release)
      unhold()
      await unwatch()
    }
    if (this.closed) {
      await release()
      this.assertOpen()
    }
    this.leases.add(release)
    return release
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      const results = await Promise.allSettled([...this.leases].map((release) => release()))
      if (results.some((result) => result.status === 'rejected'))
        throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
    } finally {
      try {
        await this.deps.close()
      } finally {
        if (!this.isMacWake) await this.deps.background.reconcile()
      }
    }
  }
}
