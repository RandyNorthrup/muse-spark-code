// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import type { Connection } from '@muse-code/sdk'
import * as z from 'zod/mini'
import type { AgentEvent } from '../../../shared/agentEvents'
import type { CoreLogger } from '../../logging'
import { mapNotification } from './mapNotification'

/** What the SDK's `SpawnedMspConnection` provides, narrowed to what we use. */
export interface MspHost {
  readonly connection: Connection
  readonly initializeResult: unknown
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>
  close(): Promise<unknown>
}

export interface HostInfo {
  readonly serverName: string
  readonly serverVersion: string
  readonly museHome: string
}

export interface ModelSummary {
  readonly modelId: string
  readonly displayLabel: string
  readonly contextLimit: number | undefined
  readonly isDefault: boolean
}

export interface StartSessionOptions {
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: string
}

export type SessionEventListener = (event: AgentEvent) => void

const initializeResultSchema = z.object({
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  museHome: z.string(),
})

const sessionStartResultSchema = z.object({
  session: z.object({ sessionId: z.string(), modelId: z.nullable(z.string()) }),
})

const turnStartResultSchema = z.object({ turnId: z.string(), status: z.string() })

const modelListResultSchema = z.object({
  models: z.array(
    z.object({
      modelId: z.string(),
      displayLabel: z.string(),
      contextLimit: z.nullable(z.number()),
      isDefault: z.boolean(),
    }),
  ),
})

export class MuseSession {
  private readonly listeners = new Set<SessionEventListener>()
  private isDisposed = false

  public constructor(
    public readonly sessionId: string,
    public readonly modelId: string,
    private readonly connection: Connection,
    private readonly onDispose: () => void,
  ) {}

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @internal Called by the host dispatcher. */
  public emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Submit one user turn; resolves with the host-assigned turn id. */
  public async sendTurn(text: string): Promise<string> {
    const commandId = this.connection.mintCommandId()
    const result = await this.connection.command(
      'turn/start',
      { commandId, sessionId: this.sessionId, input: [{ type: 'text', text }] },
      { commandId },
    )
    return turnStartResultSchema.parse(result).turnId
  }

  /** Ask the host to stop the running turn gracefully. */
  public async cancel(): Promise<void> {
    const commandId = this.connection.mintCommandId()
    await this.connection.command(
      'turn/cancel',
      { commandId, sessionId: this.sessionId },
      { commandId },
    )
  }

  /** Stop the running turn immediately. */
  public async interrupt(): Promise<void> {
    const commandId = this.connection.mintCommandId()
    await this.connection.command(
      'turn/interrupt',
      { commandId, sessionId: this.sessionId },
      { commandId },
    )
  }

  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    this.listeners.clear()
    this.onDispose()
  }
}

export class MuseCodeHost {
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: string) => void>()
  public readonly info: HostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
  ) {
    const parsed = initializeResultSchema.parse(host.initializeResult)
    this.info = {
      serverName: parsed.serverInfo.name,
      serverVersion: parsed.serverInfo.version,
      museHome: parsed.museHome,
    }
    host.connection.onNotification((notification) => {
      const mapped = mapNotification(notification)
      if (mapped === undefined) {
        return
      }
      const session = this.sessions.get(mapped.sessionId)
      if (session === undefined) {
        this.log.warn(`MSP event ${notification.method} for unknown session ${mapped.sessionId}`)
        return
      }
      session.emit(mapped.event)
    })
    host.connection.onServerRequest((request) => {
      this.log.warn(`Unsupported MSP server request ${request.method}; refusing`)
      return Promise.reject(new Error(`unsupported server request: ${request.method}`))
    })
    void host.exited.then((exit) => {
      const description = `code ${String(exit.code)}, signal ${String(exit.signal)}`
      this.log.warn(`muse serve exited (${description})`)
      for (const listener of this.exitListeners) {
        listener(description)
      }
    })
  }

  public onExit(listener: (description: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  public async listModels(): Promise<readonly ModelSummary[]> {
    const result = await this.host.connection.command('model/list', {})
    return modelListResultSchema.parse(result).models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      contextLimit: model.contextLimit ?? undefined,
      isDefault: model.isDefault,
    }))
  }

  public async startSession(options: StartSessionOptions): Promise<MuseSession> {
    const commandId = this.host.connection.mintCommandId()
    const result = await this.host.connection.command(
      'session/start',
      {
        commandId,
        workspaceRoot: options.workspaceRoot,
        modelId: options.modelId,
        approvalMode: options.approvalMode,
      },
      { commandId },
    )
    const { session } = sessionStartResultSchema.parse(result)
    const handle = new MuseSession(
      session.sessionId,
      session.modelId ?? options.modelId,
      this.host.connection,
      () => {
        this.sessions.delete(session.sessionId)
      },
    )
    this.sessions.set(session.sessionId, handle)
    return handle
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public async close(): Promise<void> {
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    await this.host.close()
    for (const session of this.sessions.values()) {
      session.dispose()
    }
  }
}
