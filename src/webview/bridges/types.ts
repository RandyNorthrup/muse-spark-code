import type * as z from 'zod/mini'
import type { panelToHostPayloadSchema } from '../../shared/hostApi/panel'
import type { MessageSource } from '../hostBridge'
import type * as Fallbacks from '../fallbacks'

export type PanelPayload = z.infer<typeof panelToHostPayloadSchema>
export interface PanelCodec {
  readonly outgoing: { parse(value: unknown): PanelPayload }
  readonly incoming: { parse(value: unknown): unknown }
}
export interface PanelBridge {
  post(message: PanelPayload): void
  savedState(): unknown
  saveState(state: unknown): void
  readonly messages: MessageSource
  /** Load the common host fallback module only when a native service is absent. */
  loadFallbacks(): Promise<typeof Fallbacks>
  dispose(): void
}

/** Documents required boot imports; bundle gates measure the running page. */
export function bootImport<T>(
  load: () => Promise<T>,
  _variant: 'both' | 'native' | 'companion' | 'tasks' = 'both',
): Promise<T> {
  return load()
}

export async function loadFallbacks() {
  return await import('../fallbacks')
}

/** Private bus: a page cannot inject messages by dispatching on window. */
export function panelMessages(codec: PanelCodec) {
  const target = new EventTarget()
  const source: MessageSource = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  return {
    source,
    receive(value: unknown) {
      target.dispatchEvent(new MessageEvent('message', { data: codec.incoming.parse(value) }))
    },
  }
}
