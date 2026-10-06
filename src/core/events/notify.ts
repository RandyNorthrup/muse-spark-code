import type { AgentEvent } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import type { CoreLogger } from '../logging'

/** Fixed code labels only: callback errors may contain private user data. */
type NotificationSite =
  | 'modelApi.event'
  | 'modelApi.replay'
  | 'modelApi.changed'
  | 'modelApi.disposed'
  | 'modelApi.usage'
  | 'modelApi.list'
  | 'museCode.event'
  | 'museCode.replay'
  | 'museCode.logDamaged'
  | 'museCode.disposed'
  | 'museCode.unresponsive'
  | 'museCode.exit'
  | 'museCode.usage'
  | 'museCode.list'
  | 'backend.diagnostic'

/** Public observers cannot stop a state transition or deafen later listeners. */
export function notify<T>(
  listeners: Iterable<(value: T) => void>,
  value: T,
  log: CoreLogger,
  site: NotificationSite,
  report?: (diagnostic: AgentEvent) => void,
): void {
  let hasFailed = false
  for (const listener of listeners) {
    try {
      listener(value)
    } catch {
      hasFailed = true
      try {
        log.error(`Backend notification listener failed: ${site}`)
      } catch {
        // A broken diagnostic sink cannot interrupt the owning operation either.
      }
    }
  }
  if (hasFailed && report !== undefined) {
    // Diagnostic delivery has the same guard, but never reports recursively.
    notify(
      [report],
      { type: 'backendNotice', level: 'error', text: UI_TEXT.backendListenerFailed },
      log,
      'backend.diagnostic',
    )
  }
}
