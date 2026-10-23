import type { NodePageAuthPort } from '../../../src/webview/node/git/network'
import { scripted } from './recordCalls'

/** The page step-up proof with fixed ids: every page test verifies against it. */
export function scriptedVerify() {
  return scripted<Parameters<NodePageAuthPort['verify']>, ReturnType<NodePageAuthPort['verify']>>(
    (action, actionDigest) =>
      Promise.resolve({
        id: 'proof',
        sessionId: 'session',
        action,
        actionDigest,
        verifiedAt: 1,
        expiresAt: 2,
      }),
  )
}
