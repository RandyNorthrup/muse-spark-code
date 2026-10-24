// The conversations of one runtime panel connection (M104 lane B, D84):
// dist/runtimePanelSession.js, loaded by `panel` once the host's handshake has
// named the workspace. It owns the runtime backend the person's settings and
// the editor's trust name, the registry of conversations, the first chat
// surface, and what follows a change of settings, trust, selection or
// documents. The transport (frames, the handshake, settings and storage) is
// dist/runtimePanel.js.
import path from 'node:path'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { ConversationController } from '../../host/conversation/conversationController'
import { conversationLoader } from '../../host/conversation/conversationBundle'
import { EditorContextTracker } from '../../host/editor/editorContextTracker'
import { logRejection, type Logger } from '../../host/logger'
import { toSettingsSnapshot, type ExtensionSettings } from '../../host/settings'
import {
  ACP_DEFAULT_BACKEND,
  CONVERSATION_BUNDLE_FILE,
  RUNTIME_PANEL_RECONFIGURE_SETTINGS,
  UI_TEXT,
} from '../../shared/constants'
import type { MhpNotificationMethod, MhpParams } from '../../shared/hostApi/methods'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { runtimeEditorContext } from '../features/editorContext'
import { createRuntimeWorkspaceFiles } from '../features/workspaceFiles'
import type { RuntimeSettingsStore } from '../settingsStore'
import type { PanelConnection } from './connection'
import { ControllerRegistry } from './controllerRegistry'
import { RuntimeConversation } from './runtimeConversation'
import { runtimeConversationDeps } from './runtimeFeatures'
import type { PanelView } from './surfaces'

export interface PanelSessionDeps {
  /** The connection to the host: its requests, notifications and surfaces. */
  readonly connection: PanelConnection
  readonly store: RuntimeSettingsStore
  readonly workspace: string
  readonly dataFolder: string
  /** The folder holding the shipped bundles (dist/). */
  readonly distDir: string
  readonly isVerbose: boolean
  /** The runtime backend these options name; the engine bundle loads on first use. */
  readonly createRuntime: (
    options: ServeOptions,
    questions: { remove(sessionId: string): Promise<void> },
  ) => Promise<RuntimeBackend>
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly log: Logger
  readonly table: UiText
  readonly locale: string
  /** The conversations cannot go on (the backend stopped): the connection ends. */
  readonly stopped: () => void
}

export interface PanelSession {
  initialize(params: MhpParams<'initialize'>, signal: AbortSignal): Promise<void>
  /** The handshake was answered: the first chat surface opens. */
  initialized(): void
  notify(method: MhpNotificationMethod, value: unknown): void
  view(binding: MhpPanelBinding): PanelView | undefined
  /** Ends every conversation and the backend. */
  close(): Promise<void>
}

interface OpenDocument {
  readonly uri: string
  readonly dirty: boolean
}

/** The options the runtime backend is built from, from the person's settings and the editor's trust. */
function serveOptions(
  settings: ExtensionSettings,
  isTrusted: () => boolean,
  isVerbose: boolean,
): ServeOptions {
  return {
    backend: settings.backend === 'auto' ? ACP_DEFAULT_BACKEND : settings.backend,
    get trustWorkspace() {
      return isTrusted()
    },
    museBinary: settings.museBinaryPath,
    shellSandbox: settings.shellSandbox,
    canBypass: settings.allowDangerouslySkipPermissions,
    // The person confirms a contributor-tier model in the panel before it is used.
    allowsContributorModels: true,
    paidFeatures: [],
    isVerbose,
    questionsDeferAfterSeconds: settings['questions.deferAfterSeconds'],
    autoCompaction: true,
  }
}

/** The controllers of the conversations that have built theirs. */
function controllersOf(held: Iterable<RuntimeConversation>): ConversationController[] {
  const found: ConversationController[] = []
  for (const conversation of held)
    if (conversation.controller !== undefined) found.push(conversation.controller)
  return found
}

/** Whether a settings change touches what the backend is built from. */
function isReconfiguring(previous: ExtensionSettings, next: ExtensionSettings): boolean {
  return RUNTIME_PANEL_RECONFIGURE_SETTINGS.some((key) => {
    const name = key.slice('museSpark.'.length)
    return JSON.stringify(Reflect.get(previous, name)) !== JSON.stringify(Reflect.get(next, name))
  })
}

export function createPanelSession(deps: PanelSessionDeps): PanelSession {
  setUiText(deps.table, deps.locale)
  const { connection, store, workspace, log } = deps
  const bundle = conversationLoader({
    bundlePath: path.join(deps.distDir, CONVERSATION_BUNDLE_FILE),
    log,
  })()
  const questionStore = bundle.createHostQuestionStore(deps.dataFolder)
  const registry = new ControllerRegistry<RuntimeConversation>({
    missing: () => new Error('MHP_SESSION_NOT_FOUND'),
    hostStopped: () => {
      log.warn('MHP_BACKEND_STOPPED')
    },
  })
  const documents = new Map<string, OpenDocument>()
  /** The documents the host has told the runtime about, with whether each has unsaved changes. */
  const openDocuments = (): readonly OpenDocument[] => {
    const held: Iterable<OpenDocument> = documents.values()
    return [...held]
  }
  const ending = new AbortController()
  /** Conversations that took another session and have no surface for it yet. */
  const awaitingSurface = new WeakSet<RuntimeConversation>()
  let settings: ExtensionSettings | undefined
  let isTrusted = false
  let runtime: RuntimeBackend | undefined
  let selection: MhpParams<'editor/didChangeSelection'>['selection'] = null
  let replacing: Promise<void> = Promise.resolve()
  let stopSettings: (() => void) | undefined
  let stopped: Promise<void> | undefined

  const files = createRuntimeWorkspaceFiles({
    host: connection,
    workspaceRoot: workspace,
    log,
    respectGitIgnore: () => settings?.respectGitIgnore ?? true,
    isWorkspaceTrusted: () => isTrusted,
    runGit: deps.runGit,
  })
  const editorContext = new EditorContextTracker({
    broadcast: (context) => {
      for (const held of registry.controllers()) held.publishEditorContext(context)
    },
  })

  const currentSettings = (): ExtensionSettings => {
    if (settings === undefined) throw new Error('MHP_NOT_INITIALIZED')
    return settings
  }

  async function openSurface(sessionId: string): Promise<void> {
    if (!connection.offers('surfaces')) {
      log.warn('MHP_SURFACES_NOT_OFFERED')
      return
    }
    await connection.request(
      'surfaces/open',
      { kind: 'chat', placement: 'side', sessionId },
      ending.signal,
    )
  }

  /** A session's surfaces end here, before its replacement is shown. */
  async function retire(sessionId: string): Promise<void> {
    // Without the capability the host cannot be asked to close what it opened itself.
    for (const binding of connection.surfaces.retireSession(sessionId)) {
      if (!connection.offers('surfaces')) break
      await connection.request('surfaces/close', { surfaceId: binding.surface }, ending.signal)
    }
  }

  function newConversation(isSideChat: boolean): RuntimeConversation {
    const backend = runtime
    if (backend === undefined) throw new Error('MHP_NOT_INITIALIZED')
    return new RuntimeConversation({
      log,
      bundle,
      questionStore,
      deferAfterSeconds: () => currentSettings()['questions.deferAfterSeconds'],
      isSideChat,
      settings: () => toSettingsSnapshot(currentSettings()),
      compose: (context) =>
        runtimeConversationDeps(
          {
            host: connection,
            runtime: backend,
            workspaceRoot: workspace,
            store,
            settings: currentSettings,
            isTrusted: () => isTrusted,
            canBypass: currentSettings().allowDangerouslySkipPermissions,
            controllers: () => controllersOf(registry.controllers()),
            runGit: deps.runGit,
            files,
            editorContext: () => editorContext.active,
            documents: openDocuments,
            isSideChat,
            log,
          },
          {
            ...context,
            noteHost: (host) => {
              context.noteHost(host)
              registry.watch(host)
            },
          },
        ),
      sessionChanged: async (previousId, session, conversation) => {
        await registry.rebind(previousId, session.sessionId, conversation)
        try {
          await retire(previousId)
        } catch (error: unknown) {
          // REPORTED: the conversation stays on the session it had; the refusal reaches the controller.
          await registry.rebind(session.sessionId, previousId, conversation)
          throw error
        }
        // Its surface opens once the controller has finished taking the session.
        awaitingSurface.add(conversation)
      },
      settled: async (conversation) => {
        if (awaitingSurface.delete(conversation)) await openSurface(conversation.sessionId)
      },
      stopped: deps.stopped,
    })
  }

  async function startConversation(isSideChat = false): Promise<RuntimeConversation> {
    const conversation = newConversation(isSideChat)
    registry.hold(conversation.sessionId, conversation)
    try {
      await conversation.prepare()
    } catch (error: unknown) {
      // REPORTED: a conversation that could not be built is let go; the caller says why.
      await registry.closeSession(conversation.sessionId)
      throw error
    }
    return conversation
  }

  /** The first conversation: a session when the backend is ready, else the sign-in gate in its own surface. */
  async function openInitialSurface(): Promise<void> {
    const conversation = await startConversation()
    const provisional = conversation.sessionId
    const { controller } = conversation
    const readiness = await runtime?.backend.readiness(false)
    if (controller !== undefined && readiness?.state === 'ready') {
      try {
        await controller.startFreshSession()
      } catch (error: unknown) {
        // REPORTED: the controller said why on its surface; the surface still opens to show it.
        log.warn(`A first session could not be started: ${failureForLog(error)}`)
      }
    }
    // A session change leaves its surface to open; otherwise the provisional id is the surface's.
    if (awaitingSurface.delete(conversation)) await openSurface(conversation.sessionId)
    else if (conversation.sessionId === provisional) await openSurface(provisional)
  }

  async function createBackend(): Promise<void> {
    const options = serveOptions(currentSettings(), () => isTrusted, deps.isVerbose)
    const created = await deps.createRuntime(options, questionStore)
    runtime = created
    await created.forgetUnflaggedGrants()
  }

  /** The backend is built from settings and trust: a change ends its conversations and starts afresh. */
  function replaceBackend(): Promise<void> {
    replacing = (async () => {
      await replacing
      if (ending.signal.aborted) return
      const old = runtime
      for (const held of registry.controllers()) {
        await retire(held.sessionId)
        await registry.closeSession(held.sessionId)
      }
      await old?.close()
      await createBackend()
      await openInitialSurface()
    })()
    return replacing
  }

  async function settingsChanged(keys: readonly string[]): Promise<void> {
    const previous = settings
    const next = await store.readAll()
    settings = next
    for (const held of registry.controllers()) {
      held.publishSettings(toSettingsSnapshot(next))
      if (!next.allowDangerouslySkipPermissions) await held.controller?.revokeBypass()
    }
    if (keys.length > 0 && connection.offers('settings'))
      connection.notify('settings/didChange', { keys: [...keys] })
    if (previous !== undefined && isReconfiguring(previous, next)) await replaceBackend()
  }

  function applySettings(keys: readonly string[]): void {
    void settingsChanged(keys).catch((error: unknown) => {
      // REPORTED: settings that could not be applied are logged; the panel keeps what it had.
      log.warn(`Settings could not be applied: ${failureForLog(error)}`)
    })
  }

  function trustChanged(isNowTrusted: boolean): void {
    if (isNowTrusted === isTrusted) return
    isTrusted = isNowTrusted
    void (async () => {
      // Trust revoked fences submissions at once; either way the backend is rebuilt for the new trust.
      await Promise.all(
        [...registry.controllers()].map(async (held) => {
          await held.controller?.backendStopping(true)
        }),
      )
      await replaceBackend()
    })().catch((error: unknown) => {
      // REPORTED: a trust change that could not be applied ends the connection.
      log.error(`A trust change could not be applied: ${failureForLog(error)}`)
      connection.close(true)
    })
  }

  return {
    initialize: async (params, signal) => {
      isTrusted = params.trusted
      settings = await store.readAll()
      stopSettings = store.onSettingsChanged((keys) => {
        applySettings(keys)
      })
      signal.throwIfAborted()
      await createBackend()
      signal.throwIfAborted()
    },
    initialized: () => {
      void openInitialSurface().catch((error: unknown) => {
        // REPORTED: the host is told the conversation could not start.
        log.error(`The panel could not start: ${failureForLog(error)}`)
        void connection
          .request('ui/notify', { severity: 'error', message: UI_TEXT.actionFailed })
          .catch(logRejection(log, 'panel start notice'))
      })
    },
    notify: (method, value) => {
      switch (method) {
        case 'settings/didChange': {
          applySettings([])
          break
        }
        case 'workspace/didChangeTrust':
        case 'workspace/didGrantTrust': {
          trustChanged(MHP_METHODS[method].params.parse(value).trusted)
          break
        }
        case 'editor/didChangeSelection': {
          selection = MHP_METHODS[method].params.parse(value).selection
          editorContext.update(() =>
            runtimeEditorContext(selection, workspace, process.platform, files.admits),
          )
          break
        }
        case 'documents/didChange': {
          const { document } = MHP_METHODS[method].params.parse(value)
          documents.set(document.uri, { uri: document.uri, dirty: document.dirty })
          break
        }
        case 'documents/didSave': {
          const document = MHP_METHODS[method].params.parse(value)
          documents.set(document.uri, { uri: document.uri, dirty: document.dirty })
          break
        }
        case 'documents/didClose': {
          documents.delete(MHP_METHODS[method].params.parse(value).uri)
          break
        }
        default: {
          log.warn(`MHP_NOTIFICATION_UNSUPPORTED ${method}`)
        }
      }
    },
    view: (binding) => registry.held(binding.sessionId)?.view(binding),
    close: () => {
      stopped ??= (async () => {
        ending.abort()
        stopSettings?.()
        editorContext.dispose()
        await registry.releaseEvery()
        await runtime?.close()
      })()
      return stopped
    },
  }
}
