import { parseHostToWebviewMessage, type WebviewToHostMessage } from '../../shared/protocol'
import { UI_TEXT } from '../../shared/constants'

/** One pending-response registry per mounted surface; closing rejects late actions. */
export function sharingRpc(post: (message: WebviewToHostMessage) => void) {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  let isOpen = false
  const receive = (event: MessageEvent<unknown>) => {
    const parsed = parseHostToWebviewMessage(event.data)
    if (!parsed.ok || parsed.message.type !== 'sharingResult') return
    const message = parsed.message
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (message.error === undefined) waiter?.resolve(message.value)
    else waiter?.reject(new Error(message.error))
  }
  return {
    open: () => {
      isOpen = true
      window.addEventListener('message', receive)
    },
    ask: (action: string, payload: unknown = {}): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (!isOpen) {
          reject(new Error(UI_TEXT.shareCancelled))
          return
        }
        const id = crypto.randomUUID()
        pending.set(id, { resolve, reject })
        post({ type: 'sharingAction', id, action, payload })
      }),
    close: () => {
      isOpen = false
      window.removeEventListener('message', receive)
      for (const waiter of pending.values()) waiter.reject(new Error(UI_TEXT.shareCancelled))
      pending.clear()
      post({ type: 'sharingAction', id: crypto.randomUUID(), action: 'invalidate', payload: {} })
    },
  }
}
