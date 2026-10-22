// The window's binding of the team host service (M96 lane X, C-M96-3). It
// stays tiny in the activation bundle: a workspace that stores no team never
// loads dist/team.js, sends nothing and starts nothing (acceptance 1 and 47).
// A workspace that stores one loads the service when a surface that shows the
// team opens, runs the declared setup probes there, and hands every engine
// the same seams. Each editor's host builds one of these over its own ports.

import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { hasRunnableTeamEntry, isTeamAvailable } from '../shared/teamConversation'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { TeamTreeData } from '../shared/teamView'
import type { UiText } from '../shared/l10n/en'
import type { TeamHostSeams, TeamHostService } from '../core/team/teamHostService'
import type { TeamHostBundleDeps } from './team/teamEnginePorts'
import type { TeamToolResult } from '../core/team/teamSeams'

/**
D75's availability switch from its raw setting value: on only while
explicitly set true. Hidden means hidden: an absent setting counts as
off, never as on (RVCM963J 1).
*/
export function isTeamSwitchOn(setting: unknown): boolean {
  return setting === true
}

/** The tree's and cards' messages the service answers. */
export type TeamSurfaceMessage = Extract<
  WebviewToHostMessage,
  {
    type:
      | 'openTeamTaskTranscript'
      | 'stopTeamTask'
      | 'reviewTeamDiff'
      | 'decideTeamMerge'
      | 'answerTeamWaiting'
      | 'openTeamRoles'
      | 'resetTeamEntry'
      | 'stopAllTeamTasks'
  }
>

/** What a chat surface's controller reaches. */
export interface TeamSurfacePort {
  readonly handle: (message: TeamSurfaceMessage) => Promise<void>
}

export interface TeamHostBindingDeps {
  /** The service's and the engine's ports; `state` is also read here, without loading anything. */
  readonly ports: TeamHostBundleDeps
  /** dist/team.js's factory, required only for a workspace that stores a team. */
  readonly loadFactory: () => Promise<
    (
      table: UiText,
      locale: string,
      deps: TeamHostBundleDeps,
    ) => TeamHostService | Promise<TeamHostService>
  >
  readonly uiText: () => UiText
  readonly uiLocale: () => string
  /** The agent kinds this editor has workers for: nothing else loads the team. */
  readonly canRunKind: (kind: string) => boolean
  /** Every chat surface's Agent map. */
  readonly showTree: (tree: TeamTreeData | undefined) => void
  /** Opens the Models & Agents panel at its Roles section (lane U1 owns the section). */
  readonly openRoles: (roleId: string | undefined) => Promise<void>
  /** Shows a task's unified diff in the editor (Review diff). */
  readonly showDiff: (taskId: string, diff: string) => Promise<void>
}

const unavailable = (tool: string): TeamToolResult => {
  const text = fill(UI_TEXT.teamRunnerUnavailable, { tool })
  return { output: `Error: ${text}`, visibleOutput: text }
}

export class TeamHostBinding implements TeamSurfacePort {
  private readonly treeListeners = new Set<() => void>()
  private service: TeamHostService | undefined
  private loading: Promise<TeamHostService | undefined> | undefined
  private unsubscribe: (() => void) | undefined
  private isDisposed = false

  /** The seams every engine takes; each reads the service as it is now. */
  public readonly seams: TeamHostSeams = {
    teamDecisionSource: (modelId) => this.service?.teamDecisionSource(modelId),
    teamRosterData: () => this.service?.teamRosterData(),
    isTeamInPlaceActive: () => this.service?.isTeamInPlaceActive() ?? false,
    teamRunner: {
      preview: async (args, context) =>
        (await this.service?.teamRunner.preview(args, context)) ?? unavailable('delegate'),
      delegate: async (args, context) =>
        (await this.service?.teamRunner.delegate(args, context)) ?? unavailable('delegate'),
      collect: async (args, context) =>
        (await this.service?.teamRunner.collect(args, context)) ?? unavailable('collect'),
      cancel: async (args, context) =>
        (await this.service?.teamRunner.cancel(args, context)) ?? unavailable('cancel'),
      merge: async (args, context) =>
        (await this.service?.teamRunner.merge(args, context)) ?? unavailable('merge'),
    },
  }

  public constructor(private readonly deps: TeamHostBindingDeps) {}

  private closed(): boolean {
    return this.isDisposed
  }

  private async load(): Promise<TeamHostService | undefined> {
    if (this.service !== undefined) return this.service
    if (
      this.isDisposed ||
      !isTeamAvailable(this.deps.ports.settings.isTeamOn()) ||
      !hasRunnableTeamEntry(this.deps.ports.state, {
        orchestratorModelId: this.deps.ports.orchestrator.modelId(),
        isTeamWorkersOn: this.deps.ports.settings.isTeamWorkersOn(),
        canRunKind: this.deps.canRunKind,
      })
    )
      return undefined
    this.loading ??= (async () => {
      try {
        const create = await this.deps.loadFactory()
        if (this.isDisposed) return
        const service = await create(this.deps.uiText(), this.deps.uiLocale(), this.deps.ports)
        if (this.closed()) {
          await service.dispose()
          return
        }
        this.service = service
        this.unsubscribe = service.onTreeChange((tree) => {
          this.deps.showTree(tree)
          for (const listener of this.treeListeners) listener()
        })
        return service
      } catch (error: unknown) {
        const failure = error instanceof Error ? error.message : String(error)
        this.deps.ports.log.warn(`The team bundle could not be loaded: ${failure}`)
        return
      } finally {
        this.loading = undefined
      }
    })()
    return await this.loading
  }

  /** First-time setup is independent of a saved, runnable worker entry. */
  public canConfigure(): boolean {
    return (
      !this.isDisposed &&
      isTeamAvailable(this.deps.ports.settings.isTeamOn()) &&
      this.deps.ports.settings.isTrusted() &&
      this.deps.canRunKind('engine')
    )
  }

  /**
  Loads the service and runs the declared setup probes, once, when a
  surface that shows the team opens. A workspace with no stored team, or
  with the team switched off, loads and probes nothing.
  */
  public async open(): Promise<void> {
    const service = await this.load()
    await service?.probeEntries()
  }

  /** The tree to show when a surface opens; undefined is today's map. */
  public tree(): TeamTreeData | undefined {
    return this.service?.tree()
  }

  public async handle(message: TeamSurfaceMessage): Promise<void> {
    if (message.type === 'openTeamRoles') {
      // Hidden means hidden: with the team switched off the Roles section is
      // not reachable by command either, not only by panel.
      if (!this.canConfigure()) throw new Error(UI_TEXT.teamTaskUnknown)
      await this.deps.openRoles(message.roleId)
      return
    }
    const service = this.service
    if (service === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
    switch (message.type) {
      case 'stopTeamTask': {
        await service.stopTask(message.taskId)
        return
      }
      case 'stopAllTeamTasks': {
        await service.stopAllTasks()
        return
      }
      case 'decideTeamMerge': {
        await service.decideMerge(message.taskId, message.decision)
        return
      }
      case 'answerTeamWaiting': {
        await service.answerWaiting(message.waitingId, message.choice)
        return
      }
      case 'resetTeamEntry': {
        await service.resetEntry(message.entryId)
        return
      }
      case 'reviewTeamDiff': {
        await this.deps.showDiff(message.taskId, await service.taskDiff(message.taskId))
        return
      }
      default: {
        // An engine worker's conversation closes with its task; its report
        // and diff are what the window keeps.
        throw new Error(UI_TEXT.teamTranscriptNotKept)
      }
    }
  }

  /** U1 and chat observe the same service tree. */
  public onTreeChange(listener: () => void): () => void {
    this.treeListeners.add(listener)
    return () => {
      this.treeListeners.delete(listener)
    }
  }

  /** Re-reads the stored team after the Roles section saves it. */
  /**
  The Roles section saved the team: a first team loads the service now, and
  a changed one is re-read and probed again (an entry's new model needs a
  new probe; the old readiness never carries over).
  */
  public reload(): void {
    const service = this.service
    if (service === undefined) {
      void this.open()
      return
    }
    service.reload()
    void service.probeEntries()
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true
    this.treeListeners.clear()
    this.unsubscribe?.()
    const service = this.service
    this.service = undefined
    await service?.dispose()
  }
}
