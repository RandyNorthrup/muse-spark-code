import { Buffer } from 'node:buffer'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { RuntimeSettingsStore } from '../settingsStore'
import { startCompanionServer } from '../companion/server'
import {
  MHP,
  MHP_ERROR_CODES,
  MHP_PANEL,
  RUNTIME_PANEL,
  RUNTIME_PANEL_PORTS_BUNDLE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { MHP_METHODS, type MhpParams } from '../../shared/hostApi/methods'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
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
import type { runtimeSettings } from './runtimeFeatures'
import { panelPortsLoader } from './panelLoader'
import { uiLocale } from '../../shared/l10n/text'
import * as z from 'zod/mini'

export interface RunPanelDeps {
  readonly options: ServeOptions
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

/** Native carriers use stdout; companion browser traffic is bound to an authenticated window. */
export async function runPanel(deps: RunPanelDeps): Promise<number> {
  const { runtime, log, input, output } = deps
  const registry = new ControllerRegistry<RuntimeConversation>(log)
  const browsers = new Map<
    string,
    { readonly delivery: PanelDelivery; readonly surfaces: PanelSurfaces }
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
  let companion: Awaited<ReturnType<typeof startCompanionServer>> | undefined
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
    binding.surfaceKind === 'chat' ? registry.held(binding.sessionId) : undefined
  const peer = new PanelConnection(
    {
      capabilities: ['lifecycle'],
      initialize: async (params, signal) => {
        signal.throwIfAborted()
        if (deps.options.trustWorkspace && !params.trusted)
          throw new Error('MHP_WORKSPACE_UNTRUSTED')
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
        signal.throwIfAborted()
        const readiness = await runtime.backend.readiness(false)
        if (readiness.state !== 'ready') throw new Error(readiness.message)
        const host = await runtime.backend.hostFor(root)
        signal.throwIfAborted()
        registry.watch(host)
        const models = await host.listModels()
        const model = models.find((candidate) => candidate.isDefault) ?? models[0]
        if (model === undefined) throw new Error(UI_TEXT.acpNoModels)
        const started = await host.startSession({
          workspaceRoot: root,
          modelId: model.modelId,
          approvalMode: approvalModeFor(
            settings.current().initialPermissionMode === 'bypassPermissions' &&
              !deps.options.canBypass
              ? 'manual'
              : settings.current().initialPermissionMode,
            true,
          ),
        })
        let loaded
        try {
          loaded = await host.resumeSession(started.sessionId, model.modelId)
        } finally {
          if (loaded?.session !== started) started.dispose()
        }
        if (signal.aborted) {
          loaded.session.dispose()
          signal.throwIfAborted()
        }
        const claim = registry.claimSession(loaded.session.sessionId)
        conversation = await registry.adopt(
          host,
          loaded.session,
          claim,
          () =>
            new RuntimeConversation(loaded.session, host, log, () => {
              exitCode = 1
              peer.close()
            }),
          (controller) =>
            controller.prepare(
              {
                host: peer,
                runtime,
                options: deps.options,
                store: requireStore(),
                settings: requireSettings(),
                workspaceRoot: root,
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
                log,
              },
              loaded,
              deps.conversationBundle,
              features.runtimeConversationDeps,
            ),
        )
      },
      initialized: () => {
        void openInitialSurface().catch(() => {
          log.error('MHP_PANEL_OPEN_FAILED')
          exitCode = 1
          peer.close()
        })
      },
      request: async (method, value, signal) => {
        signal.throwIfAborted()
        switch (method) {
          case 'workspace/folders': {
            return [{ uri: pathToFileURL(root).href, name: path.basename(root) }]
          }
          case 'workspace/trust': {
            return { trusted: deps.options.trustWorkspace }
          }
          case 'settings/get': {
            const params = MHP_METHODS[method].params.parse(value)
            return { value: await requireStore().getSetting(params.key) }
          }
          case 'settings/update': {
            const params = MHP_METHODS[method].params.parse(value)
            await requireStore().updateSetting(params.key, params.value, params.scope)
            await requireSettings().refresh()
            return null
          }
          case 'storage/global.get':
          case 'storage/workspace.get': {
            const params = MHP_METHODS[method].params.parse(value)
            return {
              value: await requireStore().getStorage(
                params.key,
                method === 'storage/global.get' ? 'user' : 'workspace',
              ),
            }
          }
          case 'storage/global.set':
          case 'storage/workspace.set': {
            const params = MHP_METHODS[method].params.parse(value)
            await requireStore().setStorage(
              params.key,
              params.value,
              method === 'storage/global.set' ? 'user' : 'workspace',
            )
            return null
          }
          case 'ui/notify': {
            const params = MHP_METHODS[method].params.parse(value)
            for (const browser of browsers.values())
              log.trace(`MHP_BROWSER_NOTIFY ${String(browser.delivery.totals.messages)}`)
            log.warn(`MHP_UI_NOTIFY ${params.severity}`)
            return unsupported()
          }
          default: {
            return unsupported()
          }
        }
      },
      notify: (method, value) => {
        switch (method) {
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
      const surfaces = new PanelSurfaces(delivery, lookup, log, () => {
        exitCode = 1
        peer.close()
      })
      found = { delivery, surfaces }
      browsers.set(id, found)
    }
    return found
  }

  async function openInitialSurface(): Promise<void> {
    if (conversation === undefined) return unsupported()
    if (deps.transport === 'stdio') {
      await peer.request('surfaces/open', {
        kind: 'chat',
        placement: 'side',
        sessionId: conversation.sessionId,
      })
      return
    }
    // D owns the real shared renderer/bridge. Its absence is explicit in this
    // base; the authenticated carrier remains available to paired clients.
    companion = await startCompanionServer({
      handler: {
        inputSchema: panelEnvelopeSchema,
        outputSchema: z.union([
          panelEnvelopeSchema.check(z.refine((frame) => frame.direction === 'toPanel')),
          panelErrorSchema,
        ]),
        surfaceSchema: panelLifecycleSchema,
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
      assets: new Map(),
      renderPage: () =>
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body data-session-id="${escapeHtml(conversation?.sessionId ?? '')}"><p role="alert">${escapeHtml(UI_TEXT.companionLaunchFailed)}</p></body></html>`,
    })
    void companion.closed.then(() => {
      peer.close()
    })
    await peer.request('ui/openExternal', { uri: companion.launchUrl() })
  }

  let buffer = Buffer.alloc(0)
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
    buffer = Buffer.concat([buffer, chunk])
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
    for (const owner of browsers.values()) {
      owner.surfaces.close()
      owner.delivery.close()
    }
    await companion?.close()
    try {
      await registry.close()
    } catch {
      log.warn('MHP_REGISTRY_CLOSE_FAILED')
      exitCode = 1
    }
    await runtime.close()
  }
  return exitCode
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
