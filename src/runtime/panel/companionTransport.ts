// M104 lane C: the companion transport. One browser window is the panel's
// host: the transport feeds it a synthetic MHP handshake, answers the
// runtime's surfaces requests by minting the window's binding and
// announcing its launch URL, routes panel frames to the window's stream,
// and forwards the runtime's ui/* calls to the window's fallback UI. The
// window posts envelopes and lifecycle on /panel/*, reads frames on
// /panel/events, answers UI calls on /host/message and reads them on
// /host/events. A second surfaces/open retires the live window first: one
// window is live at a time.
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { IDE_MCP_TOKEN_BYTES, MHP, MHP_ERROR_CODES, MHP_PANEL } from '../../shared/constants'
import {
  fallbackUiCallSchema,
  fallbackUiMethodSchema,
  fallbackUiReplySchema,
} from '../../shared/hostApi/fallbackUi'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
  panelLifecycleSchema,
  type MhpPanelBinding,
  type MhpPanelEnvelope,
} from '../../shared/hostApi/panel'
import type { CompanionHandler } from '../companion/server'
import type { PanelConnection } from './connection'
import { panelEntryFor } from './portablePage'

export interface PanelCompanionTransportDeps {
  readonly connection: PanelConnection
  readonly log: {
    warn(message: string): void
  }
  /** The agent's own version, for the synthetic host's initialize params. */
  readonly version: string
  readonly locale: string
  /** The workspace folder as a file: URL, for the synthetic host's folders. */
  readonly workspaceUri: string
  readonly workspaceName: string
  /** Mints the window's launch URL for its surface id. */
  readonly issueLaunch: (context: string) => string
  /** Retires a replaced window's codes, bearers, streams and calls. */
  readonly retireLaunch: (context: string) => void
  /** Prints the launch URL and opens the person's browser. Never throws. */
  readonly announce: (url: string) => void
}

const HANDSHAKE_ID = 'companion-initialize'

/** The window's stream carries panel frames and the contract's own refusals. */
export type PanelCompanionFrame = MhpPanelEnvelope | z.infer<typeof panelErrorSchema>

export interface PanelCompanionTransport {
  readonly handler: CompanionHandler<MhpPanelEnvelope, PanelCompanionFrame>
  readonly services: CompanionHandler<unknown, unknown>
  /** The live window's binding for its surface id, or undefined after it retired. */
  bindingFor(context: string): MhpPanelBinding | undefined
  /** Feeds the synthetic host handshake; surfaces/open then announces the window. */
  handshake(): void
}

export function createPanelCompanionTransport(
  deps: PanelCompanionTransportDeps,
): PanelCompanionTransport {
  const { connection } = deps
  let binding: MhpPanelBinding | undefined
  let panelEmit: ((message: unknown, complete?: () => void) => void) | undefined
  let uiEmit: ((message: unknown, complete?: () => void) => void) | undefined
  let uiQueuedBytes = 0
  const uiQueue: { frame: unknown; complete?: () => void }[] = []
  // The runtime's ui/* calls awaiting the window's reply, by their MHP id.
  const pendingUi = new Set<string | number>()

  function answer(
    id: string | number,
    body: { readonly result?: unknown; readonly error?: unknown },
  ): void {
    connection.receive(JSON.stringify({ jsonrpc: MHP.jsonRpcVersion, id, ...body }))
  }

  function refuse(
    id: string | number,
    code: (typeof MHP_ERROR_CODES)[keyof typeof MHP_ERROR_CODES],
    message: string,
  ): void {
    pendingUi.delete(id)
    answer(id, { error: { code, message } })
  }

  function retireBinding(): void {
    if (binding === undefined) return
    deps.retireLaunch(binding.surface)
    binding = undefined
  }

  function openSurface(id: string | number, params: unknown, complete: () => void): void {
    const request =
      typeof params === 'object' && params !== null && 'kind' in params ? params : undefined
    const kind = request?.kind
    const sessionId =
      request !== undefined && 'sessionId' in request ? request.sessionId : undefined
    const sessionText = typeof sessionId === 'number' ? String(sessionId) : sessionId
    if (typeof kind !== 'string' || typeof sessionText !== 'string' || sessionText === '') {
      refuse(id, MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_PARAMS')
      complete()
      return
    }
    const entry = panelEntryFor(kind)
    if (entry === undefined) {
      refuse(id, MHP_ERROR_CODES.unsupportedCapability, 'MHP_UNSUPPORTED_CAPABILITY')
      complete()
      return
    }
    retireBinding()
    const surface = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    binding = { surface, sessionId: sessionText, surfaceKind: entry.surfaceKind }
    deps.announce(deps.issueLaunch(surface))
    answer(id, { result: { surfaceId: surface } })
    complete()
  }

  function closeSurface(params: unknown): void {
    if (
      binding !== undefined &&
      typeof params === 'object' &&
      params !== null &&
      'surfaceId' in params &&
      params.surfaceId === binding.surface
    )
      retireBinding()
  }

  function forwardUiCall(id: string | number, frame: unknown, complete: () => void): void {
    pendingUi.add(id)
    const emit = uiEmit
    if (emit === undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(frame))
      if (
        uiQueue.length >= MHP_PANEL.maximumQueuedMessages ||
        uiQueuedBytes + bytes > MHP_PANEL.maximumQueuedBytes
      ) {
        refuse(id, MHP_ERROR_CODES.internalError, 'MHP_PANEL_BACKPRESSURE')
      } else {
        uiQueue.push({ frame })
        uiQueuedBytes += bytes
      }
      complete()
      return
    }
    emit(frame, complete)
  }

  function writer(line: string, complete: () => void): void {
    const frame: unknown = JSON.parse(line)
    if (typeof frame !== 'object' || frame === null) {
      deps.log.warn('The delivery wrote no frame; it was dropped.')
      complete()
      return
    }
    if ('mhp' in frame) {
      const emit = panelEmit
      if (emit === undefined) {
        deps.log.warn('A panel frame arrived with no window; it was dropped.')
        complete()
        return
      }
      emit(frame, complete)
      return
    }
    if (!('jsonrpc' in frame)) {
      deps.log.warn('The delivery wrote no frame; it was dropped.')
      complete()
      return
    }
    if (!('method' in frame)) {
      // The answer to the synthetic handshake; the connection keeps its own state.
      complete()
      return
    }
    const { method } = frame
    if (method === '$/cancelRequest') {
      const params = 'params' in frame ? frame.params : undefined
      const cancelled =
        typeof params === 'object' && params !== null && 'id' in params ? params.id : undefined
      if (typeof cancelled === 'string' || typeof cancelled === 'number')
        pendingUi.delete(cancelled)
      const emit = uiEmit
      if (emit === undefined) {
        complete()
        return
      }
      emit(frame, complete)
      return
    }
    if (typeof method !== 'string') {
      complete()
      return
    }
    const callId = 'id' in frame ? frame.id : undefined
    if (typeof callId !== 'string' && typeof callId !== 'number') {
      // A runtime notification other than cancel (none is offered); nothing answers it.
      complete()
      return
    }
    if (method === 'surfaces/open') {
      openSurface(callId, 'params' in frame ? frame.params : undefined, complete)
      return
    }
    if (method === 'surfaces/close') {
      closeSurface('params' in frame ? frame.params : undefined)
      answer(callId, { result: null })
      complete()
      return
    }
    if (method === 'surfaces/focus') {
      answer(callId, { result: null })
      complete()
      return
    }
    if (!method.startsWith('ui/')) {
      // Unreachable: the handshake offers lifecycle, surfaces and ui only.
      answer(callId, {
        error: { code: MHP_ERROR_CODES.methodNotFound, message: 'MHP_METHOD_NOT_FOUND' },
      })
      complete()
      return
    }
    if (!fallbackUiMethodSchema.safeParse(method).success) {
      // The window answers the fallback vocabulary only; anything else is refused aloud.
      refuse(callId, MHP_ERROR_CODES.methodNotFound, 'MHP_METHOD_NOT_FOUND')
      complete()
      return
    }
    forwardUiCall(callId, frame, complete)
    return
  }

  return {
    handler: {
      inputSchema: panelEnvelopeSchema,
      outputSchema: z.union([panelEnvelopeSchema, panelErrorSchema]),
      surfaceSchema: panelLifecycleSchema,
      isBindingAllowed: (message, context) => {
        if (binding === undefined || context !== binding.surface) return false
        const lifecycle = panelLifecycleSchema.safeParse(message)
        if (lifecycle.success)
          return (
            lifecycle.data.surface === binding.surface &&
            lifecycle.data.sessionId === binding.sessionId &&
            lifecycle.data.surfaceKind === binding.surfaceKind
          )
        const frame = panelEnvelopeSchema.safeParse(message)
        return frame.success && frame.data.surface === binding.surface
      },
      post: (frame) => {
        connection.surfaces.message(frame)
        return Promise.resolve()
      },
      surface: (frame) => {
        connection.surfaces.lifecycle(frame)
        return Promise.resolve()
      },
      subscribe: (_sessionId, emit) => {
        panelEmit = emit
        return () => {
          if (panelEmit === emit) panelEmit = undefined
          connection.surfaces.detach()
        }
      },
    },
    services: {
      inputSchema: fallbackUiReplySchema,
      outputSchema: fallbackUiCallSchema,
      post: (reply) => {
        // The server admitted this reply through the fallback schema; read its id.
        const id =
          typeof reply === 'object' && reply !== null && 'id' in reply ? reply.id : undefined
        if ((typeof id !== 'string' && typeof id !== 'number') || !pendingUi.has(id)) {
          deps.log.warn('A UI reply named no pending call; it was dropped.')
          return Promise.resolve()
        }
        pendingUi.delete(id)
        connection.receive(JSON.stringify(reply))
        return Promise.resolve()
      },
      subscribe: (_sessionId, emit) => {
        uiEmit = emit
        const queued = uiQueue.splice(0)
        uiQueuedBytes = 0
        for (const { frame, complete } of queued) emit(frame, complete)
        return () => {
          if (uiEmit === emit) uiEmit = undefined
        }
      },
    },
    bindingFor: (context) => (binding?.surface === context ? binding : undefined),
    handshake: () => {
      connection.delivery.connect((line, complete) => {
        writer(line, complete)
        return true
      })
      // The window answers surfaces and the fallback UI vocabulary; it
      // cannot attest workspace trust, and it shows no editor documents.
      connection.receive(
        JSON.stringify({
          jsonrpc: MHP.jsonRpcVersion,
          id: HANDSHAKE_ID,
          method: 'initialize',
          params: {
            host: { id: 'companion', version: deps.version },
            protocolRange: {
              minimum: MHP.minimumVersion,
              maximumExclusive: MHP.maximumVersionExclusive,
            },
            capabilities: ['lifecycle', 'surfaces', 'ui'],
            locale: deps.locale,
            theme: { kind: 'light', tokens: {} },
            folders: [{ uri: deps.workspaceUri, name: deps.workspaceName }],
            trusted: false,
          },
        }),
      )
    },
  }
}
