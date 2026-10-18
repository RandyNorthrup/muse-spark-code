// Whether Muse Voice may record on this editor's network (M56, PLAN.md
// D43). VS Code routes an extension's WebSocket through its proxy support
// only from 1.112.0; on older versions, and on editors that route neither
// global, a configured proxy leaves the socket to Meta without a tunnel, so
// the recording would fail after the press. The host refuses those
// recordings up front instead, with the microphone's reason saying so.
//
// No `vscode` here: the host passes what it read.

import { type HTTP_PROXY_SUPPORT_MODES } from '../../shared/constants'
import type { HostRouting } from '../support/report'

/** Why Muse Voice stays off: no socket at all, or one a proxy would block. */
export type VoiceNetworkRefusal = 'noSocket' | 'proxy'

/**
 * The live `http` settings behind the socket decision: `proxySupport`
 * (`off` disables the editor's proxy support) and
 * `webSocketAdditionalSupport` (false leaves the WebSocket unrouted even
 * where the wrapper marker is installed).
 */
export interface VoiceHttpSupport {
  readonly proxySupport: (typeof HTTP_PROXY_SUPPORT_MODES)[number]
  readonly isWebSocketSupportOn: boolean
}

/**
 * The refusal for this editor's socket and proxy, or undefined when the
 * socket can go (`absent` routing is hostRouting's word for no socket). A
 * set proxy refuses an unrouted socket — and a socket the live settings
 * leave unrouted, where the wrapper marker alone still reads `routed`;
 * without a proxy the socket goes direct, as it always did.
 */
export function voiceNetworkRefusal(
  webSocketRouting: HostRouting,
  isProxySet: boolean,
  support?: VoiceHttpSupport,
): VoiceNetworkRefusal | undefined {
  if (webSocketRouting === 'absent') {
    return 'noSocket'
  }
  if (!isProxySet) {
    return undefined
  }
  if (webSocketRouting !== 'routed') {
    return 'proxy'
  }
  return support !== undefined && (support.proxySupport === 'off' || !support.isWebSocketSupportOn)
    ? 'proxy'
    : undefined
}
