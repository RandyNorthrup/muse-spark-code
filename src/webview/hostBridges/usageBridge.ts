import {
  parseUsagePageToServiceMessage,
  parseUsageServiceToPageMessage,
  type UsagePageToServiceMessage,
} from '../../shared/usagePage'
import type { HostBridge, MessageSource } from '../hostBridge'
import type { WebviewState } from '../state/snapshot'

/** Native hosts inject their real query/function and message delivery here. */
export interface NativeUsagePort {
  readonly send: (json: string) => void
  readonly messages: MessageSource
  readonly savedState: () => unknown
  readonly saveState: (state: WebviewState) => void
}

export function checkedUsageRequest(input: unknown): UsagePageToServiceMessage {
  const parsed = parseUsagePageToServiceMessage(input)
  if (!parsed.ok) throw new TypeError('Invalid usage request')
  return parsed.message
}

/** JSON from JCEF/SWT and structured WebView2/HTTP replies use the same guard. */
export function deliverUsageReply(messages: EventTarget, input: unknown): void {
  let raw: unknown = input
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = undefined
    }
  }
  const parsed = parseUsageServiceToPageMessage(raw)
  const data = parsed.ok ? parsed.message : { type: 'usage/error', code: 'invalidMessage' }
  messages.dispatchEvent(new MessageEvent('message', { data }))
}

/** The host owns persistence; this adapter does not acquire another host's API. */
export function nativeUsageBridge(port: NativeUsagePort): HostBridge {
  return {
    post: (message) => {
      port.send(JSON.stringify(checkedUsageRequest(message)))
    },
    savedState: () => port.savedState(),
    saveState: (state) => {
      port.saveState(state)
    },
    messages: port.messages,
  }
}
