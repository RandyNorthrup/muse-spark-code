// Owns the Model API host for this extension host (M7): one in-process
// `ModelApiHost` over the real `fetch`, the stored key and the workspace's
// files. Nothing is spawned; disposing it forgets the window's sessions.

import { ModelApiClient } from '../../core/backends/modelapi/client'
import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import type { SessionStore } from '../../core/backends/modelapi/sessionStore'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import { MODEL_API_BASE_URL } from '../../shared/constants'
import type { Logger } from '../logger'

export interface ModelApiBackendManagerDeps {
  readonly log: Logger
  readonly getApiKey: () => Promise<string | undefined>
  readonly workspaceRoot: string | undefined
  readonly io: ToolIo
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

export class ModelApiBackendManager {
  private host: ModelApiHost | undefined

  public constructor(private readonly deps: ModelApiBackendManagerDeps) {}

  /** The host, created on first use with the stored sessions read. Rejects without a workspace. */
  public async ensureHost(): Promise<ModelApiHost> {
    if (this.host !== undefined) {
      return this.host
    }
    const { workspaceRoot } = this.deps
    if (workspaceRoot === undefined) {
      throw new Error('Open a folder first; the Model API backend works inside a workspace.')
    }
    const client = new ModelApiClient({
      fetch: this.deps.fetch,
      baseUrl: MODEL_API_BASE_URL,
      apiKey: this.deps.getApiKey,
      sleep: this.deps.sleep,
      random: this.deps.random,
      log: this.deps.log,
    })
    this.host = new ModelApiHost({
      client,
      workspaceRoot,
      platform: process.platform,
      io: this.deps.io,
      newId: this.deps.newId,
      now: this.deps.now,
      log: this.deps.log,
      personalSkillsRoot: this.deps.personalSkillsRoot,
      isWorkspaceTrusted: this.deps.isWorkspaceTrusted,
      store: this.deps.store,
      describeEnvironment: this.deps.describeEnvironment,
    })
    await this.host.load()
    this.deps.log.info('Model API backend ready (api.meta.ai/v1, stateless reasoning replay)')
    return this.host
  }

  public get isRunning(): boolean {
    return this.host !== undefined
  }

  /** A skill file changed: the running host re-reads its catalogue. */
  public async refreshSkills(): Promise<void> {
    await this.host?.refreshSkills()
  }

  public async dispose(): Promise<void> {
    const host = this.host
    this.host = undefined
    await host?.close()
  }
}
