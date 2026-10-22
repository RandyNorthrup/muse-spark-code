import { paidConsentChoices } from '../../shared/portablePaid'
import { verifiedPaidQuestion } from '../../shared/portablePaid'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { ACP_PAID_OPTIONS } from '../../shared/constants'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type {
  RuntimeBackendExtensions,
  RuntimePanelBackendContext,
  RuntimeBackendConfiguration,
} from './backendEntry'
import type { RuntimeFactoryOptions } from './defaultFactories'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { RuntimeSettingsStore } from '../settingsStore'
import { startCompanionServer } from '../companion/server'
import {
  MHP,
  MHP_ERROR_CODES,
  MHP_PANEL,
  RUNTIME_PANEL,
  SETTINGS_SECTION,
  RUNTIME_PANEL_PORTS_BUNDLE_FILE,
  RUNTIME_BACKEND_SERVICES_BUNDLE_FILE,
  RUNTIME_ENGINES_BUNDLE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { MHP_METHODS, type MhpParams } from '../../shared/hostApi/methods'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
  panelEventId,
  panelLifecycleSchema,
  type MhpPanelBinding,
} from '../../shared/hostApi/panel'
import type { ConversationController } from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import { approvalModeFor } from '../../shared/permissionModes'
import { PanelConnection, MhpServiceError } from './connection'
import { ControllerRegistry } from './controllerRegistry'
import { PanelSurfaces } from './surfaces'
import { PanelDelivery } from './delivery'
import { RuntimeConversation } from './runtimeController'
import type { LoadedSession } from '../../core/agent/agentBackend'
import type { ExtensionSettings } from '../../host/settings'
import type { UiTable } from '../../host/l10n'
import type {
  RuntimeFeatureFactories,
  RuntimeSelectedModel,
  runtimeSettings,
} from './runtimeFeatures'
import { panelPortsLoader, backendLoader, engineLoader } from './panelLoader'
import { setUiText, uiLocale } from '../../shared/l10n/text'
import * as z from 'zod/mini'
import { portablePage } from './portablePage'
import { PanelUiRequests } from './uiRequests'
import {
  fallbackUiCallSchema,
  fallbackUiMethodSchema,
  fallbackUiReplySchema,
} from '../../shared/hostApi/fallbackUi'
import { parseMhpResult } from '../../shared/hostApi/protocol'

export interface RunPanelDeps {
  readonly options: ServeOptions
  readonly factories?: RuntimeFeatureFactories
  readonly portable?: Pick<
    RuntimeFactoryOptions,
    'version' | 'hasStoredKey' | 'engineOptions' | 'presentationOptions' | 'pages'
  > &
    Pick<RuntimePanelBackendContext, 'env' | 'homeDir' | 'platform'>
  readonly backendConfiguration?: (
    context: RuntimePanelBackendContext,
  ) => RuntimeBackendConfiguration
  readonly backendExtensions?: (context: RuntimePanelBackendContext) => RuntimeBackendExtensions
  readonly modelCapabilities?: (
    runtime: RuntimeBackend,
    modelId: string,
  ) => Promise<RuntimeSelectedModel>
  readonly configureRuntime?: (
    options: ServeOptions,
    settings: ExtensionSettings,
    root: string,
    extensions?: RuntimeBackendExtensions,
  ) => Promise<RuntimeBackend>
  readonly loadLanguage?: (locale: string) => Promise<UiTable>
  readonly transport: 'stdio' | 'companion'
  readonly runtime: RuntimeBackend
  readonly dataRoot: string
  readonly conversationBundle: string
  readonly defaultCwd: string
  readonly input: Readable
  readonly output: Writable
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly log: Logger
}

function unsupported(): never {
  throw new MhpServiceError({
    jsonrpc: MHP.jsonRpcVersion,
    id: null,
    error: { code: MHP_ERROR_CODES.unsupportedCapability, message: 'MHP_UNSUPPORTED_CAPABILITY' },
  })
}

/**
Companion closes have one serialized owner. Retire every page of a
replaced session here, while the registry still holds it, and hand each
surface to its feature owner so release-time cleanup finds nothing
orphaned to close past conversation cancellation.
*/
export function retireCompanionPages(
  pages: Map<string, { binding: MhpPanelBinding; html?: string; nonce?: string }>,
  retireContext: ((id: string) => void) | undefined,
  closed: Set<(id: string) => void>,
  sessionId: string,
): void {
  for (const [id, page] of pages)
    if (page.binding.sessionId === sessionId) {
      retireContext?.(id)
      pages.delete(id)
      for (const listener of closed) listener(page.binding.surface)
    }
}

/** Native carriers use stdout; companion browser traffic is bound to an authenticated window. */
export async function runPanel(deps: RunPanelDeps): Promise<number> {
  const { log, input, output } = deps
  let profileGeneration = 0
  let runtime = deps.runtime
  let isTrusted = deps.options.trustWorkspace
  let options = deps.options
  let transactions: Promise<void> = Promise.resolve()
  let applyingSettings: Promise<void> = Promise.resolve()
  let opening: Promise<void> = Promise.resolve()
  const ownedSettings = new Set<Awaited<ReturnType<typeof runtimeSettings>>>()
  const conversationSettings = new WeakMap<
    RuntimeConversation,
    Awaited<ReturnType<typeof runtimeSettings>>
  >()
  const publishedSettings = new WeakMap<RuntimeConversation, string>()
  const roots = new WeakMap<RuntimeConversation, string>()
  const sides = new WeakSet<RuntimeConversation>()
  const surfaceClosed = new Set<(id: string) => void>()
  const paidOwners = new Map<string, RuntimeConversation>()
  const selectedModels = new Map<string, RuntimeSelectedModel>()
  const workspaceSettings = new Map<string, Awaited<ReturnType<typeof runtimeSettings>>>()
  const registry = new ControllerRegistry<RuntimeConversation>(log)
  const browsers = new Map<
    string,
    {
      readonly delivery: PanelDelivery
      readonly surfaces: PanelSurfaces
      readonly ui: PanelUiRequests
    }
  >()
  let store: RuntimeSettingsStore | undefined
  let settings: Awaited<ReturnType<typeof runtimeSettings>> | undefined
  let root = ''
  let conversation: RuntimeConversation | undefined
  let selection: MhpParams<'editor/didChangeSelection'>['selection'] = null
  let snapshotBytes = 0
  let selectionBytes = 0
  const documents = new Map<string, MhpParams<'documents/didChange'>['document']>()
  const documentBytes = new Map<string, number>()
  const companionPages = new Map<
    string,
    { binding: MhpPanelBinding; html?: string; nonce?: string }
  >()
  const deferredOpen = new Set<ReturnType<typeof setImmediate>>()
  let companion: Awaited<ReturnType<typeof startCompanionServer>> | undefined
  let theme: MhpParams<'initialize'>['theme'] | undefined
  let exitCode = 0
  const ending = new AbortController()
  const closed = new Promise<void>((resolve) => {
    ending.signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  const lookup = (binding: MhpPanelBinding) =>
    binding.surfaceKind === 'chat'
      ? registry.held(binding.sessionId)
      : registry.held(binding.sessionId)?.view(binding)
  const peer = new PanelConnection(
    {
      capabilities: ['lifecycle', 'settings', 'storage'],
      initialize: async (params, signal) => {
        theme = params.theme
        signal.throwIfAborted()
        isTrusted = params.trusted && deps.options.trustWorkspace
        const folder = params.folders[0]
        root = await realpath(folder === undefined ? deps.defaultCwd : fileURLToPath(folder.uri))
        if (root !== (await realpath(deps.defaultCwd)))
          throw new Error('MHP_WORKSPACE_BINDING_MISMATCH')
        store = new RuntimeSettingsStore(deps.dataRoot, root)
        const features = panelPortsLoader({
          bundlePath: path.join(
            path.dirname(deps.conversationBundle),
            RUNTIME_PANEL_PORTS_BUNDLE_FILE,
          ),
          log,
        })().createRuntimePanelPorts(UI_TEXT, uiLocale())
        settings = await features.runtimeSettings(store, log)
        ownedSettings.add(settings)
        signal.throwIfAborted()
        if (deps.loadLanguage !== undefined) {
          const language = await deps.loadLanguage(params.locale)
          setUiText(language.table, language.locale)
        }
        signal.throwIfAborted()
        await configure()
        signal.throwIfAborted()
        conversation = await startConversation(root)
        settings.onChanged((keys) => {
          applySettings(() => settingsChanged(keys))
        })
      },
      surfaceClosed: (binding) => {
        for (const listener of surfaceClosed) listener(binding.surface)
      },
      initialized: () => {
        opening = (async () => {
          try {
            await openInitialSurface()
          } catch {
            log.error('MHP_PANEL_OPEN_FAILED')
            exitCode = 1
            peer.close()
          }
        })()
      },
      request: async (method, value, signal) => {
        signal.throwIfAborted()
        const capability = MHP_METHODS[method].capability
        if (capability === 'settings' || capability === 'storage') {
          const result = await requestState(method, value, requireStore(), requireSettings())
          if (method === 'settings/update') {
            try {
              await applyingSettings
            } catch {
              throw new MhpServiceError({
                jsonrpc: MHP.jsonRpcVersion,
                id: null,
                error: {
                  code: MHP_ERROR_CODES.internalError,
                  message: 'MHP_RUNTIME_CONFIGURATION_FAILED',
                },
              })
            }
          }
          return result
        }
        switch (method) {
          case 'workspace/folders': {
            return [{ uri: pathToFileURL(root).href, name: path.basename(root) }]
          }
          case 'workspace/trust': {
            return { trusted: isTrusted }
          }
          case 'ui/notify': {
            return await browserUi(method, value, signal)
          }
          default: {
            const ui = fallbackUiMethodSchema.safeParse(method)
            return ui.success ? await browserUi(ui.data, value, signal) : unsupported()
          }
        }
      },
      notify: (method, value) => {
        switch (method) {
          case 'workspace/didChangeTrust':
          case 'workspace/didGrantTrust': {
            const isNextTrusted =
              MHP_METHODS[method].params.parse(value).trusted && deps.options.trustWorkspace
            if (isNextTrusted === isTrusted) break
            isTrusted = isNextTrusted
            const stopping = [...registry.controllers()].map(async (held) => {
              await held.controller?.backendStopping(true)
            })
            void transact(async () => {
              await Promise.all(stopping)
              await replaceProfile()
            }).catch(() => {
              if (ending.signal.aborted) {
                return
              }

              log.error('MHP_TRUST_APPLY_FAILED')
              peer.close(true)
            })
            break
          }
          case 'settings/didChange': {
            MHP_METHODS[method].params.parse(value)
            void transact(async () => {
              await requireSettings().refresh()
              await settingsChanged([])
            }).catch(() => {
              if (!ending.signal.aborted) log.warn('MHP_SETTINGS_APPLY_FAILED')
            })
            break
          }
          case 'editor/didChangeSelection': {
            const next = MHP_METHODS[method].params.parse(value).selection
            const bytes = Buffer.byteLength(JSON.stringify(next))
            if (!didReplaceSnapshot(bytes, selectionBytes)) return
            selectionBytes = bytes
            selection = next
            break
          }
          case 'documents/didChange': {
            const params = MHP_METHODS[method].params.parse(value)
            retainDocument(params.document)
            break
          }
          case 'documents/didSave': {
            const params = MHP_METHODS[method].params.parse(value)
            retainDocument(params)
            break
          }
          case 'documents/didClose': {
            const params = MHP_METHODS[method].params.parse(value)
            documents.delete(params.uri)
            snapshotBytes -= documentBytes.get(params.uri) ?? 0
            documentBytes.delete(params.uri)
            break
          }
          default: {
            log.warn('MHP_NOTIFICATION_UNSUPPORTED')
          }
        }
      },
      view: lookup,
      closed: (isFatal) => {
        if (isFatal) exitCode = 1
        ending.abort()
      },
    },
    log,
  )

  async function requestState(
    method: string,
    value: unknown,
    currentStore: RuntimeSettingsStore,
    currentSettings: Awaited<ReturnType<typeof runtimeSettings>>,
  ): Promise<unknown> {
    switch (method) {
      case 'settings/get': {
        const params = MHP_METHODS[method].params.parse(value)
        return { value: await currentStore.getSetting(params.key) }
      }
      case 'settings/update': {
        const params = MHP_METHODS[method].params.parse(value)
        await currentStore.updateSetting(params.key, params.value, params.scope)
        await currentSettings.settled()
        return null
      }
      case 'storage/global.get':
      case 'storage/workspace.get': {
        const params = MHP_METHODS[method].params.parse(value)
        return {
          value: await currentStore.getStorage(
            params.key,
            method === 'storage/global.get' ? 'user' : 'workspace',
          ),
        }
      }
      case 'storage/global.set':
      case 'storage/workspace.set': {
        const params = MHP_METHODS[method].params.parse(value)
        await currentStore.setStorage(
          params.key,
          params.value,
          method === 'storage/global.set' ? 'user' : 'workspace',
        )
        return null
      }
      default: {
        return unsupported()
      }
    }
  }

  function transact(work: () => Promise<void>): Promise<void> {
    const previous = transactions
    const next = (async () => {
      await previous
      ending.signal.throwIfAborted()
      await work()
    })()
    transactions = (async () => {
      try {
        await next
      } catch {
        /* The caller reports its failure. */
      }
    })()
    return next
  }
  async function configure(): Promise<void> {
    const current = requireSettings().current()
    options = {
      ...deps.options,
      backend: current.backend === 'auto' ? deps.options.backend : current.backend,
      museBinary: current.museBinaryPath || deps.options.museBinary,
      shellSandbox: (await requireStore().hasSetting(`${SETTINGS_SECTION}.shellSandbox`))
        ? current.shellSandbox
        : deps.options.shellSandbox,
      get trustWorkspace() {
        return isTrusted
      },
    }
    if (deps.configureRuntime === undefined) {
      if (options.backend !== runtime.backend.kind || isTrusted !== deps.options.trustWorkspace)
        throw new Error('MHP_RUNTIME_CONFIGURATION_UNAVAILABLE')
      return
    }
    const generation = ++profileGeneration
    await runtime.close()
    ending.signal.throwIfAborted()
    const owner = new AbortController()
    ending.signal.addEventListener(
      'abort',
      () => {
        owner.abort()
      },
      { once: true },
    )
    const context: RuntimePanelBackendContext | undefined =
      deps.portable === undefined
        ? undefined
        : {
            host: peer,
            dataRoot: deps.dataRoot,
            distDir: path.dirname(deps.conversationBundle),
            platform: deps.portable.platform,
            env: deps.portable.env,
            homeDir: deps.portable.homeDir,
            settings: (workspaceRoot) => {
              if (workspaceRoot === root) return requireSettings().current()
              const prepared = workspaceSettings.get(workspaceRoot)
              if (prepared !== undefined) return prepared.current()
              for (const held of registry.controllers())
                if (roots.get(held) === workspaceRoot)
                  return conversationSettings.get(held)?.current() ?? unsupported()
              return unsupported()
            },
            trusted: () => isTrusted,
            documents: () => {
              const snapshot: MhpParams<'documents/didChange'>['document'][] = []
              documents.forEach((document) => {
                snapshot.push(document)
              })
              return snapshot
            },
            selectedModel: (workspaceRoot) => {
              const record = selectedModels.get(workspaceRoot)
              if (record === undefined) return
              for (const held of registry.controllers())
                if (roots.get(held) === workspaceRoot && record.modelId !== held.modelId) return
              return record
            },
            assertCurrent: () => {
              owner.signal.throwIfAborted()
              if (generation !== profileGeneration) throw new Error('MHP_RUNTIME_PROFILE_RETIRED')
            },
            onCheckpointAvailabilityChanged: () => {
              for (const held of registry.controllers())
                held.controller?.checkpointAvailabilityChanged()
            },
            log,
          }
    const configuration = context === undefined ? undefined : deps.backendConfiguration?.(context)
    const configured =
      configuration === undefined || context === undefined
        ? undefined
        : backendLoader({
            bundlePath: path.join(context.distDir, RUNTIME_BACKEND_SERVICES_BUNDLE_FILE),
            log,
          })().createConfiguredPanelBackend(configuration, UI_TEXT, uiLocale())
    const extensions =
      context === undefined
        ? undefined
        : {
            ...backendLoader({
              bundlePath: path.join(context.distDir, RUNTIME_BACKEND_SERVICES_BUNDLE_FILE),
              log,
            })().createPanelBackendOptions(context, UI_TEXT, uiLocale()),
            ...configured?.extensions,
            ...deps.backendExtensions?.(context),
          }
    try {
      runtime = await deps.configureRuntime(options, current, root, extensions)
    } catch (error: unknown) {
      await configured?.disposeAfterBackend()
      throw error
    }
    if (configured !== undefined) {
      const backend = runtime
      let closing: Promise<void> | undefined
      runtime = {
        ...backend,
        close: () => {
          closing ??= (async () => {
            try {
              await backend.close()
            } finally {
              await configured.disposeAfterBackend()
            }
          })()
          return closing
        },
      }
    }
    ending.signal.throwIfAborted()
    await runtime.forgetUnflaggedGrants()
    runtime.paid.attach(async (ownerId, request, canRemember) => {
      // The standalone panel needs a verified quote and the configured hard ledger before any consent.
      if (deps.portable !== undefined && configured?.quote === undefined) return 'deny'
      const held = registry.held(ownerId) ?? paidOwners.get(ownerId)
      if (held === undefined || held.isReleased || registry.held(held.sessionId) !== held)
        return 'deny'
      const workspaceRoot = roots.get(held)
      const settings = conversationSettings.get(held)
      if (workspaceRoot === undefined || settings === undefined) return 'deny'
      const budget = settings.current().paidDailyBudgetUsd
      const question =
        configured?.quote === undefined
          ? {
              ...(await panelPortsLoader({
                bundlePath: path.join(
                  path.dirname(deps.conversationBundle),
                  RUNTIME_PANEL_PORTS_BUNDLE_FILE,
                ),
                log,
              })()
                .createRuntimePanelPorts(UI_TEXT, uiLocale())
                .paidUseQuestion(request)),
              isCurrent: () => generation === profileGeneration,
            }
          : verifiedPaidQuestion(
              request,
              configured.quote(workspaceRoot, held.sessionId, request),
              budget,
            )
      if (!question?.isCurrent()) return 'deny'
      const signal = AbortSignal.any([owner.signal, held.signal])
      const params = {
        title: question.title,
        message: `${question.detail}\n\n${fill(UI_TEXT.paidDailyBudgetLine, { budget: formatUsd(budget, 2) })}`,
        choices: paidConsentChoices(canRemember),
      }
      const answer =
        deps.transport === 'companion'
          ? await browserUi('ui/confirm', params, signal)
          : await peer.request('ui/confirm', params, signal)
      signal.throwIfAborted()
      if (
        generation !== profileGeneration ||
        !question.isCurrent() ||
        registry.held(held.sessionId) !== held
      )
        return 'deny'
      if (answer === ACP_PAID_OPTIONS.allowOnce) return 'once'
      return canRemember && answer === ACP_PAID_OPTIONS.allowAlways ? 'always' : 'deny'
    })
  }
  async function settingsChanged(keys: readonly string[]): Promise<void> {
    for (const held of registry.controllers()) await publishHeldSettings(held)
    if (keys.length > 0) peer.notify('settings/didChange', { keys: [...keys] })
    if (keys.length === 0 || keys.some((key) => RUNTIME_PANEL.reconfigureSettings.includes(key)))
      await replaceProfile()
  }
  function applySettings(work: () => Promise<void>): void {
    applyingSettings = transact(work)
    void applyingSettings.catch(() => {
      if (!ending.signal.aborted) log.warn('MHP_SETTINGS_APPLY_FAILED')
    })
  }
  async function publishHeldSettings(held: RuntimeConversation): Promise<void> {
    const ownSettings = conversationSettings.get(held)
    if (ownSettings === undefined || held.isReleased) return
    await ownSettings.settled()
    const current = ownSettings.current()
    const snapshot = JSON.stringify(current)
    if (publishedSettings.get(held) === snapshot) return
    held.publishSettings(current)
    publishedSettings.set(held, snapshot)
    if (!current.allowDangerouslySkipPermissions) await held.controller?.revokeBypass()
  }
  async function retire(sessionId: string): Promise<void> {
    const retired = peer.surfaces.retireSession(sessionId)
    for (const [id, owner] of browsers) {
      if (owner.surfaces.retireSession(sessionId).length === 0) continue
      owner.surfaces.close()
      owner.ui.close()
      owner.delivery.close()
      browsers.delete(id)
    }
    companion?.retireContext(sessionId)
    const owner = companion
    retireCompanionPages(
      companionPages,
      owner === undefined
        ? undefined
        : (id) => {
            owner.retireContext(id)
          },
      surfaceClosed,
      sessionId,
    )
    if (deps.transport === 'stdio')
      for (const binding of retired)
        await peer.request('surfaces/close', { surfaceId: binding.surface }, ending.signal)
  }
  async function replaceProfile(): Promise<void> {
    const previous = [...registry.controllers()].map((held) => ({
      held,
      root: roots.get(held) ?? root,
      kind: held.host.info.kind,
      sessionId: held.sessionId,
      isSideChat: sides.has(held),
    }))
    for (const item of previous) {
      await retire(item.sessionId)
      await registry.closeSession(item.sessionId)
    }
    await configure()
    if (previous.length === 0) {
      conversation = await startConversation(root)
      await openSurface(conversation.sessionId)
      return
    }
    for (const item of previous) {
      const next = await startConversation(
        item.root,
        item.kind === runtime.backend.kind ? item.sessionId : undefined,
        item.isSideChat,
      )
      if (conversation === item.held) conversation = next
      await openSurface(next.sessionId)
    }
  }
  async function startConversation(
    workspaceRoot: string,
    sessionId?: string,
    isSideChat = false,
  ): Promise<RuntimeConversation> {
    ending.signal.throwIfAborted()
    const features = panelPortsLoader({
      bundlePath: path.join(path.dirname(deps.conversationBundle), RUNTIME_PANEL_PORTS_BUNDLE_FILE),
      log,
    })().createRuntimePanelPorts(UI_TEXT, uiLocale())
    const contextStore =
      workspaceRoot === root
        ? requireStore()
        : new RuntimeSettingsStore(deps.dataRoot, workspaceRoot)
    const contextSettings =
      workspaceRoot === root ? requireSettings() : await features.runtimeSettings(contextStore, log)
    ownedSettings.add(contextSettings)
    workspaceSettings.set(workspaceRoot, contextSettings)
    const owningRuntime = runtime
    const readiness = await owningRuntime.backend.readiness(false)
    if (readiness.state !== 'ready') throw new Error(readiness.message)
    const host = await owningRuntime.backend.hostFor(workspaceRoot)
    ending.signal.throwIfAborted()
    registry.watch(host)
    const models = await host.listModels(sessionId)
    ending.signal.throwIfAborted()
    const model =
      models.find((candidate) => candidate.isActive) ??
      models.find((candidate) => candidate.isDefault) ??
      models[0]
    if (model === undefined) throw new Error(UI_TEXT.acpNoModels)
    let loaded: LoadedSession
    if (sessionId === undefined) {
      const started = await host.startSession({
        workspaceRoot,
        modelId: model.modelId,
        approvalMode: approvalModeFor(
          contextSettings.current().initialPermissionMode === 'bypassPermissions' &&
            !options.canBypass
            ? 'manual'
            : contextSettings.current().initialPermissionMode,
          true,
        ),
      })
      try {
        loaded = await host.resumeSession(started.sessionId, model.modelId)
      } finally {
        started.dispose()
      }
    } else {
      loaded = await host.resumeSession(sessionId, model.modelId)
    }
    if (ending.signal.aborted) {
      loaded.session.dispose()
      ending.signal.throwIfAborted()
    }
    const claim = registry.claimSession(loaded.session.sessionId)
    const adopted = await registry.adopt(
      host,
      loaded.session,
      claim,
      () =>
        new RuntimeConversation(loaded.session, host, log, () => {
          exitCode = 1
          peer.close()
        }),
      (controller) => {
        let factories = deps.factories
        if (factories === undefined && deps.portable !== undefined) {
          factories = engineLoader({
            bundlePath: path.join(
              path.dirname(deps.conversationBundle),
              RUNTIME_ENGINES_BUNDLE_FILE,
            ),
            log,
          })().createRuntimeFactories({
            ...deps.portable,
            distDir: path.dirname(deps.conversationBundle),
            dataRoot: deps.dataRoot,
            prepareHtml: async (binding, html, nonce) => {
              if (theme === undefined) return unsupported()
              const assets = await portablePage(
                path.join(path.dirname(deps.conversationBundle), 'webview', 'portable'),
                theme,
              )
              return assets.decorate(
                binding,
                html,
                nonce,
                deps.transport === 'companion' ? 'companion' : 'native',
              )
            },
            onSurfaceClosed: (listener) => {
              surfaceClosed.add(listener)
              return () => {
                surfaceClosed.delete(listener)
              }
            },
          })
        }
        paidOwners.set(controller.sessionId, controller)
        return controller.prepare(
          {
            host: {
              async request(method, params, signal) {
                // Cleanup outlives conversation cancellation, but never the carrier.
                const ownerSignal = method === 'surfaces/close' ? ending.signal : controller.signal
                signal = signal === undefined ? ownerSignal : AbortSignal.any([signal, ownerSignal])
                signal.throwIfAborted()
                const capability = MHP_METHODS[method].capability
                if (capability === 'settings' || capability === 'storage') {
                  if (method === 'settings/update' && workspaceRoot !== root) {
                    const update = MHP_METHODS['settings/update'].params.parse(params)
                    if (
                      update.scope === 'workspace' &&
                      RUNTIME_PANEL.reconfigureSettings.includes(update.key)
                    )
                      throw new Error('MHP_WORKSPACE_PROFILE_UNAVAILABLE')
                  }
                  const result = await requestState(method, params, contextStore, contextSettings)
                  return parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: 1, result })
                    .result
                }
                if (deps.transport === 'companion' && MHP_METHODS[method].capability === 'surfaces')
                  return parseMhpResult(method, {
                    jsonrpc: MHP.jsonRpcVersion,
                    id: 1,
                    result: await companionSurface(method, params, controller.sessionId, signal),
                  }).result
                const ui = fallbackUiMethodSchema.safeParse(method)
                if (deps.transport === 'companion' && ui.success)
                  return parseMhpResult(method, {
                    jsonrpc: MHP.jsonRpcVersion,
                    id: 1,
                    result: await browserUi(ui.data, params, signal),
                  }).result
                return await peer.request(method, params, signal)
              },
              notify: (method, params) => {
                peer.notify(method, params)
              },
            },
            runtime: owningRuntime,
            options,
            store: contextStore,
            settings: contextSettings,
            workspaceRoot,
            isSideChat,
            ownsPaidConsent: false,
            controllers: () => allControllers(),
            runGit: deps.runGit,
            selection: () => selection,
            documents: () => {
              const snapshot: MhpParams<'documents/didChange'>['document'][] = []
              documents.forEach((document) => {
                snapshot.push(document)
              })
              return snapshot
            },
            sessionChanged: async (previousId, sessionId) => {
              registry.rebind(previousId, sessionId, controller)
              await retire(previousId)
              await openSurface(sessionId)
            },
            ...(factories !== undefined && { factories }),
            ...(deps.modelCapabilities !== undefined && {
              selectedModel: async () => {
                const modelId = controller.modelId
                const record = await deps.modelCapabilities?.(owningRuntime, modelId)
                if (record?.modelId !== controller.modelId)
                  throw new Error('MHP_MODEL_SELECTION_CHANGED')
                selectedModels.set(workspaceRoot, record)
                return record
              },
            }),
            openWorkspace: async (nextRoot) => {
              const target = await realpath(nextRoot)
              if (!isTrusted) throw new Error('MHP_WORKSPACE_UNTRUSTED')
              const next = await startConversation(target)
              await openSurface(next.sessionId)
            },
            openSideChat: (sessionId) => {
              void transact(async () => {
                const next = await startConversation(workspaceRoot, sessionId, true)
                await openSurface(next.sessionId)
              }).catch(() => {
                if (!ending.signal.aborted) {
                  log.warn('MHP_SIDE_CHAT_OPEN_FAILED')
                }
              })
            },
            log,
          },
          loaded,
          deps.conversationBundle,
          features.runtimeConversationDeps,
        )
      },
    )
    roots.set(adopted, workspaceRoot)
    conversationSettings.set(adopted, contextSettings)
    publishedSettings.set(adopted, JSON.stringify(contextSettings.current()))
    if (isSideChat) sides.add(adopted)
    if (workspaceRoot !== root)
      contextSettings.onChanged((keys) => {
        applySettings(async () => {
          for (const held of registry.controllers())
            if (roots.get(held) === workspaceRoot) await publishHeldSettings(held)
          peer.notify('settings/didChange', { keys: [...keys] })
        })
      })
    return adopted
  }

  function requireStore(): RuntimeSettingsStore {
    return store ?? unsupported()
  }
  /** Delivered snapshots persist beyond the queue; give them a separate bounded budget. */
  function didReplaceSnapshot(bytes: number, previous: number): boolean {
    const next = snapshotBytes - previous + bytes
    if (next > MHP_PANEL.maximumQueuedBytes) {
      peer.close(true)
      return false
    }
    snapshotBytes = next
    return true
  }
  function retainDocument(document: MhpParams<'documents/didChange'>['document']): void {
    if (!documents.has(document.uri) && documents.size >= MHP_PANEL.maximumQueuedMessages) {
      peer.close(true)
      return
    }
    const bytes = Buffer.byteLength(JSON.stringify(document))
    if (!didReplaceSnapshot(bytes, documentBytes.get(document.uri) ?? 0)) return
    documents.set(document.uri, document)
    documentBytes.set(document.uri, bytes)
  }
  function requireSettings(): Awaited<ReturnType<typeof runtimeSettings>> {
    return settings ?? unsupported()
  }
  function* allControllers(): Iterable<ConversationController> {
    for (const held of registry.controllers())
      if (held.controller !== undefined) yield held.controller
  }
  function browser(id: string) {
    let found = browsers.get(id)
    if (found === undefined) {
      const delivery = new PanelDelivery()
      const surfaces = new PanelSurfaces(
        delivery,
        lookup,
        log,
        () => {
          exitCode = 1
          peer.close()
        },
        (binding) => {
          for (const listener of surfaceClosed) listener(binding.surface)
        },
      )
      found = { delivery, surfaces, ui: new PanelUiRequests(delivery) }
      browsers.set(id, found)
    }
    return found
  }
  async function browserUi(
    method: z.infer<typeof fallbackUiMethodSchema>,
    value: unknown,
    signal: AbortSignal,
  ) {
    // Until multi-view action ownership is qualified, never ask an arbitrary
    // peer window to approve another view's paid request.
    let owner: ReturnType<typeof browser> | undefined
    for (const active of browsers.values()) {
      if (!active.ui.isConnected) continue
      if (owner !== undefined) return unsupported()
      owner = active
    }
    return owner === undefined
      ? unsupported()
      : await owner.ui.request(method, MHP_METHODS[method].params.parse(value), signal)
  }

  async function companionSurface(
    method: string,
    value: unknown,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted()
    const owner = companion
    if (owner === undefined || registry.held(sessionId) === undefined) return unsupported()
    if (method === 'surfaces/open') {
      const params = MHP_METHODS['surfaces/open'].params.parse(value)
      if (params.sessionId !== sessionId || companionPages.size >= MHP_PANEL.maximumQueuedMessages)
        return unsupported()
      const surface = randomUUID()
      const binding = { surface, sessionId, surfaceKind: params.kind }
      companionPages.set(surface, { binding })
      // Adoption finishes before the next task. HTML surfaces wait for their actual publication.
      if (params.kind !== 'whatsNew') {
        const task = setImmediate(() => {
          deferredOpen.delete(task)
          if (!signal.aborted && companionPages.has(surface))
            void peer
              .request('ui/openExternal', { uri: owner.launchUrl(surface) }, signal)
              .catch(() => {
                owner.retireContext(surface)
                companionPages.delete(surface)
                for (const listener of surfaceClosed) listener(surface)
                log.warn('MHP_PANEL_OPEN_FAILED')
              })
        })
        deferredOpen.add(task)
      }
      return { surfaceId: surface }
    }
    const { surfaceId } = MHP_METHODS['surfaces/close'].params.parse(
      method === 'surfaces/presentHtml'
        ? { surfaceId: MHP_METHODS['surfaces/presentHtml'].params.parse(value).surfaceId }
        : value,
    )
    const page = companionPages.get(String(surfaceId))
    if (page?.binding.sessionId !== sessionId) return unsupported()
    if (method === 'surfaces/presentHtml') {
      const params = MHP_METHODS['surfaces/presentHtml'].params.parse(value)
      if (params.sessionId !== sessionId || page.binding.surfaceKind !== 'whatsNew')
        return unsupported()
      const nonce =
        /<script nonce="([^"<>]+)" src="\/assets\/portable\/loader.js"><\/script>/u.exec(
          params.html,
        )?.[1]
      if (nonce === undefined) return unsupported()
      page.html = params.html
      page.nonce = nonce
      await peer.request('ui/openExternal', { uri: owner.launchUrl(String(surfaceId)) }, signal)
      return null
    }
    if (method === 'surfaces/close') {
      owner.retireContext(String(surfaceId))
      companionPages.delete(String(surfaceId))
      for (const listener of surfaceClosed) listener(String(surfaceId))
      return null
    }
    if (method === 'surfaces/focus') {
      await peer.request('ui/openExternal', { uri: owner.launchUrl(String(surfaceId)) }, signal)
      return null
    }
    return unsupported()
  }

  async function openInitialSurface(): Promise<void> {
    if (conversation === undefined) return unsupported()
    await openSurface(conversation.sessionId)
  }

  async function openSurface(sessionId: string): Promise<void> {
    ending.signal.throwIfAborted()
    if (deps.transport === 'stdio') {
      await peer.request('surfaces/open', {
        kind: 'chat',
        placement: 'side',
        sessionId,
      })
      return
    }
    companionPages.set(sessionId, {
      binding: { surface: randomUUID(), sessionId, surfaceKind: 'chat' },
    })
    if (companion !== undefined) {
      await peer.request('ui/openExternal', { uri: companion.launchUrl(sessionId) })
      return
    }
    if (theme === undefined) return unsupported()
    const page = await portablePage(
      path.join(path.dirname(deps.conversationBundle), 'webview', 'portable'),
      theme,
    )
    companion = await startCompanionServer({
      services: {
        inputSchema: fallbackUiReplySchema,
        outputSchema: fallbackUiCallSchema,
        post: (frame, id, signal) => {
          signal.throwIfAborted()
          browser(id).ui.receive(frame)
          return Promise.resolve()
        },
        subscribe: (id, emit) => browser(id).ui.connect(emit),
      },
      handler: {
        isBindingAllowed: (value, context) => {
          const expected = context === undefined ? undefined : companionPages.get(context)?.binding
          if (expected === undefined) return false
          const lifecycle = panelLifecycleSchema.safeParse(value)
          if (lifecycle.success)
            return (
              lifecycle.data.surface === expected.surface &&
              lifecycle.data.sessionId === expected.sessionId &&
              lifecycle.data.surfaceKind === expected.surfaceKind
            )
          const frame = panelEnvelopeSchema.safeParse(value)
          return frame.success && frame.data.surface === expected.surface
        },
        inputSchema: panelEnvelopeSchema,
        outputSchema: z.union([
          panelEnvelopeSchema.check(z.refine((frame) => frame.direction === 'toPanel')),
          panelErrorSchema,
        ]),
        surfaceSchema: panelLifecycleSchema,
        eventId: panelEventId,
        post: (frame, id, signal) => {
          signal.throwIfAborted()
          browser(id).surfaces.message(frame)
          return Promise.resolve()
        },
        surface: (frame, id, signal) => {
          signal.throwIfAborted()
          browser(id).surfaces.lifecycle(frame)
          return Promise.resolve()
        },
        subscribe: (id, emit) => {
          const owner = browser(id)
          owner.delivery.connect((line, complete) => {
            emit(JSON.parse(line), complete)
            return true
          })
          return () => {
            owner.delivery.connect(undefined)
            owner.surfaces.detach()
          }
        },
      },
      limits: {
        maxBodyBytes: MHP_PANEL.maximumEnvelopeBytes,
        maxEventBytes: MHP_PANEL.maximumQueuedBytes,
        requestTimeoutMs: RUNTIME_PANEL.requestTimeoutMs,
        idleTimeoutMs: RUNTIME_PANEL.idleTimeoutMs,
        launchCodeTtlMs: RUNTIME_PANEL.launchCodeTtlMs,
        sessionTtlMs: RUNTIME_PANEL.sessionTtlMs,
        maxSessions: RUNTIME_PANEL.maximumWindows,
      },
      signal: ending.signal,
      assets: page.assets,
      renderPage: (nonce, context) => {
        const owned = context === undefined ? undefined : companionPages.get(context)
        if (owned === undefined || registry.held(owned.binding.sessionId) === undefined)
          throw new Error('MHP_SESSION_NOT_FOUND')
        return owned.html !== undefined && owned.nonce !== undefined
          ? owned.html
              .replaceAll(`nonce="${owned.nonce}"`, () => `nonce="${nonce}"`)
              .replaceAll(`nonce-${owned.nonce}`, () => `nonce-${nonce}`)
          : page.render(owned.binding, nonce)
      },
    })
    void companion.closed.then(() => {
      peer.close()
    })
    await peer.request('ui/openExternal', { uri: companion.launchUrl(sessionId) })
  }

  let capacity = Buffer.alloc(0)
  let buffer = capacity
  let isReading = false
  const pump = () => {
    if (isReading) return
    isReading = true
    try {
      while (
        peer.delivery.totals.messages < MHP_PANEL.maximumQueuedMessages &&
        peer.delivery.totals.bytes < MHP_PANEL.maximumQueuedBytes
      ) {
        const newline = buffer.indexOf('\n')
        if (newline === -1) break
        const frame = buffer.subarray(0, newline)
        buffer = buffer.subarray(newline + 1)
        if (frame.length > MHP_PANEL.maximumEnvelopeBytes + 1) {
          exitCode = 1
          peer.close()
          return
        }
        try {
          peer.receive(new TextDecoder('utf-8', { fatal: true }).decode(frame))
        } catch {
          log.warn('MHP_INVALID_UTF8')
          exitCode = 1
          peer.close()
          return
        }
      }
      if (buffer.length > MHP_PANEL.maximumEnvelopeBytes + 1) {
        log.warn('MHP_PANEL_TOO_LARGE')
        exitCode = 1
        peer.close()
        return
      }
      if (
        peer.delivery.totals.messages >= MHP_PANEL.maximumQueuedMessages ||
        peer.delivery.totals.bytes >= MHP_PANEL.maximumQueuedBytes
      )
        input.pause()
      else input.resume()
    } finally {
      isReading = false
    }
  }
  const data = (chunk: Buffer) => {
    if (buffer.length + chunk.length + peer.delivery.totals.bytes > MHP_PANEL.maximumQueuedBytes) {
      fail()
      return
    }
    if (buffer.length === 0) buffer = capacity.subarray(0, 0)
    let offset = buffer.byteOffset - capacity.byteOffset
    const length = buffer.length + chunk.length
    if (capacity.length - offset < length) {
      // Geometric growth copies a fragmented frame logarithmically, inside the same byte cap.
      const next = Buffer.allocUnsafe(
        Math.min(MHP_PANEL.maximumQueuedBytes, Math.max(capacity.length * 2, length)),
      )
      buffer.copy(next)
      capacity = next
      offset = 0
    }
    chunk.copy(capacity, offset + buffer.length)
    buffer = capacity.subarray(offset, offset + length)
    pump()
  }
  const fail = () => {
    exitCode = 1
    peer.close()
  }
  const end = () => {
    if (buffer.length > 0) exitCode = 1
    peer.close()
  }
  const onSignal = () => {
    peer.close()
  }
  peer.delivery.connect((line, complete) => output.write(line, complete))
  peer.delivery.onCapacityChanged(() => {
    queueMicrotask(pump)
  })
  input.on('data', data).once('end', end).once('error', fail)
  const drain = () => {
    peer.delivery.resume()
  }
  output.on('drain', drain).once('error', fail).once('close', fail)
  process.once('SIGINT', onSignal).once('SIGTERM', onSignal)
  try {
    await closed
  } finally {
    input.off('data', data).off('end', end).off('error', fail).pause()
    output.off('drain', drain).off('error', fail).off('close', fail)
    process.off('SIGINT', onSignal).off('SIGTERM', onSignal)
    for (const task of deferredOpen) clearImmediate(task)
    deferredOpen.clear()
    for (const owner of browsers.values()) {
      owner.surfaces.close()
      owner.ui.close()
      owner.delivery.close()
    }
    const drained = await Promise.allSettled([
      registry.close(),
      peer.settled(),
      transactions,
      opening,
    ])
    for (const current of ownedSettings) await current.dispose()
    await companion?.close()
    if (drained.some((result) => result.status === 'rejected')) {
      log.warn('MHP_REGISTRY_CLOSE_FAILED')
      exitCode = 1
    }
    await runtime.close()
  }
  return exitCode
}
