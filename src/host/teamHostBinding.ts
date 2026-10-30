// The window's binding of the team host service (M96 lane X, C-M96-3). It
// stays tiny in the activation bundle: a workspace that stores no team never
// loads dist/team.js, sends nothing and starts nothing (acceptance 1 and 47).
// A workspace that stores one loads the service when a surface that shows the
// team opens, runs the declared setup probes there, and hands every engine
// the same seams. Each editor's host builds one of these over its own ports.

import { UI_TEXT } from '../shared/constants'
import { failureForLog } from '../core/backends/musecode/logText'
import { fill } from '../shared/l10n/text'
import {
  decideTeamConversationMode,
  hasRunnableTeamEntry,
  isTeamAvailable,
  TEAM_WORKSPACE_KEYS,
  type TeamConversationMode,
} from '../shared/teamConversation'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { TeamTreeData } from '../shared/teamView'
import type { UiText } from '../shared/l10n/en'
import type { SessionMcpHttpServer } from '../core/agent/agentBackend'
import type { TeamHostSeams, TeamHostService } from '../core/team/teamHostService'
import type { TeamHostBundleDeps } from './team/teamEnginePorts'
import type { TeamToolResult } from '../core/team/teamSeams'
import type { TeamMcpServer, TeamSessionBinding } from './team/teamMcpServer'

/**
D75's availability switch from its raw setting value, under D227: off
only while explicitly set false. An absent setting counts as on: the
two-model rule, not a default, keeps teams off until a second model is
set up.
*/
export function isTeamSwitchOn(setting: unknown): boolean {
  return setting !== false
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
      | 'moveTeamTask'
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
  /**
  The `team` MCP server for Muse Code orchestrators (M96 lane T), loaded
  with dist/teamHost.js on the first team conversation. Absent, Muse Code
  conversations stay single-model and no endpoint is offered.
  */
  readonly loadTeamMcp?:
    | (() => Promise<{
        readonly server: TeamMcpServer
        readonly rosterAnswer: (
          data: NonNullable<ReturnType<TeamHostSeams['teamRosterData']>>,
        ) => string
      }>)
    | undefined
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

/** One Muse Code conversation's route to the runner; its id lands at `rememberMode`. */
interface McpConversation extends TeamSessionBinding {
  sessionId: string | undefined
}

export class TeamHostBinding implements TeamSurfacePort {
  private readonly treeListeners = new Set<() => void>()
  private service: TeamHostService | undefined
  private loading: Promise<TeamHostService | undefined> | undefined
  private unsubscribe: (() => void) | undefined
  private isDisposed = false
  private mcpModule:
    Awaited<ReturnType<NonNullable<TeamHostBindingDeps['loadTeamMcp']>>> | undefined
  private mcpLoading: Promise<void> | undefined
  private readonly mcpConversations = new Map<string, McpConversation>()
  private pendingMcp: McpConversation | undefined

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
      reschedule: async (args, context) =>
        (await this.service?.teamRunner.reschedule(args, context)) ?? unavailable('reschedule'),
    },
  }

  /**
  The `team` MCP server's face for the conversation controller (M96 lane
  T): Muse Code team conversations carry the server in `session/start`;
  single-model sessions carry today's set byte for byte.
  */
  public readonly teamMcp = {
    modeForNewConversation: (): TeamConversationMode => {
      if (this.deps.loadTeamMcp === undefined) return 'single-model'
      const source = this.service?.teamDecisionSource()
      return source === undefined ? 'single-model' : decideTeamConversationMode(source).mode
    },
    modeForSession: (sessionId: string): TeamConversationMode =>
      this.readModes()[sessionId] ?? 'single-model',
    rememberMode: async (sessionId: string, mode: TeamConversationMode): Promise<void> => {
      if (this.pendingMcp !== undefined && this.pendingMcp.sessionId === undefined) {
        this.pendingMcp.sessionId = sessionId
        this.mcpConversations.set(sessionId, this.pendingMcp)
        this.pendingMcp = undefined
      }
      await this.deps.ports.state.update(TEAM_WORKSPACE_KEYS.conversationModes, {
        ...this.readModes(),
        [sessionId]: mode,
      })
    },
    endpointForConversation: async (
      sessionId?: string,
    ): Promise<SessionMcpHttpServer | undefined> => {
      const service = await this.load()
      if (service === undefined || this.closed()) return undefined
      const mcp = await this.loadMcp()
      if (mcp === undefined || this.closed()) return undefined
      const conversation =
        sessionId === undefined
          ? (this.pendingMcp ??= this.newMcpConversation(undefined))
          : this.mcpConversation(sessionId)
      return await mcp.server.endpointForConversation(conversation)
    },
  }

  public constructor(private readonly deps: TeamHostBindingDeps) {}

  private readModes(): Readonly<Record<string, TeamConversationMode>> {
    const stored: unknown = this.deps.ports.state.get(TEAM_WORKSPACE_KEYS.conversationModes)
    return typeof stored !== 'object' || stored === null
      ? {}
      : Object.fromEntries(
          Object.entries(stored).filter(
            (entry): entry is [string, TeamConversationMode] =>
              entry[1] === 'team' || entry[1] === 'single-model',
          ),
        )
  }

  private async loadMcp() {
    if (this.mcpModule !== undefined) return this.mcpModule
    const load = this.deps.loadTeamMcp
    if (load === undefined) return
    this.mcpLoading ??= (async () => {
      try {
        const loaded = await load()
        if (this.isDisposed) loaded.server.close()
        else this.mcpModule = loaded
      } catch (error: unknown) {
        this.deps.ports.log.warn(`The team MCP server could not be loaded: ${failureForLog(error)}`)
      } finally {
        this.mcpLoading = undefined
      }
    })()
    await this.mcpLoading
    return this.mcpModule
  }

  private mcpConversation(sessionId: string): McpConversation {
    const existing = this.mcpConversations.get(sessionId)
    if (existing !== undefined) return existing
    const created = this.newMcpConversation(sessionId)
    this.mcpConversations.set(sessionId, created)
    return created
  }

  private newMcpConversation(sessionId: string | undefined): McpConversation {
    const conversation: McpConversation = {
      sessionId,
      commandRecords: {
        load: (): unknown => {
          if (conversation.sessionId === undefined) return
          const stored: unknown = this.deps.ports.state.get(TEAM_WORKSPACE_KEYS.commandRecords)
          const found: unknown =
            typeof stored === 'object' && stored !== null
              ? Reflect.get(stored, conversation.sessionId)
              : undefined
          return found
        },
        save: async (records) => {
          if (conversation.sessionId === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
          const stored: unknown = this.deps.ports.state.get(TEAM_WORKSPACE_KEYS.commandRecords)
          const all = typeof stored === 'object' && stored !== null ? { ...stored } : {}
          await this.deps.ports.state.update(TEAM_WORKSPACE_KEYS.commandRecords, {
            ...all,
            [conversation.sessionId]: records,
          })
        },
      },
      run: async (tool, args, signal) => {
        const id = conversation.sessionId
        const service = this.service
        if (id === undefined || service === undefined)
          throw new Error(fill(UI_TEXT.teamRunnerUnavailable, { tool }))
        if (tool === 'roster') {
          const data = service.teamRosterData()
          const mcp = this.mcpModule
          if (data === undefined || mcp === undefined)
            throw new Error(fill(UI_TEXT.teamRunnerUnavailable, { tool }))
          return mcp.rosterAnswer(data)
        }
        const context = {
          sessionId: id,
          approvalMode: this.deps.ports.orchestrator.approvalMode?.(id) ?? '',
          signal,
          orchestratorModelId: this.deps.ports.orchestrator.modelId(),
        }
        const runner = service.teamRunner
        let result: TeamToolResult
        switch (tool) {
          case 'delegate': {
            result = await (args['dry_run'] === true
              ? runner.preview(args, context)
              : runner.delegate(args, context))

            break
          }
          case 'collect': {
            result = await runner.collect(args, context)

            break
          }
          case 'cancel': {
            result = await runner.cancel(args, context)

            break
          }
          case 'merge': {
            result = await runner.merge(args, context)

            break
          }
          default: {
            throw new Error(fill(UI_TEXT.teamRunnerUnavailable, { tool }))
          }
        }
        return result.output
      },
    }
    return conversation
  }

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
        this.deps.ports.log.warn(`The team bundle could not be loaded: ${failureForLog(error)}`)
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
      // A switched-off team says so, with the way back; any other closed
      // gate (untrusted workspace, no engine worker) keeps its own error.
      if (!this.canConfigure()) {
        if (!isTeamAvailable(this.deps.ports.settings.isTeamOn()))
          throw new Error(UI_TEXT.teamSwitchedOff)
        throw new Error(UI_TEXT.teamTaskUnknown)
      }
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
      case 'moveTeamTask': {
        await service.moveTask(message.taskId, message.role)
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
    this.mcpModule?.server.close()
    this.mcpModule = undefined
    this.mcpConversations.clear()
    this.pendingMcp = undefined
    this.treeListeners.clear()
    this.unsubscribe?.()
    const service = this.service
    this.service = undefined
    await service?.dispose()
  }
}
