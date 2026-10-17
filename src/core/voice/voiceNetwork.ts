// Whether Muse Voice may record on this editor's network (M56, PLAN.md
// D43). VS Code routes an extension's WebSocket through its proxy support
// only from 1.112.0; on older versions, and on editors that route neither
// global, a configured proxy leaves the socket to Meta without a tunnel, so
// the recording would fail after the press. The host refuses those
// recordings up front instead, with the microphone's reason saying so.
//
// No `vscode` here: the host passes what it read.

import type { HostRouting } from '../support/report'

/** Why Muse Voice stays off: no socket at all, or one a proxy would block. */
export type VoiceNetworkRefusal = 'noSocket' | 'proxy'

/**
 * The refusal for this editor's socket and proxy, or undefined when the
 * socket can go. A set proxy refuses only an unrouted socket; without one
 * the socket goes direct, as it always did.
 */
export function voiceNetworkRefusal(
  hasWebSocket: boolean,
  webSocketRouting: HostRouting,
  isProxySet: boolean,
): VoiceNetworkRefusal | undefined {
  if (!hasWebSocket) {
    return 'noSocket'
  }
  return webSocketRouting !== 'routed' && isProxySet ? 'proxy' : undefined
}
