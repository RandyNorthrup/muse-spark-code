import type { HostBridge } from '../hostBridge'
import type { WebviewState } from '../state/snapshot'
import type { UsagePageToServiceMessage } from '../../shared/usagePage'
import { checkedUsageRequest, deliverUsageReply } from './usageBridge'

/**
 * The companion bootstrap supplies its authenticated loopback RPC. It owns
 * the fragment token, route, download and confirmation policy (lane S).
 * The page itself has no URL, token, fetch or remote-network dependency.
 */
export interface HttpUsagePort {
  readonly request: (message: UsagePageToServiceMessage) => Promise<unknown>
  readonly savedState: () => unknown
  readonly saveState: (state: WebviewState) => void
}

export function httpHostBridge(port: HttpUsagePort): HostBridge {
  const messages = new EventTarget()
  // Serialize actions so a refresh cannot overtake a query or export.
  let pending = Promise.resolve()
  return {
    post: (input) => {
      const request = checkedUsageRequest(input)
      const previous = pending
      pending = (async () => {
        await previous
        try {
          const reply = await port.request(request)
          if (Array.isArray(reply))
            for (const message of reply) deliverUsageReply(messages, message)
          else deliverUsageReply(messages, reply)
        } catch {
          deliverUsageReply(messages, { type: 'usage/error', code: 'readFailed' })
        }
      })()
    },
    savedState: () => port.savedState(),
    saveState: (state) => {
      port.saveState(state)
    },
    messages,
  }
}
