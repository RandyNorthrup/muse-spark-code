import type { HostBridge } from '../hostBridge'
import { nativeUsageBridge, type NativeUsagePort } from './usageBridge'

/** send calls the host's BrowserFunction; no Java or editor API leaks into React. */
export function swtHostBridge(port: NativeUsagePort): HostBridge {
  return nativeUsageBridge(port)
}
