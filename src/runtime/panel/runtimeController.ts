import type { AgentHost, AgentSession, LoadedSession } from '../../core/agent/agentBackend'
import { conversationLoader } from '../../host/conversation/conversationBundle'
import type { ConversationController } from '../../host/conversation/conversationController'
import type { ChatSurface } from '../../host/views/chatSurface'
import type { Logger } from '../../host/logger'
import { UI_TEXT, type PermissionMode } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
  type HostToWebviewMessage,
} from '../../shared/protocol'
import type { PanelView } from './surfaces'
import type { RuntimeConversationPorts } from './runtimeFeatures'
import type { runtimeConversationDeps } from './runtimeFeatures'
import type { SessionController } from './controllerRegistry'

/** One conversation owns the session; any number of transport views subscribe to it. */
export class RuntimeConversation implements SessionController, PanelView {
  private readonly listeners = new Set<(message: HostToWebviewMessage) => void>()
  private conversation: ConversationController | undefined
  private preparation: Promise<void> | undefined
  private releasing: Promise<void> | undefined
  private readonly inFlight = new Set<Promise<void>>()
  private handling: Promise<void> = Promise.resolve()
  private isDisposed = false
  private isHostStopped = false
  private authMessage: HostToWebviewMessage | undefined
  private settings: RuntimeConversationPorts['settings'] | undefined
  private store: RuntimeConversationPorts['store'] | undefined
  private canRebind = false

  public constructor(
    private session: AgentSession,
    public readonly host: AgentHost,
    private readonly log: Logger,
    private readonly stopped: () => void,
  ) {}

  private ensureLive(): void {
    if (this.isDisposed) throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
  }

  private async prepareController(
    ports: Omit<RuntimeConversationPorts, 'surface'>,
    loaded: LoadedSession,
    bundlePath: string,
    compose: typeof runtimeConversationDeps,
    externalMode?: PermissionMode,
  ): Promise<void> {
    this.settings = ports.settings
    this.store = ports.store
    this.canRebind = ports.sessionChanged !== undefined
    const surface: ChatSurface = {
      id: this.sessionId,
      post: (message) => {
        if (this.isDisposed) return
        const parsed = hostToWebviewMessageSchema.parse(message)
        if (parsed.type === 'authState') this.authMessage = parsed
        for (const listener of this.listeners) listener(parsed)
      },
      reveal: () => {
        void ports.host.request('surfaces/focus', { surfaceId: this.sessionId }).catch(() => {
          this.log.warn('MHP_SURFACE_FOCUS_UNAVAILABLE')
        })
      },
      markUnread: () => {
        this.log.trace('MHP_SURFACE_UNREAD')
      },
      setTitle: () => {
        this.log.trace('MHP_SURFACE_TITLE_CHANGED')
      },
      reload: () => {
        this.log.warn('MHP_SURFACE_RELOAD_REQUIRED')
      },
      takeRestoredSessionId: () => this.sessionId,
      dispose: () => {
        this.listeners.clear()
      },
    }
    const deps = await compose({ ...ports, surface })
    this.ensureLive()
    // ACP keeps its editor-owned identity; panel sessions move through the registry
    // and retire all old immutable surface bindings before publishing new output.
    const host = this.host
    let prepared: LoadedSession | undefined = loaded
    const ownedHost: AgentHost = {
      info: host.info,
      onExit: (listener) => host.onExit(listener),
      listModels: (sessionId) => host.listModels(sessionId),
      startSession: (options) =>
        ports.sessionChanged === undefined
          ? Promise.reject(new Error('MHP_PANEL_BINDING_MISMATCH'))
          : host.startSession(options),
      listSessions: (options) => host.listSessions(options),
      readSession: (sessionId, options) => host.readSession(sessionId, options),
      resumeSession: (sessionId, modelId, options) => {
        if (sessionId === prepared?.session.sessionId) {
          const adopted = prepared
          prepared = undefined
          return Promise.resolve(adopted)
        }
        return ports.sessionChanged === undefined
          ? Promise.reject(new Error('MHP_PANEL_BINDING_MISMATCH'))
          : host.resumeSession(sessionId, modelId, options)
      },
      forkSession: (sessionId, modelId, options) =>
        ports.sessionChanged === undefined
          ? Promise.reject(new Error('MHP_PANEL_BINDING_MISMATCH'))
          : host.forkSession(sessionId, modelId, options),
      onSessionListEvent: (listener) => host.onSessionListEvent(listener),
      readUsage: () => host.readUsage(),
      onUsageChanged: (listener) => host.onUsageChanged(listener),
      get sessionCount() {
        return host.sessionCount
      },
      close: () => host.close(),
    }
    this.conversation = conversationLoader({ bundlePath, log: this.log })().createConversation(
      {
        ...deps,
        ensureHost: () => Promise.resolve(ownedHost),
        ...(ports.sessionChanged !== undefined && {
          onSessionAttached: async (session: AgentSession) => {
            this.ensureLive()
            const previous = this.session
            this.session = session
            try {
              if (session.sessionId !== previous.sessionId)
                await ports.sessionChanged?.(previous.sessionId, session.sessionId)
              this.ensureLive()
            } catch (error: unknown) {
              this.session = previous
              session.dispose()
              throw error
            }
          },
        }),
        ...(ports.openSideChat !== undefined && { openSideChat: ports.openSideChat }),
        ...(externalMode !== undefined && {
          arePermissionsExternal: true,
          initialPermissionMode: externalMode,
        }),
      },
      UI_TEXT,
      uiLocale(),
    )
    if (this.isReleased) {
      this.conversation.dispose()
      this.conversation = undefined
      throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
    }
    await this.conversation.restoreSession(this.sessionId)
    this.ensureLive()
    if (externalMode !== undefined) this.conversation.useExternalPermissionMode(externalMode)
    if (this.conversation.boardSession()?.sessionId !== this.sessionId)
      throw new Error('MHP_PANEL_SESSION_ADOPTION_FAILED')
  }

  private async handleMessage(payload: Parameters<PanelView['handle']>[0]): Promise<void> {
    if (this.isDisposed || this.conversation === undefined)
      throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
    const message = webviewToHostMessageSchema.parse(payload)
    switch (message.type) {
      case 'ready': {
        if (this.settings === undefined) throw new Error('MHP_PANEL_NOT_PREPARED')
        const init = hostToWebviewMessageSchema.parse({
          type: 'init',
          emptyStateHint: UI_TEXT.emptyStateHint,
          composerPlaceholder: UI_TEXT.composerPlaceholder,
          settings: this.settings.current(),
        })
        for (const listener of this.listeners) listener(init)
        const history = await this.host.readSession(this.sessionId)
        if (this.isReleased) return
        for (const listener of this.listeners) {
          if (this.authMessage !== undefined) listener(this.authMessage)
        }
        this.conversation.replayHistory(history)
        this.conversation.surfaceReady(message.attachmentEpoch)
        break
      }
      case 'inputFocusChanged': {
        this.log.trace('MHP_INPUT_FOCUS_CHANGED')
        break
      }
      case 'surfaceFocused': {
        this.log.trace('MHP_SURFACE_FOCUSED')
        break
      }
      case 'webviewError': {
        this.log.warn('MHP_WEBVIEW_ERROR')
        break
      }
      default: {
        await this.conversation.handle(message)
        if (this.canRebind && message.type === 'clearConversation')
          await this.conversation.startFreshSession()
      }
    }
  }

  private async releaseController(): Promise<void> {
    try {
      // Cancel on the actual session, including a start not yet acknowledged.
      if (this.isHostStopped) {
        await this.host.close()
      } else {
        await this.session.cancel()
      }
    } finally {
      // Preparation can own a controller before registry publication. Its awaits
      // and every admitted handler must quiesce before the last storage drain.
      await Promise.allSettled([
        ...(this.preparation === undefined ? [] : [this.preparation]),
        ...this.inFlight,
      ])
      try {
        if (!this.isHostStopped) await this.conversation?.backendStopping(true)
      } finally {
        this.conversation?.dispose()
        this.conversation = undefined
        this.session.dispose()
        await this.store?.settled()
      }
    }
  }
  public prepare(
    ports: Omit<RuntimeConversationPorts, 'surface'>,
    loaded: LoadedSession,
    bundlePath: string,
    compose: typeof runtimeConversationDeps,
    externalMode?: PermissionMode,
  ): Promise<void> {
    if (this.isDisposed || this.preparation !== undefined)
      return Promise.reject(new Error('MHP_PANEL_UNKNOWN_SURFACE'))
    this.preparation = this.prepareController(ports, loaded, bundlePath, compose, externalMode)
    return this.preparation
  }

  public get controller(): ConversationController | undefined {
    return this.conversation
  }
  public get sessionId(): string {
    return this.session.sessionId
  }
  public get isReleased(): boolean {
    return this.isDisposed
  }

  public handle(payload: Parameters<PanelView['handle']>[0]): Promise<void> {
    if (this.isDisposed) return Promise.reject(new Error('MHP_PANEL_UNKNOWN_SURFACE'))
    const previous = this.handling
    const work = (async () => {
      await previous
      await this.handleMessage(payload)
    })()
    this.handling = (async () => {
      try {
        await work
      } catch {
        /* A refused old view does not veto the next admitted view's replay. */
      }
    })()
    this.inFlight.add(work)
    void work
      .then(() => {
        this.inFlight.delete(work)
      })
      .catch(() => {
        this.inFlight.delete(work)
      })
    return work
  }

  public subscribe(listener: (message: HostToWebviewMessage) => void): () => void {
    this.ensureLive()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public hostExited(_description: string): void {
    this.isHostStopped = true
    // The carrier closes first. Host.close must dispose dead MSP handles
    // before controller.dispose can request task/stopAll on one of them.
    this.stopped()
  }

  public release(): Promise<void> {
    if (this.releasing !== undefined) return this.releasing
    this.isDisposed = true
    this.listeners.clear()
    this.releasing = this.releaseController()
    return this.releasing
  }
}
