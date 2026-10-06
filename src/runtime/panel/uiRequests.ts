import type * as z from 'zod/mini'
import { MHP, MHP_PANEL, RUNTIME_PANEL } from '../../shared/constants'
import { MHP_METHODS, type MhpParams, type MhpResult } from '../../shared/hostApi/methods'
import {
  fallbackUiCallSchema,
  fallbackUiReplySchema,
  type FallbackUiMethod,
} from '../../shared/hostApi/fallbackUi'
import { parseMhpResult } from '../../shared/hostApi/protocol'
import type { idSchema } from '../../shared/hostApi/data'
import { PanelDelivery } from './delivery'

type Id = z.infer<typeof idSchema>

/** One authenticated window owns each correlation, never another window's result. */
export class PanelUiRequests {
  private currentDelivery: PanelDelivery
  private readonly pending = new Map<
    Id,
    { method: FallbackUiMethod; resolve(value: unknown): void; reject(error: unknown): void }
  >()
  private nextId = 1
  private readonly retired = new Map<Id, FallbackUiMethod>()
  private connected = false
  public constructor(private readonly budget?: PanelDelivery) {
    this.currentDelivery = new PanelDelivery(budget)
  }
  public get delivery(): PanelDelivery {
    return this.currentDelivery
  }
  public get isConnected(): boolean {
    return this.connected
  }

  public connect(emit: (message: unknown, complete?: () => void) => void): () => void {
    if (this.connected) throw new Error('MHP_UI_ALREADY_CONNECTED')
    this.connected = true
    this.delivery.connect((line, complete) => {
      emit(fallbackUiCallSchema.parse(JSON.parse(line)), complete)
      return true
    })
    return () => {
      this.close()
      this.currentDelivery = new PanelDelivery(this.budget)
    }
  }
  public receive(value: unknown): void {
    const frame = fallbackUiReplySchema.parse(value)
    const pending = frame.id === null ? undefined : this.pending.get(frame.id)
    if (pending === undefined) {
      const method = frame.id === null ? undefined : this.retired.get(frame.id)
      if (method === undefined) throw new Error('MHP_UI_UNCORRELATED_RESULT')
      if (!('error' in frame)) parseMhpResult(method, frame)
      if (frame.id !== null) this.retired.delete(frame.id)
      return
    }
    if (frame.id !== null) this.pending.delete(frame.id)
    if ('error' in frame) pending.reject(new Error('MHP_UI_FAILED'))
    else {
      try {
        pending.resolve(parseMhpResult(pending.method, frame).result)
      } catch (error: unknown) {
        pending.reject(error)
        throw new Error('MHP_UI_INVALID_RESULT', { cause: error })
      }
    }
  }
  public async request<M extends FallbackUiMethod>(
    method: M,
    params: MhpParams<M>,
    signal?: AbortSignal,
  ): Promise<MhpResult<M>> {
    if (!this.connected) throw new Error('MHP_UI_DISCONNECTED')
    MHP_METHODS[method].params.parse(params)
    const combined =
      signal === undefined
        ? AbortSignal.timeout(RUNTIME_PANEL.requestTimeoutMs)
        : AbortSignal.any([signal, AbortSignal.timeout(RUNTIME_PANEL.requestTimeoutMs)])
    combined.throwIfAborted()
    const id = `ui-${String(this.nextId++)}`
    const release = this.delivery.reserve(
      new TextEncoder().encode(JSON.stringify(params)).byteLength,
    )
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
    })
    const abort = () => {
      const waiting = this.pending.get(id)
      if (waiting === undefined) return
      waiting.reject(new Error('MHP_UI_CANCELLED'))
      this.pending.delete(id)
      if (this.retired.size >= MHP_PANEL.maximumQueuedMessages) {
        this.close()
        return
      }
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
    combined.addEventListener('abort', abort, { once: true })
    try {
      this.delivery.post({ jsonrpc: MHP.jsonRpcVersion, id, method, params })
      const value = await result
      return parseMhpResult(method, { jsonrpc: MHP.jsonRpcVersion, id, result: value }).result
    } finally {
      combined.removeEventListener('abort', abort)
      this.pending.delete(id)
      release()
    }
  }
  public close(): void {
    this.connected = false
    for (const pending of this.pending.values()) pending.reject(new Error('MHP_UI_DISCONNECTED'))
    this.pending.clear()
    this.retired.clear()
    this.delivery.close()
  }
}
