// One conversation per surface: owns the MSP session for that surface, turns
// webview requests into backend calls, and streams AgentEvents back.

import type { MuseCodeHost, MuseSession } from '../../core/backends/musecode/MuseCodeHost'
import { UI_TEXT } from '../../shared/constants'
import type { AgentEvent } from '../../shared/agentEvents'
import type { HostToWebviewMessage } from '../../shared/protocol'
import type { AuthService } from '../auth/authService'
import type { Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from '../views/webviewSetup'

export interface ConversationDeps {
  readonly surface: ChatSurface
  readonly auth: AuthService
  readonly ensureHost: () => Promise<MuseCodeHost>
  readonly workspaceRoot: string | undefined
  readonly modelId: string
  readonly approvalMode: string
  readonly openExternal: (url: string) => void
  readonly log: Logger
}

export const NO_WORKSPACE_REASON = 'Open a folder first; Muse works inside a workspace.'
export const NOT_SIGNED_IN_REASON = 'Sign in before sending a message.'
export const AUTH_REQUIRED_ERROR_KIND = 'authRequired'

export class ConversationController {
  private session: MuseSession | undefined
  private unsubscribe: (() => void) | undefined
  private contextLimit: number | undefined

  public constructor(private readonly deps: ConversationDeps) {}

  private post(message: HostToWebviewMessage): void {
    this.deps.surface.post(message)
  }

  private postSessionInfo(modelId: string): void {
    this.post({
      type: 'sessionInfo',
      modelId,
      ...(this.contextLimit !== undefined && { contextLimit: this.contextLimit }),
    })
  }

  private dropSession(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.session?.dispose()
    this.session = undefined
  }

  private onEvent(event: AgentEvent): void {
    this.post({ type: 'agentEvent', event })
    if (
      event.type === 'turnCompleted' &&
      event.terminal === 'failed' &&
      event.errorKind === AUTH_REQUIRED_ERROR_KIND
    ) {
      this.deps.auth.markAuthRequired(event.reason ?? AUTH_REQUIRED_ERROR_KIND)
    }
  }

  private async ensureSession(workspaceRoot: string): Promise<MuseSession> {
    if (this.session !== undefined) {
      return this.session
    }
    const host = await this.deps.ensureHost()
    if (this.contextLimit === undefined) {
      const models = await host.listModels()
      this.contextLimit = models.find((model) => model.modelId === this.deps.modelId)?.contextLimit
    }
    const session = await host.startSession({
      workspaceRoot,
      modelId: this.deps.modelId,
      approvalMode: this.deps.approvalMode,
    })
    this.session = session
    this.unsubscribe = session.onEvent((event) => {
      this.onEvent(event)
    })
    this.postSessionInfo(session.modelId)
    return session
  }

  private async send(localId: string, text: string): Promise<void> {
    if (this.deps.auth.current.status !== 'signedIn') {
      this.post({ type: 'sendFailed', localId, reason: NOT_SIGNED_IN_REASON })
      return
    }
    if (this.deps.workspaceRoot === undefined) {
      this.post({ type: 'sendFailed', localId, reason: NO_WORKSPACE_REASON })
      return
    }
    try {
      const session = await this.ensureSession(this.deps.workspaceRoot)
      const turnId = await session.sendTurn(text)
      this.post({ type: 'turnAccepted', localId, turnId })
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      this.deps.log.error(`sendMessage failed: ${reason}`)
      this.post({ type: 'sendFailed', localId, reason })
    }
  }

  private async cancel(): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel failed: ${String(error)}`)
    }
  }

  /** Called when the webview has mounted: replay the state it needs. */
  public surfaceReady(): void {
    this.post(this.deps.auth.toMessage())
    if (this.session !== undefined) {
      this.postSessionInfo(this.session.modelId)
    }
  }

  public async handle(message: ConversationMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage': {
        await this.send(message.localId, message.text)
        break
      }
      case 'cancelTurn': {
        await this.cancel()
        break
      }
      case 'signIn': {
        await this.deps.auth.signIn(message.method)
        break
      }
      case 'signOut': {
        this.dropSession()
        await this.deps.auth.signOut()
        break
      }
      case 'retryBackend': {
        this.dropSession()
        await this.deps.auth.refresh()
        break
      }
      case 'openExternal': {
        this.deps.openExternal(message.url)
        break
      }
    }
  }

  /** The host process died: forget the session and tell the user. */
  public hostExited(description: string): void {
    this.dropSession()
    this.deps.auth.markBackendError(`${UI_TEXT.hostExited} (${description})`)
  }

  public dispose(): void {
    this.dropSession()
  }
}
