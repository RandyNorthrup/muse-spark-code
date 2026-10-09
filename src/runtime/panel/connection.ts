import * as z from 'zod/mini'
import { unlessAborted } from '../../core/timeouts'
import type { CoreLogger } from '../../core/logging'
import { MHP, MHP_ERROR_CODES, MHP_PANEL, RUNTIME_PANEL } from '../../shared/constants'
import { selectMhpVersion, type MhpCapability } from '../../shared/hostApi/capabilities'
import { idSchema } from '../../shared/hostApi/data'
import { parseMhpStdioLine } from '../../shared/hostApi/framing'
import {
  MHP_METHODS,
  type HostServices,
  type MhpParams,
  type MhpRequestMethod,
  type MhpResult,
  type MhpNotificationMethod,
} from '../../shared/hostApi/methods'
import { MhpPanelError, panelInitializeResultSchema } from '../../shared/hostApi/panel'
import {
  failureFrameSchema,
  parseMhpResult,
  type MhpFailureFrame,
} from '../../shared/hostApi/protocol'
import { PanelDelivery } from './delivery'
import { PanelSurfaces, type PanelView } from './surfaces'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'

type RequestId = z.infer<typeof idSchema>
interface PendingRequest {
  readonly method: MhpRequestMethod
  resolve(value: unknown): void
  reject(error: unknown): void
}
export interface PanelConnectionPorts {
  readonly capabilities: readonly MhpCapability[]
  request(method: MhpRequestMethod, params: unknown, signal: AbortSignal): Promise<unknown>
  notify(method: MhpNotificationMethod, params: unknown): void
  initialize(params: MhpParams<'initialize'>, signal: AbortSignal): Promise<void>
  view(binding: MhpPanelBinding): PanelView | undefined
  surfaceClosed?(binding: MhpPanelBinding): void
  initialized?(): void
  closed(isFatal: boolean): void
}
export class MhpServiceError extends Error {
  public constructor(readonly frame: MhpFailureFrame) {
    super(frame.error.message)
  }
}
function failure(
  id: RequestId | null,
  code: MhpFailureFrame['error']['code'],
  message: string,
): MhpFailureFrame {
  return failureFrameSchema.parse({ jsonrpc: MHP.jsonRpcVersion, id, error: { code, message } })
}

/** Correlation and lifecycle surround the frozen stateless schema boundary. */
export class PanelConnection implements HostServices {
  private readonly pending = new Map<RequestId, PendingRequest>()
  private readonly retired = new Map<RequestId, MhpRequestMethod>()
  private readonly work = new Set<Promise<unknown>>()
  private readonly incoming = new Map<RequestId, AbortController>()
  private offered: readonly MhpCapability[] = []
  private version: typeof MHP.version = MHP.version
  private isInitialized = false
  private isInitializing = false
  private isClosed = false
  private nextId = 1
  private panelBarrier: ReturnType<typeof setImmediate> | undefined
  private readonly queuedPanels: { value: unknown; release: () => void }[] = []

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
      (binding) => ports.surfaceClosed?.(binding),
    )
  }

  private track<T>(adapter: Promise<T>): Promise<T> {
    const work = (async () => {
      return await adapter
    })()
    this.work.add(work)
    void (async () => {
      try {
        await work
      } catch {
        /* The admitted caller reports the failure. */
      } finally {
        this.work.delete(work)
      }
    })()
    return work
  }

  private emit(frame: unknown): void {
    if (this.isClosed) return
    try {
      this.delivery.post(frame)
    } catch {
      this.log.error('MHP_FATAL_BACKPRESSURE')
      this.close(true)
    }
  }

  private panel(value: unknown): void {
    if (this.panelBarrier !== undefined) {
      const release = this.delivery.reserve(
        new TextEncoder().encode(JSON.stringify(value)).byteLength,
      )
      this.queuedPanels.push({ value, release })
      return
    }
    try {
      const header = z.object({ kind: z.enum(['panel', 'surface']) }).parse(value)
      if (header.kind === 'panel') this.surfaces.message(value)
      else this.surfaces.lifecycle(value)
    } catch (error: unknown) {
      if (error instanceof MhpPanelError) this.emit(error.frame)
      else this.close(true)
    }
  }

  private afterSurfaceResult(): void {
    this.panelBarrier ??= setImmediate(() => {
      this.panelBarrier = undefined
      for (const job of this.queuedPanels.splice(0)) {
        job.release()
        if (!this.isClosed) this.panel(job.value)
      }
    })
  }

  public async request<M extends MhpRequestMethod>(
    method: M,
    params: MhpParams<M>,
    signal?: AbortSignal,
  ): Promise<MhpResult<M>> {
    if (!this.isInitialized || this.isClosed)
      throw new MhpServiceError(
        failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED'),
      )
    const definition = MHP_METHODS[method]
    definition.params.parse(params)
    signal?.throwIfAborted()
    if (
      (definition.direction === 'bidirectional' &&
        this.ports.capabilities.includes(definition.capability)) ||
      !this.offered.includes(definition.capability)
    ) {
      if (this.work.size >= MHP_PANEL.maximumQueuedMessages)
        throw new MhpServiceError(failure(null, MHP_ERROR_CODES.internalError, 'MHP_BACKPRESSURE'))
      const value = await this.track(
        this.ports.request(
          method,
          params,
          signal ?? AbortSignal.timeout(RUNTIME_PANEL.requestTimeoutMs),
        ),
      )
      return parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id: 1, result: value }).result
    }
    if (definition.direction === 'hostToRuntime')
      throw new MhpServiceError(
        failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_WRONG_DIRECTION'),
      )
    if (this.pending.size + this.retired.size >= MHP_PANEL.maximumQueuedMessages)
      throw new MhpServiceError(failure(null, MHP_ERROR_CODES.internalError, 'MHP_BACKPRESSURE'))
    const release = this.delivery.reserve(
      new TextEncoder().encode(JSON.stringify(params)).byteLength,
    )
    const id = `runtime-${String(this.nextId++)}`
    const abort = () => {
      const waiting = this.pending.get(id)
      if (waiting === undefined) return
      waiting.reject(new MhpServiceError(failure(id, MHP_ERROR_CODES.cancelled, 'MHP_CANCELLED')))
      this.pending.delete(id)
      this.retired.set(id, method)
      try {
        this.delivery.post({
          jsonrpc: MHP.jsonRpcVersion,
          method: '$/cancelRequest',
          params: { id },
        })
      } catch {
        this.close()
      }
    }
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
    })
    const deadline = AbortSignal.timeout(RUNTIME_PANEL.requestTimeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([deadline, signal])
    combined.addEventListener('abort', abort, { once: true })
    try {
      this.delivery.post({ jsonrpc: MHP.jsonRpcVersion, id, method, params })
      const frame = await result
      return parseMhpResult(method, frame).result
    } finally {
      combined.removeEventListener('abort', abort)
      this.pending.delete(id)
      release()
    }
  }

  public notify<M extends MhpNotificationMethod>(method: M, params: MhpParams<M>): void {
    if (!this.isInitialized || this.isClosed)
      throw new MhpServiceError(
        failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED'),
      )
    const definition = MHP_METHODS[method]
    definition.params.parse(params)
    if (definition.direction === 'hostToRuntime')
      throw new MhpServiceError(
        failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_WRONG_DIRECTION'),
      )
    this.delivery.post({ jsonrpc: MHP.jsonRpcVersion, method, params })
  }

  public receive(line: string): void {
    if (this.isClosed) return
    let frame: ReturnType<typeof parseMhpStdioLine>
    let pending: PendingRequest | undefined
    let retired: MhpRequestMethod | undefined
    let id: RequestId | null = null
    try {
      // Size preflight precedes the cheap correlation header and all JSON parsing.
      if (
        new TextEncoder().encode(line.replace(/\r?\n$/u, '')).byteLength >
        MHP_PANEL.maximumEnvelopeBytes
      ) {
        this.log.warn('MHP_PANEL_TOO_LARGE')
        this.close(true)
        return
      }
      const raw: unknown = JSON.parse(line)
      const header = z.object({ id: idSchema }).safeParse(raw)
      id = header.success ? header.data.id : null
      pending = id === null ? undefined : this.pending.get(id)
      retired = id === null ? undefined : this.retired.get(id)
      const resultHeader = z.object({ jsonrpc: z.literal(MHP.jsonRpcVersion) }).safeParse(raw)
      if (
        pending === undefined &&
        retired === undefined &&
        raw !== null &&
        typeof raw === 'object' &&
        resultHeader.success &&
        ('result' in raw || 'error' in raw)
      ) {
        this.log.warn('MHP_UNCORRELATED_RESULT')
        this.close(true)
        return
      }
      const panelHeader = z
        .object({ mhp: z.literal(MHP_PANEL.wireVersion), kind: z.enum(['panel', 'surface']) })
        .safeParse(raw)
      if (panelHeader.success && this.isInitialized) {
        this.panel(raw)
        return
      }
      const pendingMethod = pending?.method ?? retired
      frame = parseMhpStdioLine(line, {
        protocolVersion: this.version,
        ...(pendingMethod !== undefined && { pendingMethod }),
      })
    } catch {
      if (pending !== undefined || retired !== undefined) {
        pending?.reject(
          new MhpServiceError(failure(id, MHP_ERROR_CODES.invalidRequest, 'MHP_INVALID_RESULT')),
        )
        this.close(true)
        return
      }
      this.log.warn('MHP_INVALID_FRAME')
      this.emit(failure(id, MHP_ERROR_CODES.invalidRequest, 'MHP_INVALID_REQUEST'))
      return
    }
    if ('mhp' in frame) {
      if (!this.isInitialized) {
        this.emit(failure(null, MHP_ERROR_CODES.invalidRequest, 'MHP_NOT_INITIALIZED'))
        return
      }
      if (frame.kind === 'panel' || frame.kind === 'surface') this.panel(frame)
      else this.log.warn(frame.code)
      return
    }
    if ('result' in frame || 'error' in frame) {
      if (retired !== undefined && id !== null) {
        this.retired.delete(id)
        return
      }
      if (pending === undefined || id === null) {
        this.log.warn('MHP_UNCORRELATED_RESULT')
        this.close(true)
        return
      }
      this.pending.delete(id)
      if ('error' in frame) pending.reject(new MhpServiceError(frame))
      else {
        if (pending.method === 'surfaces/open') this.afterSurfaceResult()
        pending.resolve(frame)
      }
      return
    }
    const callId = 'id' in frame ? idSchema.parse(frame.id) : null
    if (frame.method === 'initialize' && 'id' in frame) {
      if (this.isInitialized || this.isInitializing) {
        this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_ALREADY_INITIALIZED'))
        return
      }
      const params = MHP_METHODS.initialize.params.parse(frame.params)
      const selected = selectMhpVersion(params.protocolRange)
      if (selected !== MHP_PANEL.version) {
        this.emit(failure(callId, MHP_ERROR_CODES.incompatibleVersion, 'MHP_INCOMPATIBLE_VERSION'))
        return
      }
      this.version = selected
      this.offered = params.capabilities
      this.isInitializing = true
      const release = this.delivery.reserve(new TextEncoder().encode(line).byteLength)
      const controller = new AbortController()
      if (callId !== null) this.incoming.set(callId, controller)
      void this.track(this.ports.initialize(params, controller.signal))
        .then(() => {
          if (this.isClosed) return
          this.emit(
            panelInitializeResultSchema.parse({
              jsonrpc: MHP.jsonRpcVersion,
              id: callId,
              result: { protocolVersion: selected, capabilities: this.ports.capabilities },
            }),
          )
          this.isInitialized = true
          this.ports.initialized?.()
        })
        .catch(() => {
          this.emit(failure(callId, MHP_ERROR_CODES.internalError, 'MHP_INITIALIZE_FAILED'))
        })
        .finally(() => {
          if (callId !== null) this.incoming.delete(callId)
          this.isInitializing = false
          release()
        })
      return
    }
    if (frame.method === '$/cancelRequest') {
      const params = MHP_METHODS['$/cancelRequest'].params.parse(frame.params)
      this.incoming.get(params.id)?.abort()
      return
    }
    if (!this.isInitialized) {
      this.emit(
        failure(
          'id' in frame ? callId : null,
          MHP_ERROR_CODES.invalidRequest,
          'MHP_NOT_INITIALIZED',
        ),
      )
      return
    }
    const definition = Object.entries(MHP_METHODS).find(([name]) => name === frame.method)?.[1]
    if (definition === undefined) return
    if (frame.method !== 'shutdown' && definition.direction === 'runtimeToHost') {
      this.emit(
        failure(
          'id' in frame ? callId : null,
          MHP_ERROR_CODES.invalidRequest,
          'MHP_WRONG_DIRECTION',
        ),
      )
      return
    }
    if (callId === null) {
      // The frozen own key and validated kind establish this union (PLAN §8).
      const method = Object.keys(MHP_METHODS).find(
        (candidate): candidate is MhpNotificationMethod =>
          candidate === frame.method && definition.kind === 'notification',
      )
      if (method !== undefined) this.ports.notify(method, frame.params)
      return
    }
    if (this.incoming.has(callId)) {
      this.emit(failure(callId, MHP_ERROR_CODES.invalidRequest, 'MHP_DUPLICATE_ID'))
      return
    }
    if (this.work.size >= MHP_PANEL.maximumQueuedMessages) {
      this.emit(failure(callId, MHP_ERROR_CODES.internalError, 'MHP_BACKPRESSURE'))
      return
    }
    // The frozen own key and validated kind establish this union (PLAN §8).
    const method = Object.keys(MHP_METHODS).find(
      (candidate): candidate is MhpRequestMethod =>
        candidate === frame.method && definition.kind === 'request',
    )
    if (method === undefined) return
    let release: () => void
    try {
      release = this.delivery.reserve(new TextEncoder().encode(line).byteLength)
    } catch {
      this.emit(failure(callId, MHP_ERROR_CODES.internalError, 'MHP_BACKPRESSURE'))
      return
    }
    const controller = new AbortController()
    this.incoming.set(callId, controller)
    void (async () => {
      try {
        const value =
          method === 'shutdown'
            ? null
            : await unlessAborted(
                this.track(this.ports.request(method, frame.params, controller.signal)),
                controller.signal,
              )
        controller.signal.throwIfAborted()
        const result = parseMhpResult(method, {
          jsonrpc: MHP.jsonRpcVersion,
          id: callId,
          result: value,
        })
        if (method === 'shutdown') {
          const deadline = setTimeout(() => {
            this.close()
          }, RUNTIME_PANEL.closeTimeoutMs)
          this.delivery.post(result, undefined, () => {
            clearTimeout(deadline)
            this.close()
          })
        } else this.emit(result)
      } catch (error: unknown) {
        this.emit(
          error instanceof MhpServiceError
            ? { ...error.frame, id: callId }
            : failure(
                callId,
                controller.signal.aborted
                  ? MHP_ERROR_CODES.cancelled
                  : MHP_ERROR_CODES.internalError,
                controller.signal.aborted ? 'MHP_CANCELLED' : 'MHP_REQUEST_FAILED',
              ),
        )
      } finally {
        this.incoming.delete(callId)
        release()
      }
    })()
  }

  /** Closing aborts admission; drain the actual adapter work, not its cancellation race. */
  public async settled(): Promise<void> {
    while (this.work.size > 0) await Promise.allSettled(this.work)
  }

  public close(isFatal = false): void {
    if (this.panelBarrier !== undefined) clearImmediate(this.panelBarrier)
    this.panelBarrier = undefined
    for (const job of this.queuedPanels.splice(0)) job.release()
    if (this.isClosed) return
    this.isClosed = true
    this.surfaces.close()
    this.delivery.close()
    for (const request of this.pending.values())
      request.reject(
        new MhpServiceError(failure(null, MHP_ERROR_CODES.cancelled, 'MHP_CONNECTION_CLOSED')),
      )
    this.pending.clear()
    this.retired.clear()
    for (const controller of this.incoming.values()) controller.abort()
    this.incoming.clear()
    this.ports.closed(isFatal)
  }
}
