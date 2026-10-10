// The window's binding of the team host service (M96 lane X, C-M96-3). It
// stays tiny in the activation bundle: a workspace that stores no team never
// loads dist/team.js, sends nothing and starts nothing (acceptance 1 and 47).
// A workspace that stores one loads the service when a surface that shows the
// team opens, runs the declared setup probes there, and hands every engine
// the same seams. Each editor's host builds one of these over its own ports.

import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { readTeamWorkspaceHint } from '../shared/teamConversation'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { TeamTreeData } from '../shared/teamView'
import type { UiText } from '../shared/l10n/en'
import type {
  TeamHostSeams,
  TeamHostService,
  TeamHostServiceDeps,
} from '../core/team/teamHostService'
import type { TeamToolResult } from '../core/team/teamSeams'

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
  /** The service's ports; `state` is also read here, without loading anything. */
  readonly ports: TeamHostServiceDeps
  /** dist/team.js's factory, required only for a workspace that stores a team. */
  readonly loadFactory: () => Promise<
    (table: UiText, locale: string, deps: TeamHostServiceDeps) => TeamHostService
  >
  readonly uiText: () => UiText
  readonly uiLocale: () => string
  /** Every chat surface's Agent map. */
  readonly showTree: (tree: TeamTreeData | undefined) => void
  /** Opens the Models & Agents panel at its Roles section (lane U1 owns the section). */
  readonly openRoles: (roleId: string | undefined) => Promise<void>
}

const unavailable = (tool: string): TeamToolResult => {
  const text = fill(UI_TEXT.teamRunnerUnavailable, { tool })
  return { output: `Error: ${text}`, visibleOutput: text }
}

export class TeamHostBinding implements TeamSurfacePort {
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

  private async load(): Promise<TeamHostService | undefined> {
    if (this.service !== undefined) return this.service
    if (
      this.isDisposed ||
      !this.deps.ports.settings.isTeamOn() ||
      !readTeamWorkspaceHint(this.deps.ports.state).hasStoredTeam
    )
      return undefined
    this.loading ??= (async () => {
      try {
        const create = await this.deps.loadFactory()
        if (this.isDisposed) return
        const service = create(this.deps.uiText(), this.deps.uiLocale(), this.deps.ports)
        this.service = service
        this.unsubscribe = service.onTreeChange((tree) => {
          this.deps.showTree(tree)
        })
        return service
      } catch (error: unknown) {
        this.deps.ports.log.warn(
          `The team bundle could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      } finally {
        this.loading = undefined
      }
    })()
    return await this.loading
  }

  /**
   * Loads the service and runs the declared setup probes, once, when a
   * surface that shows the team opens. A workspace with no stored team, or
   * with the team switched off, loads and probes nothing.
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
      default: {
        // A task's transcript and its diff need the worker port's records,
        // which no worker in this window has written.
        throw new Error(UI_TEXT.teamTaskUnknown)
      }
    }
  }

  /** Re-reads the stored team after the Roles section saves it. */
  public reload(): void {
    this.service?.reload()
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true
    this.unsubscribe?.()
    const service = this.service
    this.service = undefined
    await service?.dispose()
  }
}
