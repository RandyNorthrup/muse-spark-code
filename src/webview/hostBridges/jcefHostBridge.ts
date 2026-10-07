import type { HostBridge } from '../hostBridge'
import { nativeUsageBridge, type NativeUsagePort } from './usageBridge'

/** send is the host's JBCefJSQuery injection; replies arrive on messages. */
export function jcefHostBridge(port: NativeUsagePort): HostBridge {
  return nativeUsageBridge(port)
}
