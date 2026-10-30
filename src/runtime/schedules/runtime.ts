import { UI_TEXT } from '../../shared/constants'
import { wireWordForLog, type CoreLogger } from '../../core/logging'
import path from 'node:path'
import { workspaceKey } from '../dataFolder'
import { acpSchedules, type AcpScheduleContext, type AcpScheduleSession } from '../../acp/schedules'
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
  /** Failures the person gets as fixed sentences keep their kind here. */
  readonly log: CoreLogger
  readonly attachSession?: (cwd: string, session: AcpScheduleSession) => () => void
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
  private closing: Promise<void> | undefined
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
    const root = path.resolve(cwd)
    const control = await this.deps.controlFor(root, caller)
    if (this.closed) {
      await control.close()
      this.assertOpen()
    }
    return {
      request: (input) =>
        this.deps.surface.request(
          input,
          workspaceKey(root),
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
    const root = path.resolve(cwd)
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
    const control = await this.control(root, {
      source: 'cli',
      isInteractive,
      ...authorization,
    })
    const unhold =
      options.operation === 'run-now' || options.operation === 'fire'
        ? this.deps.host.hold(workspaceKey(root))
        : undefined
    try {
      return await settleScheduleCommand(
        async () => {
          const settled = await runScheduleCommand(options, root, control, this.deps.reportCli)
          // A fired wake is spent: re-arm the OS entry for the next wake
          // before this process exits, or say the re-arm failed.
          if (options.operation !== 'run-due') return settled
          try {
            await this.deps.background.reconcile()
          } catch (error: unknown) {
            if (!(error instanceof Error)) throw error
            // A re-arm failure may name OS paths: the record keeps the
            // kind, and the person gets the warning.
            this.deps.log.warn(`The schedule re-arm failed: ${wireWordForLog(error.name)}`)
            return {
              ...settled,
              warning:
                scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.runtime.backgroundUnavailable,
            }
          }
          return settled
        },
        () => (options.operation === 'run-due' ? this.close() : Promise.resolve()),
      )
    } finally {
      unhold?.()
    }
  }
  async run(text: string, context: AcpScheduleContext): Promise<string> {
    this.assertOpen()
    return await this.acp.run(text, { ...context, cwd: path.resolve(context.cwd) })
  }
  async message(input: unknown, cwd: string): Promise<unknown> {
    this.assertOpen()
    const root = path.resolve(cwd)
    // Warm the workspace control: the surface routes by key afterwards.
    await this.control(root, {
      source: 'interactive',
      isInteractive: true,
      scheduledPrompts: false,
    })
    return await this.deps.surface.message(input, root)
  }
  async holdWorkspace(cwd: string, session?: AcpScheduleSession): Promise<() => Promise<void>> {
    this.assertOpen()
    const root = path.resolve(cwd)
    const detach = session === undefined ? undefined : this.deps.attachSession?.(root, session)
    const unhold = this.deps.host.hold(workspaceKey(root))
    let unwatch: () => Promise<void>
    try {
      unwatch = await this.deps.watchWorkspace(root)
    } catch (error: unknown) {
      detach?.()
      unhold()
      throw error
    }
    let isReleased = false
    const release = async () => {
      if (isReleased) return
      isReleased = true
      this.leases.delete(release)
      detach?.()
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
    if (this.closing !== undefined) {
      await this.closing
      return
    }
    this.closed = true
    this.closing = (async () => {
      try {
        const results = await Promise.allSettled([...this.leases].map((release) => release()))
        if (results.some((result) => result.status === 'rejected'))
          throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
      } finally {
        // The re-arm reads the consent store bound to the engine's signal,
        // so it runs before the engine close aborts it; the engine close
        // still runs when the re-arm fails.
        try {
          if (!this.isMacWake) await this.deps.background.reconcile()
        } finally {
          await this.deps.close()
        }
      }
    })()
    await this.closing
  }
}
