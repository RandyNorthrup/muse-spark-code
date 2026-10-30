// The runtime's side of one MHP 1.5 connection (M104 lane B, D84, D226): the
// handshake, the host's requests and notifications with their cancellation,
// the runtime's own requests to the host (correlated by id, cancelled by
// `$/cancelRequest`, with no deadline of ours: a consent question waits for
// the person), the surfaces the host opens, and shutdown. Every frame is
// parsed against the frozen contract (src/shared/hostApi) before anything
// acts on it; every answer is checked against the method's own result schema
// before it is written.
import { failureForLog } from '../../core/backends/musecode/logText'
import { unlessAborted } from '../../core/timeouts'
import type { CoreLogger } from '../../core/logging'
import { MHP, MHP_ERROR_CODES, MHP_PANEL } from '../../shared/constants'
import { selectMhpVersion, type MhpCapability } from '../../shared/hostApi/capabilities'
import { idSchema } from '../../shared/hostApi/data'
import {
  MHP_METHODS,
  type HostServices,
  type MhpMethod,
  type MhpNotificationMethod,
  type MhpParams,
  type MhpRequestMethod,
  type MhpResult,
} from '../../shared/hostApi/methods'
import { panelInitializeResultSchema, type MhpPanelBinding } from '../../shared/hostApi/panel'
import { MhpPanelError } from '../../shared/hostApi/panelError'
import {
  failureFrameSchema,
  parseMhpResult,
  type MhpFailureFrame,
} from '../../shared/hostApi/protocol'
import * as z from 'zod/mini'
import { isDeliveryRefusal, PanelDelivery } from './delivery'
import { PanelSurfaces, type PanelView } from './surfaces'

type RequestId = z.infer<typeof idSchema>
type FailureCode = MhpFailureFrame['error']['code']

/** A request the runtime answers with this MHP failure (its code and stable message). */
export class MhpServiceError extends Error {
  public constructor(
    public readonly code: FailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'MhpServiceError'
  }
}

function failure(id: RequestId | null, code: FailureCode, message: string): MhpFailureFrame {
  return failureFrameSchema.parse({ jsonrpc: MHP.jsonRpcVersion, id, error: { code, message } })
}

export interface PanelConnectionPorts {
  /** What the runtime serves; the handshake's answer names exactly these. */
  readonly capabilities: readonly MhpCapability[]
  /** Binds the connection to the host's workspace; a throw refuses the handshake. */
  initialize(params: MhpParams<'initialize'>, signal: AbortSignal): Promise<void>
  /** The handshake was answered: the runtime may now ask the host for things. */
  initialized?(): void
  /** One host request after the handshake; the answer is checked against the method's result. */
  request(method: MhpRequestMethod, params: unknown, signal: AbortSignal): Promise<unknown>
  /** One host notification after the handshake. */
  notify(method: MhpNotificationMethod, params: unknown): void
  /** The view a host surface shows, found by its binding; none refuses the surface. */
  view(binding: MhpPanelBinding): PanelView | undefined
  /** The host confirmed a surface closed. */
  surfaceClosed?(binding: MhpPanelBinding): void
  /** The connection ended: after shutdown, or fatally (a protocol fault, a host that stopped reading). */
  closed(isFatal: boolean): void
}

interface PendingRequest {
  readonly method: MhpRequestMethod
  resolve(frame: unknown): void
  reject(error: unknown): void
}

const methodNames: ReadonlySet<string> = new Set(Object.keys(MHP_METHODS))
const envelopeSchema = z.object({
  jsonrpc: z.literal(MHP.jsonRpcVersion),
  id: z.optional(idSchema),
  method: z.string(),
  params: z.optional(z.unknown()),
})
const answerSchema = z.object({ jsonrpc: z.literal(MHP.jsonRpcVersion), id: z.nullable(idSchema) })

function isRequestMethod(name: string): name is MhpRequestMethod {
  return Object.entries(MHP_METHODS).some(
    ([method, definition]) => method === name && definition.kind === 'request',
  )
}

function isNotificationMethod(name: string): name is MhpNotificationMethod {
  return Object.entries(MHP_METHODS).some(
    ([method, definition]) => method === name && definition.kind === 'notification',
  )
}

export class PanelConnection implements HostServices {
  private readonly incoming = new Map<RequestId, AbortController>()
  private readonly pending = new Map<RequestId, PendingRequest>()
  /** Requests cancelled before the host answered: its late answer is read and dropped. */
  private readonly retired = new Map<RequestId, MhpRequestMethod>()
  private offered: readonly MhpCapability[] = []
  private nextId = 1
  private isInitialized = false
  private isInitializing = false
  private isShutDown = false
  private isClosed = false

  public readonly delivery = new PanelDelivery()
  public readonly surfaces: PanelSurfaces

  public constructor(
    private readonly ports: PanelConnectionPorts,
    private readonly log: CoreLogger,
  ) {
    this.surfaces = new PanelSurfaces(
      this.delivery,
      (binding) => ports.view(binding),
      log,
      () => {
        this.close(true)
      },
      (binding) => {
        ports.surfaceClosed?.(binding)
      },
    )
  }

  private emit(frame: unknown, onComplete?: () => void): void {
    if (this.isClosed) return
    try {
      this.delivery.post(frame, null, onComplete)
    } catch (error: unknown) {
      // NARROW: the host stopped reading past MHP's queue bounds; anything else is a fault of ours.
      if (!isDeliveryRefusal(error)) throw error
      this.log.error(`MHP host stopped reading: ${failureForLog(error)}`)
      this.close(true)
    }
  }

  /** Panel envelopes and surface lifecycle, once the handshake is done. */
  private panelFrame(value: object): void {
    if (!this.isInitialized) {
      this.emit(failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED'))
      return
    }
    try {
      if ('kind' in value && value.kind === 'panel') this.surfaces.message(value)
      else if ('kind' in value && value.kind === 'surface') this.surfaces.lifecycle(value)
      else this.log.warn('MHP_PANEL_FRAME_UNSUPPORTED')
    } catch (error: unknown) {
      // NARROW: the contract's own refusal answers the host with its frame; anything else is a fault of ours.
      if (!(error instanceof MhpPanelError)) throw error
      if (isDeliveryRefusal(error)) {
        this.log.error(`MHP host stopped reading: ${failureForLog(error)}`)
        this.close(true)
        return
      }
      this.emit(error.frame)
    }
  }

  private dispatch(method: string, callId: RequestId | null, params: unknown): void {
    if (method === '$/cancelRequest') {
      const cancelled = MHP_METHODS['$/cancelRequest'].params.parse(params)
      this.incoming.get(cancelled.id)?.abort()
      return
    }
    if (method === 'initialize' && callId !== null) {
      this.initialize(callId, MHP_METHODS.initialize.params.parse(params))
      return
    }
    if (!this.isInitialized) {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED'))
      return
    }
    const definition = Object.entries(MHP_METHODS).find(([name]) => name === method)?.[1]
    if (definition?.direction === 'runtimeToHost') {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_WRONG_DIRECTION'))
      return
    }
    if (callId === null) {
      if (isNotificationMethod(method)) this.ports.notify(method, params)
      return
    }
    if (!isRequestMethod(method)) return
    if (method === 'shutdown') {
      this.shutdown(callId)
      return
    }
    this.answer(method, callId, params)
  }

  private initialize(callId: RequestId, params: MhpParams<'initialize'>): void {
    if (this.isInitialized || this.isInitializing) {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_ALREADY_INITIALIZED'))
      return
    }
    // D226: one MHP version in every host; a range without it is refused.
    const selected = selectMhpVersion(params.protocolRange)
    if (selected !== MHP.version) {
      this.emit(failure(callId, MHP_ERROR_CODES.incompatibleVersion, 'MHP_INCOMPATIBLE_VERSION'))
      return
    }
    this.isInitializing = true
    const controller = new AbortController()
    this.incoming.set(callId, controller)
    void (async () => {
      try {
        await this.ports.initialize(params, controller.signal)
        this.offered = params.capabilities
        this.emit(
          panelInitializeResultSchema.parse({
            jsonrpc: MHP.jsonRpcVersion,
            id: callId,
            result: { protocolVersion: selected, capabilities: this.ports.capabilities },
          }),
        )
        this.isInitialized = true
        this.ports.initialized?.()
      } catch (error: unknown) {
        // REPORTED: the handshake answers with the refusal's code, or as failed.
        this.log.warn(`MHP initialize refused: ${failureForLog(error)}`)
        this.emit(this.failureOf(callId, error, controller.signal, 'MHP_INITIALIZE_FAILED'))
      } finally {
        this.incoming.delete(callId)
        this.isInitializing = false
      }
    })()
  }

  private shutdown(callId: RequestId): void {
    this.isShutDown = true
    for (const controller of this.incoming.values()) controller.abort()
    // The answer goes out whole before the connection ends.
    this.emit(
      parseMhpResult('shutdown', { jsonrpc: MHP.jsonRpcVersion, id: callId, result: null }),
      () => {
        this.close()
      },
    )
  }

  private answer(method: MhpRequestMethod, callId: RequestId, params: unknown): void {
    if (this.incoming.has(callId)) {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_DUPLICATE_ID'))
      return
    }
    if (this.incoming.size >= MHP_PANEL.maximumQueuedMessages) {
      this.emit(failure(callId, MHP_ERROR_CODES.internalError, 'MHP_PANEL_BACKPRESSURE'))
      return
    }
    const controller = new AbortController()
    this.incoming.set(callId, controller)
    void (async () => {
      try {
        const value = await unlessAborted(
          this.ports.request(method, params, controller.signal),
          controller.signal,
        )
        this.emit(
          parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: callId, result: value }),
        )
      } catch (error: unknown) {
        // REPORTED: every failure answers the host with its code.
        this.log.trace(`MHP ${method} answered with a failure: ${failureForLog(error)}`)
        this.emit(this.failureOf(callId, error, controller.signal, 'MHP_REQUEST_FAILED'))
      } finally {
        this.incoming.delete(callId)
      }
    })()
  }

  /** The failure a request answers: cancelled, the service's own refusal, or the fallback code. */
  private failureOf(
    callId: RequestId,
    error: unknown,
    signal: AbortSignal,
    fallback: string,
  ): MhpFailureFrame {
    if (signal.aborted) return failure(callId, MHP_ERROR_CODES.cancelled, 'MHP_CANCELLED')
    return error instanceof MhpServiceError
      ? failure(callId, error.code, error.message)
      : failure(callId, MHP_ERROR_CODES.internalError, fallback)
  }

  /** The method's definition, once the connection is up and the method is one the runtime may call. */
  private callable<M extends MhpMethod>(method: M, params: MhpParams<M>): (typeof MHP_METHODS)[M] {
    if (!this.isInitialized || this.isClosed)
      throw new MhpServiceError(MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED')
    const definition = MHP_METHODS[method]
    definition.params.parse(params)
    if (definition.direction === 'hostToRuntime')
      throw new MhpServiceError(MHP_ERROR_CODES.invalidRequest, 'MHP_WRONG_DIRECTION')
    return definition
  }

  /** The host's answer to a request of ours: the waiting caller gets it, or the stream is not trusted. */
  private answered(raw: object): void {
    const id = 'id' in raw ? idSchema.safeParse(raw.id) : undefined
    const callId = id?.success === true ? id.data : undefined
    const waiting = callId === undefined ? undefined : this.pending.get(callId)
    const late = callId === undefined ? undefined : this.retired.get(callId)
    if (callId === undefined || (waiting === undefined && late === undefined)) {
      this.log.warn('MHP_UNCORRELATED_RESULT')
      this.close(true)
      return
    }
    if (waiting === undefined) {
      this.retired.delete(callId)
      return
    }
    this.pending.delete(callId)
    const refused = failureFrameSchema.safeParse(raw)
    if (refused.success) {
      waiting.reject(new MhpServiceError(refused.data.error.code, refused.data.error.message))
      return
    }
    waiting.resolve(raw)
  }

  /** Whether the host offered this capability group (the runtime asks only for what it did). */
  public offers(capability: MhpCapability): boolean {
    return this.offered.includes(capability)
  }

  /** Whether the host asked for shutdown before the connection ended. */
  public get hasShutDown(): boolean {
    return this.isShutDown
  }

  public async request<M extends MhpRequestMethod>(
    method: M,
    params: MhpParams<M>,
    signal?: AbortSignal,
  ): Promise<MhpResult<M>> {
    const definition = this.callable(method, params)
    // The runtime asks only for what the host offered; the rest is a refusal the caller says.
    if (!this.offered.includes(definition.capability))
      throw new MhpServiceError(MHP_ERROR_CODES.unsupportedCapability, 'MHP_UNSUPPORTED_CAPABILITY')
    signal?.throwIfAborted()
    const id = `runtime-${String(this.nextId++)}`
    const release = this.delivery.reserve(
      new TextEncoder().encode(JSON.stringify(params)).byteLength,
    )
    const answered = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
    })
    const cancel = () => {
      const waiting = this.pending.get(id)
      if (waiting === undefined) return
      this.pending.delete(id)
      this.retired.set(id, method)
      waiting.reject(new MhpServiceError(MHP_ERROR_CODES.cancelled, 'MHP_CANCELLED'))
      this.emit({ jsonrpc: MHP.jsonRpcVersion, method: '$/cancelRequest', params: { id } })
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      this.emit({ jsonrpc: MHP.jsonRpcVersion, id, method, params })
      const frame = await answered
      try {
        return parseMhpResult(method, frame).result
      } catch (error: unknown) {
        // NARROW: a result that breaks the method's schema fails this request alone.
        // By name: the schema library's class differs between bundles.
        if (!(error instanceof Error) || error.name !== '$ZodError') throw error
        this.log.warn(`MHP ${method} answered with an invalid result`)
        throw new MhpServiceError(MHP_ERROR_CODES.invalidRequest, 'MHP_INVALID_RESULT')
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.pending.delete(id)
      release()
    }
  }

  public notify<M extends MhpNotificationMethod>(method: M, params: MhpParams<M>): void {
    this.callable(method, params)
    this.emit({ jsonrpc: MHP.jsonRpcVersion, method, params })
  }

  /** One line from the host (the transport already bounded it to MHP's envelope size). */
  public receive(line: string): void {
    if (this.isClosed) return
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (error: unknown) {
      // NARROW: text that is not JSON is the host's parse error, answered and survived.
      if (!(error instanceof SyntaxError)) throw error
      this.emit(failure(null, MHP_ERROR_CODES.parseError, 'MHP_PARSE_ERROR'))
      return
    }
    if (typeof raw === 'object' && raw !== null && 'mhp' in raw) {
      this.panelFrame(raw)
      return
    }
    const envelope = envelopeSchema.safeParse(raw)
    if (!envelope.success) {
      if (typeof raw === 'object' && raw !== null && answerSchema.safeParse(raw).success) {
        this.answered(raw)
        return
      }
      this.emit(failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_INVALID_REQUEST'))
      return
    }
    const { id: callId = null, method } = envelope.data
    if (!methodNames.has(method)) {
      if (callId !== null)
        this.emit(failure(callId, MHP_ERROR_CODES.methodNotFound, 'MHP_METHOD_NOT_FOUND'))
      return
    }
    const definition = Object.entries(MHP_METHODS).find(([name]) => name === method)?.[1]
    if (definition === undefined || (definition.kind === 'request') !== (callId !== null)) {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_INVALID_REQUEST'))
      return
    }
    const params = definition.params.safeParse(envelope.data.params)
    if (!params.success) {
      if (callId !== null)
        this.emit(failure(callId, MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_PARAMS'))
      return
    }
    this.dispatch(method, callId, params.data)
  }

  public close(isFatal = false): void {
    if (this.isClosed) return
    this.isClosed = true
    this.surfaces.close()
    this.delivery.close()
    for (const waiting of this.pending.values())
      waiting.reject(new MhpServiceError(MHP_ERROR_CODES.cancelled, 'MHP_CONNECTION_CLOSED'))
    this.pending.clear()
    this.retired.clear()
    for (const controller of this.incoming.values()) controller.abort()
    this.incoming.clear()
    this.ports.closed(isFatal)
  }
}
