// Owns the Model API host for this extension host (M7): one in-process
// `ModelApiHost` over the real `fetch`, the stored key and the workspace's
// files. Nothing is spawned; disposing it forgets the window's sessions.

import { ModelApiClient } from '../../core/backends/modelapi/client'
import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import type { SessionStore } from '../../core/backends/modelapi/sessionStore'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import type { ContextIo } from '../../core/context/contextFiles'
import { MODEL_API_BASE_URL } from '../../shared/constants'
import type { Logger } from '../logger'

export interface ModelApiBackendManagerDeps {
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
  /** The git facts for the prompt's environment section (D15). */
  readonly describeEnvironment: () => Promise<EnvironmentFacts>
}

const MANAGER_DISPOSED = 'The Model API backend was stopped while it was starting'

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

  public constructor(private readonly deps: ModelApiBackendManagerDeps) {}

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

  private async build(): Promise<ModelApiHost> {
    const { workspaceRoot } = this.deps
    if (workspaceRoot === undefined) {
      throw new Error('Open a folder first; the Model API backend works inside a workspace.')
    }
    const client = new ModelApiClient({
      fetch: this.deps.fetch,
      baseUrl: MODEL_API_BASE_URL,
      apiKey: this.deps.getApiKey,
      sleep: this.deps.sleep,
      now: this.deps.now,
      random: this.deps.random,
      log: this.deps.log,
    })
    const host = new ModelApiHost({
      client,
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
      describeEnvironment: this.deps.describeEnvironment,
    })
    await host.load()
    this.deps.log.info('Model API backend ready (api.meta.ai/v1, stateless reasoning replay)')
    return host
  }

  /** The host, created on first use with the stored sessions read. Rejects without a workspace. */
  public ensureHost(): Promise<ModelApiHost> {
    if (this.host !== undefined) {
      return Promise.resolve(this.host)
    }
    this.building ??= this.buildOnce(this.generation)
    return this.building
  }

  public get isRunning(): boolean {
    return this.host !== undefined || this.building !== undefined
  }

  /** A skill file changed: the running host re-reads its catalogue. */
  public async refreshSkills(): Promise<void> {
    await this.host?.refreshSkills()
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
