import { randomUUID } from 'node:crypto'
import type * as z from 'zod/mini'
import type { AgentHost, AgentSession, LoadedSession } from '../../core/agent/agentBackend'
import { conversationLoader } from '../../host/conversation/conversationBundle'
import type { ConversationController } from '../../host/conversation/conversationController'
import type { ChatSurface } from '../../host/views/chatSurface'
import type { Logger } from '../../host/logger'
import { UI_TEXT, MHP_PANEL, type PermissionMode } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
  type WebviewToHostMessage,
} from '../../shared/protocol'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import type { PanelView } from './surfaces'
import type { RuntimeConversationPorts } from './runtimeFeatures'
import type { runtimeConversationDeps } from './runtimeFeatures'
import type { SessionController } from './controllerRegistry'

/**
What the MHP panel wire carries to a chat view: the shared chat payloads.
VS Code's lazily validated estimator and team-tree messages are not panel
payloads, so `post` refuses them like any other unvalidated message.
*/
type PanelHostMessage = z.infer<typeof hostToWebviewMessageSchema>

/** One conversation owns the session; any number of transport views subscribe to it. */
export class RuntimeConversation implements SessionController, PanelView {
  private readonly ending = new AbortController()
  private readonly listeners = new Set<(message: PanelHostMessage) => void>()
  private conversation: ConversationController | undefined
  private preparation: Promise<void> | undefined
  private releasing: Promise<void> | undefined
  private readonly inFlight = new Set<Promise<void>>()
  private readonly afterReady: Extract<
    WebviewToHostMessage,
    { type: 'hostAction' | 'openReport' }
  >[] = []
  private handling: Promise<void> = Promise.resolve()
  private isDisposed = false
  private isHostStopped = false
  private authMessage: PanelHostMessage | undefined
  private settings: RuntimeConversationPorts['settings'] | undefined
  private store: RuntimeConversationPorts['store'] | undefined
  private canRebind = false
  private readonly cleanups: (() => Promise<void>)[] = []
  private readonly views = new Set<(binding: MhpPanelBinding) => PanelView | undefined>()

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
    if (ports.ownsSettings === true) this.cleanups.push(() => ports.settings.dispose())
    this.canRebind = ports.sessionChanged !== undefined
    const surface: ChatSurface = {
      id: this.sessionId,
      // The MHP host renders the document, so no runtime-built HTML carries
      // an id: document-scoped offers (M107's resource window) name another
      // document and are refused, as for a VS Code document never built.
      documentId: randomUUID(),
      ...((loaded.record.sideChat === true || ports.isSideChat === true) && { isSideChat: true }),
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
    const deps = await compose({
      ...ports,
      surface,
      signal: this.ending.signal,
      controller: () => this.conversation,
      queueAfterReady: (message) => {
        this.ensureLive()
        if (this.afterReady.length >= MHP_PANEL.maximumQueuedMessages)
          throw new Error('MHP_DEFERRED_ACTION_REFUSED')
        const parsed = webviewToHostMessageSchema.parse(message)
        if (parsed.type !== 'hostAction' && parsed.type !== 'openReport')
          throw new Error('MHP_DEFERRED_ACTION_REFUSED')
        this.afterReady.push(parsed)
      },
      own: (dispose) => {
        this.cleanups.push(dispose)
      },
      publishView: (lookup) => {
        this.views.add(lookup)
        return () => {
          this.views.delete(lookup)
        }
      },
    })
    this.ensureLive()
    // ACP keeps its editor-owned identity; panel sessions move through the registry
    // and retire all old immutable surface bindings before publishing new output.
    let prepared: LoadedSession | undefined = loaded
    const ownedHosts = new WeakMap<AgentHost, AgentHost>()
    const ensureHost = async (): Promise<AgentHost> => {
      const host = await deps.ensureHost()
      this.ensureLive()
      const existing = ownedHosts.get(host)
      if (existing !== undefined) return existing
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
        readSessionOutput: (sessionId, request) => host.readSessionOutput(sessionId, request),
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
        deleteSession: (sessionId) => host.deleteSession(sessionId),
        readUsage: () => host.readUsage(),
        onUsageChanged: (listener) => host.onUsageChanged(listener),
        get sessionCount() {
          return host.sessionCount
        },
        close: () => host.close(),
      }
      ownedHosts.set(host, ownedHost)
      return ownedHost
    }
    this.conversation = conversationLoader({ bundlePath, log: this.log })().createConversation(
      {
        ...deps,
        ensureHost,
        ...(ports.selectedModel !== undefined && {
          modelAllowsFeature: async (modelId: string, feature: string) => {
            const record = await ports.selectedModel?.()
            return record?.modelId === modelId && record.capabilities.has(feature)
          },
        }),
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
        for (const action of this.afterReady.splice(0)) {
          this.ensureLive()
          await this.conversation.handle(action)
        }
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
    let hasCleanupFailure: boolean
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
        const cleanup = await Promise.allSettled(
          this.cleanups.splice(0).map(async (dispose) => {
            await dispose()
          }),
        )
        this.views.clear()
        await this.store?.settled()
        hasCleanupFailure = cleanup.some((result) => result.status === 'rejected')
      }
    }
    if (hasCleanupFailure) throw new Error('MHP_COMPOSITION_RELEASE_FAILED')
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

  public get signal(): AbortSignal {
    return this.ending.signal
  }
  public get controller(): ConversationController | undefined {
    return this.conversation
  }
  public view(binding: MhpPanelBinding): PanelView | undefined {
    if (this.isDisposed || binding.sessionId !== this.sessionId) return
    for (const lookup of this.views) {
      const found = lookup(binding)
      if (found !== undefined)
        return {
          handle: async (message) => {
            this.ensureLive()
            const work = Promise.resolve(found.handle(message))
            this.inFlight.add(work)
            try {
              await work
            } finally {
              this.inFlight.delete(work)
            }
          },
          subscribe: (listener) => {
            this.ensureLive()
            return found.subscribe(listener)
          },
        }
    }
    return
  }
  public get sessionId(): string {
    return this.session.sessionId
  }
  public get modelId(): string {
    return this.conversation?.selectedModelId ?? this.session.modelId
  }
  public publishSettings(
    settings: ReturnType<RuntimeConversationPorts['settings']['current']>,
  ): void {
    if (this.isDisposed) return
    const message = hostToWebviewMessageSchema.parse({
      type: 'init',
      settings,
      emptyStateHint: UI_TEXT.emptyStateHint,
      composerPlaceholder: UI_TEXT.composerPlaceholder,
    })
    for (const listener of this.listeners) listener(message)
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

  public subscribe(listener: (message: PanelHostMessage) => void): () => void {
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
    this.ending.abort()
    this.afterReady.length = 0
    this.listeners.clear()
    this.releasing = this.releaseController()
    return this.releasing
  }
}
