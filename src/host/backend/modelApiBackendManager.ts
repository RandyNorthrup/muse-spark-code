// Owns the Model API host for this extension host (M7): one in-process
// `ModelApiHost` over the real `fetch`, the stored key and the workspace's
// files, with the MCP servers of Muse Code's settings (M50), which it starts
// with the first conversation. Disposing it forgets the window's sessions
// and stops those servers.
//
// The host itself lives in a bundle of its own, dist/modelApi.js (M57,
// PLAN.md D6), required here the first time it is built, so activation does
// not load it. A missing or unreadable bundle fails that build like any
// other failure: the caller hears a sentence, the log gets the cause, and the
// next call tries again.

import { createHash } from 'node:crypto'
import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import type { NetworkAdvice } from '../../core/networkFailure'
import type { McpPoolSnapshot, McpToolSource } from '../../core/backends/modelapi/mcp/pool'
import type { ModelApiHost, ModelApiPaidHooks } from '../../core/backends/modelapi/ModelApiHost'
import type { SessionStore } from '../../core/backends/modelapi/sessionStore'
import type { ScheduleStore } from '../../shared/schedule'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import type { VerifyHooks } from '../../core/backends/modelapi/verifyLoop'
import type { ContextIo } from '../../core/context/contextFiles'
import type { LanguageServiceHost } from '../../core/codeIntel/languageService'
import type { McpTool } from '../../core/mcp'
import type { MemoryStore } from '../../core/memory/memoryStore'
import type { WebFetcher } from '../../core/web/webFetch'
import { WorkspaceEdits, type WorkspaceEditRecorder } from '../../core/verify/workspaceEdits'
import type { AgentSession } from '../../core/agent/agentBackend'
import type { EditedFile } from '../../core/verify/diagnosticsReport'
import { MODEL_API_BASE_URL, type PromptCacheRetention, UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'
import { isModelApiBundle, type McpPoolFactory, type ModelApiBundle } from './modelApiBundle'

export interface ModelApiBackendManagerDeps extends ModelApiPaidHooks {
  readonly log: Logger
  readonly getApiKey: () => Promise<string | undefined>
  readonly workspaceRoot: string | undefined
  readonly io: ToolIo
  /** The rules, skills and memory loaders' file access (PLAN.md D27). */
  readonly contextIo: ContextIo
  readonly fetch: typeof fetch
  readonly newId: () => string
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly random: () => number
  /** Muse Code's personal skill root (PLAN.md D13). */
  readonly personalSkillsRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  /** Sessions between windows (PLAN.md D14); undefined without workspace storage. */
  readonly store: SessionStore | undefined
  readonly scheduleStore?: ScheduleStore | undefined
  /** The git facts for the prompt's environment section (D15). */
  readonly describeEnvironment: () => Promise<EnvironmentFacts>
  /** `museSpark.modelApiPromptCacheRetention`, read per request (M56, PLAN.md D43). */
  readonly promptCacheRetention: () => PromptCacheRetention
  readonly hookSettingsPath?: string
  readonly isHooksEnabled?: () => boolean
  /**
   * The MCP servers for a host in this workspace (M50), one set per host,
   * made with the bundle's pool (M57).
   */
  readonly createMcpServers?:
    | ((workspaceRoot: string, newPool: McpPoolFactory) => McpToolSource | Promise<McpToolSource>)
    | undefined
  /** The extension's own IDE tools, offered in process (M50). */
  readonly ideTools?: readonly McpTool[] | undefined
  /** The window's web fetch, run in this bundle for the backend's `web_fetch` (M69). */
  readonly webFetch?: WebFetcher | undefined
  /** VS Code's language services, for the code intelligence tools (M67). */
  readonly codeIntel?: LanguageServiceHost | undefined
  /** `museSpark.modelApiRepoMap`, read per turn (M67). */
  readonly isRepoMapInPrompt?: (() => boolean) | undefined
  /** Muse Code's memory, shared with the Memory view (M49, PLAN.md D41). */
  readonly memory: MemoryStore | undefined
  /** The verify loop's settings and the editor's diagnostics and formatter (M68, PLAN.md D49). */
  readonly verify?: VerifyHooks | undefined
  /** The runtime can share notices across aliases without changing its saved-session identity. */
  readonly workspaceEdits?: WorkspaceEdits | undefined
  readonly sessionWorkspaceRoot?: string | undefined
  /** Runtime owners refuse a retargeted or replaced workspace before use. */
  readonly assertWorkspaceCurrent?: (() => void) | undefined
  /** The Model API bundle, dist/modelApi.js beside the running bundle (M57, PLAN.md D6). */
  readonly bundlePath: string
  /** How the bundle is loaded: Node's `require` unless a test hands in the source module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
  /** Whose settings a failed request names: VS Code's unless the ACP agent says its own (Q66). */
  readonly networkAdvice?: NetworkAdvice | undefined
  /** What a missing or damaged bundle says: reinstall the extension, unless the agent says its own. */
  readonly bundleUnavailable?: (() => string) | undefined
}

const MANAGER_DISPOSED = 'The Model API backend was stopped while it was starting'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class ModelApiBackendManager {
  private host: ModelApiHost | undefined
  /**
   * The host being built (PLAN.md D25): every caller waits for the stored
   * sessions to be read, and a failed build is forgotten so the next call
   * tries again instead of reusing half a host.
   */
  private building: Promise<ModelApiHost> | undefined
  /** Bumped by every dispose: a build that finishes after one is closed, not kept. */
  private generation = 0
  /** Exists before the lazy host, and is shared by all surfaces using this manager. */
  public readonly workspaceEdits: WorkspaceEdits

  public constructor(private readonly deps: ModelApiBackendManagerDeps) {
    this.workspaceEdits = deps.workspaceEdits ?? new WorkspaceEdits()
  }

  /** One build, owned by the generation it was started in. */
  private async buildOnce(generation: number): Promise<ModelApiHost> {
    let host: ModelApiHost
    try {
      host = await this.build()
    } finally {
      if (this.generation === generation) {
        this.building = undefined
      }
    }
    if (this.generation !== generation) {
      await host.close()
      throw new Error(MANAGER_DISPOSED)
    }
    this.host = host
    return host
  }

  /** The sentence a missing or damaged bundle shows, read when shown (D33). */
  private unavailableText(): string {
    return this.deps.bundleUnavailable?.() ?? UI_TEXT.modelApiBundleUnavailable
  }

  /** The bundle's factory; a missing or corrupt file is logged and refused in the user's words. */
  private loadBundle(): ModelApiBundle {
    const { bundlePath, loadBundle = requireFile } = this.deps
    let loaded: unknown
    try {
      loaded = loadBundle(bundlePath)
    } catch (error: unknown) {
      this.deps.log.error(
        `The Model API bundle ${bundlePath} could not be loaded: ${describe(error)}`,
      )
      throw new Error(this.unavailableText(), { cause: error })
    }
    if (!isModelApiBundle(loaded)) {
      this.deps.log.error(`${bundlePath} does not export the Model API backend's factory`)
      if (this.deps.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      throw new Error(this.unavailableText())
    }
    return loaded
  }

  private async build(): Promise<ModelApiHost> {
    const { workspaceRoot, createMcpServers } = this.deps
    if (workspaceRoot === undefined) {
      throw new Error(UI_TEXT.modelApiNeedsFolder)
    }
    const bundle = this.loadBundle()
    const host = await bundle.createModelApiHost({
      uiText: UI_TEXT,
      uiLocale: uiLocale(),
      client: {
        fetch: this.deps.fetch,
        baseUrl: MODEL_API_BASE_URL,
        apiKey: this.deps.getApiKey,
        sleep: this.deps.sleep,
        now: this.deps.now,
        random: this.deps.random,
        log: this.deps.log,
        ...(this.deps.networkAdvice !== undefined && { networkAdvice: this.deps.networkAdvice }),
      },
      host: {
        workspaceRoot,
        platform: process.platform,
        io: this.deps.io,
        contextIo: this.deps.contextIo,
        newId: this.deps.newId,
        now: this.deps.now,
        log: this.deps.log,
        personalSkillsRoot: this.deps.personalSkillsRoot,
        isWorkspaceTrusted: this.deps.isWorkspaceTrusted,
        store: this.deps.store,
        scheduleStore: this.deps.scheduleStore,
        getAccountId: async () => {
          const key = await this.deps.getApiKey()
          return key === undefined ? undefined : createHash('sha256').update(key).digest('hex')
        },
        describeEnvironment: this.deps.describeEnvironment,
        isPaidFeatureOn: this.deps.isPaidFeatureOn,
        notePaidUse: this.deps.notePaidUse,
        promptCacheRetention: this.deps.promptCacheRetention,
        ideTools: this.deps.ideTools,
        webFetch: this.deps.webFetch,
        codeIntel: this.deps.codeIntel,
        isRepoMapInPrompt: this.deps.isRepoMapInPrompt,
        allowsPaidUse: this.deps.allowsPaidUse,
        isPaidUseRemembered: this.deps.isPaidUseRemembered,
        noteSubagentUsage: this.deps.noteSubagentUsage,
        isHooksEnabled: this.deps.isHooksEnabled,
        memory: this.deps.memory,
        verify: this.deps.verify,
        workspaceEdits: this.workspaceEdits,
        sessionWorkspaceRoot: this.deps.sessionWorkspaceRoot,
      },
      hookSettingsPath: this.deps.hookSettingsPath,
      createMcpServers:
        createMcpServers === undefined
          ? undefined
          : (newPool) => createMcpServers(workspaceRoot, newPool),
    })
    this.deps.log.info('Model API backend ready (api.meta.ai/v1, stateless reasoning replay)')
    return host
  }

  /** The host, created on first use with the stored sessions read. Rejects without a workspace. */
  public ensureHost(): Promise<ModelApiHost> {
    this.deps.assertWorkspaceCurrent?.()
    if (this.host !== undefined) {
      return Promise.resolve(this.host)
    }
    this.building ??= this.buildOnce(this.generation)
    return this.building
  }

  public get isRunning(): boolean {
    return this.host !== undefined || this.building !== undefined
  }

  /** The MCP servers as the running host has them; undefined before it is built (M50). */
  public mcpSnapshot(): McpPoolSnapshot | undefined {
    return this.host?.mcpSnapshot()
  }

  /** A skill file changed: the running host re-reads its catalogue. */
  public async refreshSkills(): Promise<void> {
    await this.host?.refreshSkills()
  }

  /** Host-origin writes notify without loading a backend or reading its key. */
  public captureExternalEditOwner(session: AgentSession): WorkspaceEditRecorder | undefined {
    return this.host?.externalEditRecorder(session)
  }

  /** Notices use the recorder captured before asynchronous lookup/confirmation. */
  public beginExternalEdit(
    record: WorkspaceEditRecorder | undefined,
    files: readonly EditedFile[],
  ): (wasWritten: boolean) => void {
    const completions: (() => void)[] = []
    try {
      for (const file of files) {
        completions.push(this.workspaceEdits.beginEdit(file, [file.relative]))
      }
    } catch (error: unknown) {
      for (const complete of completions) {
        complete()
      }
      throw error
    }
    return (wasWritten) => {
      try {
        if (wasWritten) {
          for (const file of files) {
            record?.(file)
          }
        }
      } finally {
        for (const complete of completions) {
          complete()
        }
      }
    }
  }

  /** Closes the host; one still being built closes itself when it is ready. */
  public async dispose(): Promise<void> {
    this.generation += 1
    const { host } = this
    this.host = undefined
    this.building = undefined
    await host?.close()
  }
}
