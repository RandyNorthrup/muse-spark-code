import { UI_TEXT } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { acpSchedules, type AcpScheduleContext } from '../../acp/schedules'
import { runScheduleCommand, type ScheduleControlPort, type ScheduleCommandResult } from './command'
import type { ScheduleCommandOptions } from './args'
import type { RuntimeSchedulesBinding } from './binding'
import type { RuntimeScheduleHost } from './host'
import type { ScheduleBackgroundCoordinator } from './background'
import type { ScheduleSurface } from './surface'

export interface ScheduleRuntimeDeps {
  /** S supplies a scoped control, with a real close for that invocation. */
  readonly controlFor: (cwd: string) => Promise<ScheduleControlPort>
  readonly host: RuntimeScheduleHost
  readonly surface: ScheduleSurface
  readonly background: ScheduleBackgroundCoordinator
  /** S starts/stops its polling engine with the workspace's process lifetime. */
  readonly watchWorkspace: (cwd: string) => Promise<() => Promise<void>>
  /** S's validated persisted workspace registry, never an untrusted event path. */
  readonly dueWorkspaces: () => Promise<readonly string[]>
  readonly close: () => Promise<void>
}

/** Concrete glue over the injected S/U/D engine, never a second scheduler. */
export class ScheduleRuntime implements RuntimeSchedulesBinding {
  private readonly leases = new Set<() => Promise<void>>()
  private readonly acp
  private closed = false
  constructor(private readonly deps: ScheduleRuntimeDeps) {
    this.acp = acpSchedules((context) => this.control(context.cwd))
  }
  private assertOpen(): void {
    if (this.closed) throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  }
  private async control(cwd: string): Promise<ScheduleControlPort> {
    this.assertOpen()
    const control = await this.deps.controlFor(cwd)
    if (this.closed) {
      await control.close()
      this.assertOpen()
    }
    return {
      request: (input) =>
        this.deps.surface.request(input, workspaceKey(cwd), (request) => control.request(request)),
      runDue: async () => {
        const releases: (() => Promise<void>)[] = []
        const failures: unknown[] = []
        try {
          const workspaces = await this.deps.dueWorkspaces()
          for (const workspace of workspaces) releases.push(await this.holdWorkspace(workspace))
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
  async command(options: ScheduleCommandOptions, cwd: string): Promise<ScheduleCommandResult> {
    const control = await this.control(cwd)
    try {
      return await runScheduleCommand(options, cwd, control)
    } finally {
      if (options.operation === 'run-due') await this.close()
    }
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
        await this.deps.background.reconcile()
      }
    }
  }
}
