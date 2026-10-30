// One conversation of the runtime panel (M104 lane B, D84, D226): the same
// `ConversationController` VS Code runs, in the runtime's process, behind a
// chat surface that is carried over MHP. The controller starts, resumes and
// forks its own sessions exactly as in VS Code; this class only learns of
// each session it takes (`onSessionAttached`) so the registry and the host's
// surfaces follow it, answers a webview's `ready` as the editor's webview
// setup does, and fans the controller's output out to the surfaces showing it.
// Any number of surfaces may show one conversation; a session change replaces
// them all with fresh ones (MHP binds a surface to one session for good).
import { randomUUID } from 'node:crypto'
import type * as z from 'zod/mini'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import type * as ConversationBundle from '../../host/conversation/conversationEntry'
import type {
  ConversationController,
  ConversationDeps,
} from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import { composerPlaceholderFor } from '../../host/views/composerPlaceholder'
import type { ChatSurface } from '../../host/views/chatSurface'
import type { TasksTabPort } from '../../host/views/tasksTabPort'
import { MHP_PANEL, UI_TEXT } from '../../shared/constants'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import { MhpPanelError } from '../../shared/hostApi/panelError'
import { uiLocale } from '../../shared/l10n/text'
import type { PaidState } from '../../shared/paid'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
  type EditorContextSummary,
  type HostToWebviewMessage,
  type SettingsSnapshot,
} from '../../shared/protocol'
import type { QuestionStore } from '../../shared/questions'
import type { SessionController } from './controllerRegistry'
import type { PanelView } from './surfaces'
import { RuntimeTasksTab } from './tasksTab'

/** What the MHP panel wire carries to a chat view: the shared chat payloads. */
type PanelHostMessage = z.infer<typeof hostToWebviewMessageSchema>

/** What a composition needs from the conversation it builds the controller's dependencies for. */
export interface ConversationContext {
  /** The surface the controller posts to; it fans out to every MHP surface showing the conversation. */
  readonly surface: ChatSurface
  /** Aborted when the conversation is released. */
  readonly signal: AbortSignal
  /** The id of the session the conversation is on now (an id of its own before it has one). */
  readonly sessionId: () => string
  /** The controller, once built (the composition's ports may need it later). */
  readonly controller: () => ConversationController | undefined
  /** The host this conversation's sessions run on (the registry watches it for exit). */
  noteHost(host: AgentHost): void
  /** The tasks tab the controller opens from "Open in a Tab". */
  readonly tasksTab: TasksTabPort
  /** A resource the composition acquired: released with the conversation, even when a later step fails. */
  own(dispose: () => Promise<void> | void): void
}

export interface RuntimeConversationOptions {
  readonly log: Logger
  /** dist/conversation.js, the controller's lazily loaded bundle. */
  readonly bundle: typeof ConversationBundle
  /** Where this runtime keeps open questions, and when an unanswered one is deferred. */
  readonly questionStore: QuestionStore
  readonly deferAfterSeconds: () => number
  /** A side chat opens in Plan mode and keeps its conversation apart (M53). */
  readonly isSideChat: boolean
  /** The settings the webview is shown at `ready`. */
  readonly settings: () => SettingsSnapshot
  /** The paid features' state the webview is shown at `ready`. */
  readonly paidState: () => PaidState
  /** The controller's dependencies, composed for this conversation's surface. */
  readonly compose: (context: ConversationContext) => Promise<ConversationDeps>
  /** The editor's surfaces of the conversation: which are open, and asking for, focusing and finding them. */
  readonly surfaces: {
    idsOf(sessionId: string, kind: 'chat' | 'tasks'): readonly string[]
    open(sessionId: string, kind: 'tasks'): Promise<void>
    focus(surfaceId: string): Promise<void>
  }
  /** The conversation took another session: the registry follows, the host's surfaces are replaced. */
  readonly sessionChanged: (
    previousId: string,
    session: AgentSession,
    conversation: RuntimeConversation,
  ) => Promise<void>
  /**
  A message has been handled: a session change it caused is complete, so the
  surface for the new session opens now, never while the controller is still
  taking the session (a webview that is ready by then would find none).
  */
  readonly settled: (conversation: RuntimeConversation) => Promise<void>
  /** The backend this conversation runs on ended: the connection ends with it. */
  readonly stopped: () => void
}

/** A runtime panel is never rebuilt around a session an earlier window held (that is VS Code's D15). */
function noRestoredSession(): string | undefined {
  return
}

/** What a conversation that was let go, or never prepared, answers: the contract's unknown surface. */
function unknownSurface(): MhpPanelError {
  return new MhpPanelError({
    mhp: MHP_PANEL.wireVersion,
    kind: 'panelError',
    surface: null,
    seq: null,
    code: 'MHP_PANEL_UNKNOWN_SURFACE',
  })
}

export class RuntimeConversation implements SessionController, PanelView {
  private readonly ending = new AbortController()
  private readonly listeners = new Set<(message: PanelHostMessage) => void>()
  private readonly cleanups: (() => Promise<void> | void)[] = []
  private readonly inFlight = new Set<Promise<void>>()
  private conversation: ConversationController | undefined
  private preparation: Promise<void> | undefined
  private releasing: Promise<void> | undefined
  private handling: Promise<void> = Promise.resolve()
  private currentHost: AgentHost | undefined
  private currentSession: AgentSession | undefined
  private currentId: string = randomUUID()
  private authMessage: PanelHostMessage | undefined
  private isDisposed = false
  private isHostStopped = false

  private readonly tasksTab: RuntimeTasksTab

  public constructor(private readonly options: RuntimeConversationOptions) {
    const { surfaces } = options
    this.tasksTab = new RuntimeTasksTab({
      openSurfaces: () => surfaces.idsOf(this.currentId, 'tasks'),
      openSurface: async () => {
        await surfaces.open(this.currentId, 'tasks')
      },
      focusSurface: async (surfaceId) => {
        await surfaces.focus(surfaceId)
      },
      revealConversation: async () => {
        for (const id of surfaces.idsOf(this.currentId, 'chat')) await surfaces.focus(id)
      },
      log: options.log,
    })
  }

  private ensureLive(): void {
    if (this.isDisposed) throw unknownSurface()
  }

  private surface(): ChatSurface {
    return {
      id: this.sessionId,
      // The MHP host renders the document, so no runtime-built HTML carries an
      // id: document-scoped offers (M107's resource window) name another
      // document and are refused, as for a VS Code document never built.
      documentId: randomUUID(),
      ...(this.options.isSideChat && { isSideChat: true }),
      post: (message) => {
        this.publish(message)
      },
      reveal: () => {
        this.options.log.trace('MHP_SURFACE_REVEAL')
      },
      markUnread: () => {
        this.options.log.trace('MHP_SURFACE_UNREAD')
      },
      setTitle: () => {
        this.options.log.trace('MHP_SURFACE_TITLE_CHANGED')
      },
      reload: () => {
        this.options.log.warn('MHP_SURFACE_RELOAD_REQUIRED')
      },
      takeRestoredSessionId: noRestoredSession,
      dispose: () => {
        this.listeners.clear()
      },
    }
  }

  private publish(message: HostToWebviewMessage): void {
    if (this.isDisposed) return
    const parsed = hostToWebviewMessageSchema.parse(message)
    if (parsed.type === 'authState') this.authMessage = parsed
    for (const listener of this.listeners) listener(parsed)
  }

  private async prepareController(): Promise<void> {
    const deps = await this.options.compose({
      surface: this.surface(),
      signal: this.ending.signal,
      sessionId: () => this.currentId,
      controller: () => this.conversation,
      tasksTab: this.tasksTab,
      noteHost: (host) => {
        this.currentHost = host
      },
      own: (dispose) => {
        this.cleanups.push(dispose)
      },
    })
    this.ensureLive()
    const { bundle } = this.options
    this.conversation = bundle.createConversation(
      {
        ...deps,
        questions: bundle.questionsForHost(
          this.options.questionStore,
          this.options.deferAfterSeconds,
        ),
        onSessionAttached: async (session) => {
          this.ensureLive()
          const previousId = this.currentId
          const previousSession = this.currentSession
          this.currentSession = session
          this.currentId = session.sessionId
          try {
            if (session.sessionId !== previousId)
              await this.options.sessionChanged(previousId, session, this)
            this.ensureLive()
          } catch (error: unknown) {
            // REPORTED: the conversation stays on what it had; the controller disposes the session it was refused.
            this.currentSession = previousSession
            this.currentId = previousId
            throw error
          }
        },
      },
      UI_TEXT,
      uiLocale(),
    )
    if (!this.isDisposed) {
      return
    }

    this.conversation.dispose()
    this.conversation = undefined
    throw unknownSurface()
  }

  private paidMessage(): HostToWebviewMessage {
    return { type: 'paidState', state: this.options.paidState() }
  }

  private initMessage(settings: SettingsSnapshot): HostToWebviewMessage {
    return {
      type: 'init',
      emptyStateHint: UI_TEXT.emptyStateHint,
      composerPlaceholder: composerPlaceholderFor(process.platform),
      settings: this.options.isSideChat ? { ...settings, initialPermissionMode: 'plan' } : settings,
      ...(this.options.isSideChat && { sideChat: true }),
    }
  }

  private async handleMessage(payload: Parameters<PanelView['handle']>[0]): Promise<void> {
    try {
      await this.dispatchMessage(payload)
      await this.options.settled(this)
    } catch (error: unknown) {
      // REPORTED: a message that failed is logged by kind and said to the person; the connection goes on.
      this.options.log.error(`A panel message failed: ${failureForLog(error)}`)
      this.publish({ type: 'notice', level: 'error', text: UI_TEXT.actionFailed })
    }
  }

  private async dispatchMessage(payload: Parameters<PanelView['handle']>[0]): Promise<void> {
    const controller = this.conversation
    if (controller === undefined || this.isDisposed) return
    const message = webviewToHostMessageSchema.parse(payload)
    switch (message.type) {
      case 'ready': {
        // A surface that is ready shows what the conversation holds now: the
        // settings, the sign-in state, then the session's transcript.
        for (const listener of this.listeners) {
          listener(hostToWebviewMessageSchema.parse(this.initMessage(this.options.settings())))
          if (this.authMessage !== undefined) listener(this.authMessage)
          listener(hostToWebviewMessageSchema.parse(this.paidMessage()))
        }
        await this.replay(controller)
        controller.surfaceReady(message.attachmentEpoch)
        break
      }
      case 'inputFocusChanged': {
        this.options.log.trace('MHP_INPUT_FOCUS_CHANGED')
        break
      }
      case 'surfaceFocused': {
        this.options.log.trace('MHP_SURFACE_FOCUSED')
        break
      }
      case 'webviewError': {
        this.options.log.warn('MHP_WEBVIEW_ERROR')
        break
      }
      case 'clearConversation': {
        await controller.handle(message)
        // Clear opens a new opaque session before a replacement surface is published.
        await controller.startFreshSession()
        break
      }
      default: {
        await controller.handle(message)
      }
    }
  }

  private async replay(controller: ConversationController): Promise<void> {
    const session = this.currentSession
    const host = this.currentHost
    if (session === undefined || host === undefined) return
    const history = await host.readSession(session.sessionId)
    this.ensureLive()
    controller.replayHistory(history)
  }

  private async releaseController(): Promise<void> {
    // Cancel on the actual session, including a start not yet acknowledged.
    const cancelled = await Promise.allSettled([
      this.isHostStopped ? this.currentHost?.close() : this.currentSession?.cancel(),
    ])
    // Preparation can own a controller before registry publication; its awaits
    // and every admitted handler quiesce before the cleanups run.
    await Promise.allSettled([
      ...(this.preparation === undefined ? [] : [this.preparation]),
      ...this.inFlight,
    ])
    const stopped = await Promise.allSettled([
      this.isHostStopped ? undefined : this.conversation?.backendStopping(true),
    ])
    this.conversation?.dispose()
    this.conversation = undefined
    this.currentSession?.dispose()
    const cleaned = await Promise.allSettled(
      this.cleanups.splice(0).map(async (dispose) => {
        await dispose()
      }),
    )
    if ([...cancelled, ...stopped, ...cleaned].some((result) => result.status === 'rejected'))
      throw new Error('MHP_COMPOSITION_RELEASE_FAILED')
  }

  /** The session's id, or an opaque id of the conversation's own until it has a session. */
  public get sessionId(): string {
    return this.currentId
  }

  public get host(): AgentHost | undefined {
    return this.currentHost
  }

  public get isReleased(): boolean {
    return this.isDisposed
  }

  public get signal(): AbortSignal {
    return this.ending.signal
  }

  public get controller(): ConversationController | undefined {
    return this.conversation
  }

  /** The model the conversation is on. */
  public get modelId(): string | undefined {
    return this.conversation?.selectedModelId
  }

  /** Builds the controller. Nothing is shown until a surface subscribes. */
  public prepare(): Promise<void> {
    if (this.isDisposed || this.preparation !== undefined) return Promise.reject(unknownSurface())
    this.preparation = this.prepareController()
    return this.preparation
  }

  /** Whether the host's surface binding names this conversation's current session. */
  public view(binding: MhpPanelBinding): PanelView | undefined {
    if (this.isDisposed || binding.sessionId !== this.currentId) return undefined
    switch (binding.surfaceKind) {
      case 'chat': {
        return this
      }
      case 'tasks': {
        return this.tasksTab
      }
      default: {
        return undefined
      }
    }
  }

  /** What the person typed; one message at a time, in the order the host sent them. */
  public handle(payload: Parameters<PanelView['handle']>[0]): Promise<void> {
    if (this.isDisposed) {
      // A message for a conversation that was let go meanwhile is dropped, not a fault of the connection.
      this.options.log.trace('MHP_PANEL_LATE_MESSAGE_DROPPED')
      return Promise.resolve()
    }
    const previous = this.handling
    const work = (async () => {
      await previous
      await this.handleMessage(payload)
    })()
    this.handling = (async () => {
      try {
        await work
      } catch (error: unknown) {
        // REPORTED: a refused message does not veto the next one; its own caller got the rejection.
        this.options.log.warn(`A panel message was refused: ${failureForLog(error)}`)
      }
    })()
    this.inFlight.add(work)
    void work.finally(() => {
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

  /** A paid feature turned on or off, or was used: every surface shows the state. */
  public publishPaidState(): void {
    this.publish(this.paidMessage())
  }

  /** The active editor's label changed: every surface shows it. */
  public publishEditorContext(context: EditorContextSummary | undefined): void {
    this.publish({ type: 'editorContext', context })
  }

  /** The settings changed: every surface is shown the new ones. */
  public publishSettings(settings: SettingsSnapshot): void {
    this.publish(this.initMessage(settings))
  }

  /** The backend went away: the carrier closes first, then the conversation is released. */
  public hostExited(_description: string): void {
    this.isHostStopped = true
    this.options.stopped()
  }

  public release(): Promise<void> {
    if (this.releasing !== undefined) return this.releasing
    this.isDisposed = true
    this.ending.abort()
    this.listeners.clear()
    this.tasksTab.dispose()
    this.releasing = this.releaseController()
    return this.releasing
  }
}
