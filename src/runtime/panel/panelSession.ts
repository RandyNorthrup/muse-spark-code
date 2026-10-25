// The conversations of one runtime panel connection (M104 lane B, D84):
// dist/runtimePanelSession.js, loaded by `panel` once the host's handshake has
// named the workspace. It owns the runtime backend the person's settings and
// the editor's trust name, the registry of conversations, the first chat
// surface, and what follows a change of settings, trust, selection or
// documents. The transport (frames, the handshake, settings and storage) is
// dist/runtimePanel.js.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { ConversationController } from '../../host/conversation/conversationController'
import type { SecretStore } from '../../host/auth/credentialStore'
import { conversationLoader } from '../../host/conversation/conversationBundle'
import { EditorContextTracker } from '../../host/editor/editorContextTracker'
import { panelGitLoader } from '../../host/git/nativeGitBundle'
import { isMissingPath } from '../../host/canonicalPath'
import { logRejection, type Logger } from '../../host/logger'
import { toSettingsSnapshot, type ExtensionSettings } from '../../host/settings'
import {
  ACP_DEFAULT_BACKEND,
  CONVERSATION_BUNDLE_FILE,
  NATIVE_GIT_BUNDLE_FILE,
  WORKSPACE_STATE_KEYS,
  type AcpBackendKind,
  type AcpPaidFeature,
  RUNTIME_PANEL_RECONFIGURE_SETTINGS,
  UI_TEXT,
} from '../../shared/constants'
import type { MhpNotificationMethod, MhpParams } from '../../shared/hostApi/methods'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import { jsonValueSchema } from '../../shared/hostApi/data'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { runtimeEditorContext } from '../features/editorContext'
import { createRuntimeDocuments } from '../features/documents'
import { createRuntimePaid } from '../features/paid'
import { runtimeDailyBudgetUsd } from '../dailyBudgetSetting'
import { createRuntimeWorkspaceFiles } from '../features/workspaceFiles'
import type { RuntimeSettingsStore } from '../settingsStore'
import type { PanelConnection } from './connection'
import { ControllerRegistry } from './controllerRegistry'
import type { PanelGit } from './git/panelGit'
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
    /** The files the editor holds with unsaved changes. */
    unsavedFiles: () => readonly string[],
  ) => Promise<RuntimeBackend>
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  /** What the connection's GitHub sign-in is made of: its credential store, network and name. */
  readonly github: {
    readonly secrets: SecretStore
    readonly fetch: typeof globalThis.fetch
    /** `muse-spark-code/<version>`, as the REST client sends it. */
    readonly userAgent: string
  }
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
function backendKind(settings: ExtensionSettings): AcpBackendKind {
  return settings.backend === 'auto' ? ACP_DEFAULT_BACKEND : settings.backend
}

function serveOptions(
  settings: ExtensionSettings,
  isTrusted: () => boolean,
  isVerbose: boolean,
  paidFeatures: readonly AcpPaidFeature[],
): ServeOptions {
  return {
    backend: backendKind(settings),
    get trustWorkspace() {
      return isTrusted()
    },
    museBinary: settings.museBinaryPath,
    shellSandbox: settings.shellSandbox,
    canBypass: settings.allowDangerouslySkipPermissions,
    // The person confirms a contributor-tier model in the panel before it is used.
    allowsContributorModels: true,
    paidFeatures,
    isVerbose,
    questionsDeferAfterSeconds: settings['questions.deferAfterSeconds'],
    autoCompaction: paidFeatures.includes('autoCompaction'),
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
  /** The files the editor holds with unsaved changes, as the editor shows them and as the disk resolves them. */
  const unsavedPaths = (): readonly string[] => {
    const found: string[] = []
    for (const document of openDocuments()) {
      if (!document.dirty) continue
      let display: string
      try {
        display = fileURLToPath(document.uri, { windows: process.platform === 'win32' })
      } catch (error: unknown) {
        // NARROW: a document that is not a file on this machine holds no file of ours.
        if (error instanceof TypeError) continue
        throw error
      }
      found.push(display)
      try {
        const resolved = realpathSync.native(display)
        if (resolved !== display) found.push(resolved)
      } catch (error: unknown) {
        // NARROW: a file that does not exist yet has no other name.
        if (!isMissingPath(error)) throw error
      }
    }
    return found
  }
  /** Conversations that took another session and have no surface for it yet. */
  const awaitingSurface = new WeakSet<RuntimeConversation>()
  let settings: ExtensionSettings | undefined
  let configured: ReadonlySet<string> = new Set()
  let flaggedAtBuild: readonly AcpPaidFeature[] = []
  let isKeyStored = false
  let isTrusted = false
  let git: PanelGit | undefined
  let isGhLoginAllowed = false
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

  const openGit = panelGitLoader({
    bundlePath: path.join(deps.distDir, NATIVE_GIT_BUNDLE_FILE),
    log,
  })
  /** One opening at a time: every conversation of the connection shares one GitHub sign-in. */
  let opening: Promise<void> | undefined
  /** The connection's Git: made once the editor can be asked, and again for a conversation if the workspace has since become a repository or been trusted. */
  function ensureGit(): Promise<void> {
    if (git?.isAvailable === true || ending.signal.aborted) return Promise.resolve()
    opening ??= (async () => {
      try {
        git = await openGit().openPanelGit(
          {
            host: connection,
            workspaceRoot: workspace,
            runGit: deps.runGit,
            isTrusted: () => isTrusted,
            ...deps.github,
            useGhLogin: () => isGhLoginAllowed,
            links: {
              read: async () =>
                await store.getStorage(WORKSPACE_STATE_KEYS.pullRequestLinks, 'workspace'),
              write: async (value) => {
                await store.setStorage(
                  WORKSPACE_STATE_KEYS.pullRequestLinks,
                  jsonValueSchema.parse(value),
                  'workspace',
                )
              },
            },
            dataFolder: deps.dataFolder,
            signal: ending.signal,
            log,
          },
          deps.table,
          deps.locale,
        )
      } catch (error: unknown) {
        // REPORTED: a workspace whose Git could not be opened has none; the log has the cause.
        log.warn(`The panel's Git could not be opened: ${failureForLog(error)}`)
      } finally {
        opening = undefined
      }
    })()
    return opening
  }

  const currentSettings = (): ExtensionSettings => {
    if (settings === undefined) throw new Error('MHP_NOT_INITIALIZED')
    return settings
  }

  const paid = createRuntimePaid(
    {
      host: connection,
      store,
      settings: currentSettings,
      configured: () => configured,
      backend: () => runtime?.backend.kind ?? backendKind(currentSettings()),
      paidUse: () => runtime?.paid,
      workspaceRoot: workspace,
      dailyBudgetUsd: () => runtimeDailyBudgetUsd(deps.dataFolder),
      isKeyStored: () => isKeyStored,
      log,
    },
    {
      isCurrent: (sessionId) => {
        const held = registry.heldOrAdopting(sessionId)
        return held !== undefined && !held.isReleased
      },
      signalFor: (sessionId) => registry.heldOrAdopting(sessionId)?.signal,
    },
  )
  const outputs = createRuntimeDocuments({
    host: connection,
    dataFolder: deps.dataFolder,
    signal: ending.signal,
  })
  const publishPaid = () => {
    for (const held of registry.controllers()) held.publishPaidState()
  }
  paid.gate.onDidChange(publishPaid)
  paid.usage.onDidChange(publishPaid)

  /** Asks the editor for a surface of `kind` bound to the session; a chat opens beside the editor, a tasks page in a tab. */
  async function requestSurface(kind: 'chat' | 'tasks', sessionId: string): Promise<void> {
    if (!connection.offers('surfaces')) {
      log.warn('MHP_SURFACES_NOT_OFFERED')
      return
    }
    await connection.request(
      'surfaces/open',
      { kind, placement: kind === 'chat' ? 'side' : 'tab', sessionId },
      ending.signal,
    )
  }

  async function openSurface(sessionId: string): Promise<void> {
    await requestSurface('chat', sessionId)
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
      paidState: () => paid.state(),
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
            paid,
            controllers: () => controllersOf(registry.controllers()),
            runGit: deps.runGit,
            git: () => git,
            openDocument: async (title, content) => {
              await outputs.open(title, content)
            },
            paidChanged: publishPaid,
            distDir: deps.distDir,
            dataFolder: deps.dataFolder,
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
      surfaces: {
        idsOf: (sessionId, kind) => connection.surfaces.idsOf(sessionId, kind),
        open: async (sessionId, kind) => {
          await requestSurface(kind, sessionId)
        },
        focus: async (surfaceId) => {
          await connection.request('surfaces/focus', { surfaceId }, ending.signal)
        },
      },
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
    await ensureGit()
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
    const flagged = paid.flagged()
    const options = serveOptions(currentSettings(), () => isTrusted, deps.isVerbose, flagged)
    const created = await deps.createRuntime(options, questionStore, unsavedPaths)
    runtime = created
    flaggedAtBuild = flagged
    // The backend asks the editor before every paid use; until it is attached every use is denied.
    created.paid.attach(paid.ask)
    await created.forgetUnflaggedGrants()
    const readiness = await created.backend.readiness(false)
    isKeyStored = created.backend.kind === 'modelApi' && readiness.state === 'ready'
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
    configured = await store.configuredSettings()
    isGhLoginAllowed = (await store.getSetting('museSpark.github.useGhLogin')) === true
    for (const held of registry.controllers()) {
      held.publishSettings(toSettingsSnapshot(next))
      if (!next.allowDangerouslySkipPermissions) await held.controller?.revokeBypass()
    }
    if (keys.length > 0 && connection.offers('settings'))
      connection.notify('settings/didChange', { keys: [...keys] })
    // A setting found on without an accepted price asks for it (D30); the features now on are the backend's flags.
    await paid.gate.review()
    const flagged = paid.flagged()
    if (
      (previous !== undefined && isReconfiguring(previous, next)) ||
      flagged.join(',') !== flaggedAtBuild.join(',')
    )
      await replaceBackend()
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
      configured = await store.configuredSettings()
      isGhLoginAllowed = (await store.getSetting('museSpark.github.useGhLogin')) === true
      await paid.load()
      stopSettings = store.onSettingsChanged((keys) => {
        applySettings(keys)
      })
      signal.throwIfAborted()
      await createBackend()
      signal.throwIfAborted()
    },
    initialized: () => {
      // A paid setting found on without its price accepted asks for it once, in the editor (D30).
      void paid.gate.review().catch((error: unknown) => {
        // REPORTED: a price that could not be asked is logged; the feature stays as it was.
        log.warn(`Paid features could not be reviewed: ${failureForLog(error)}`)
      })
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
        git?.dispose()
        await outputs.dispose()
        await registry.releaseEvery()
        await runtime?.close()
      })()
      return stopped
    },
  }
}
