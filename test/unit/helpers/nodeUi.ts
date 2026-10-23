import { webcrypto } from 'node:crypto'
import { act, within } from '@testing-library/react'
import { mountNodeWorkspace } from '../../../src/webview/node/files/main'
import { NodePageError, validatedNodePort } from '../../../src/webview/bridges/nodePort'
import type { NodeMethodName } from '../../../src/shared/hostApi/nodeMethods'
import { scriptedVerify } from './nodePageAuth'
import { scripted } from './recordCalls'

const disposers: (() => void)[] = []

export type NodeUiRespond = (method: NodeMethodName, input: unknown) => Promise<unknown>

/**
Mounts the node workspace shell on a scripted port: jsdom's crypto has no
subtle, so Web Crypto is installed first. The auth proof is fixed; every
page's own answers come from `respond`. Pair with `cleanupNodeUi`.
*/
export async function mountNodeUi(respond: NodeUiRespond) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const request = scripted<[NodeMethodName, unknown, AbortSignal], Promise<unknown>>(respond)
  const verify = scriptedVerify()
  await act(async () => {
    disposers.push(
      mountNodeWorkspace(container, {
        port: validatedNodePort({ request }),
        auth: { verify },
        workspaceId: 'repo',
        connectTerminal: () => Promise.reject(new NodePageError('unavailable')),
      }),
    )
    await Promise.resolve()
  })
  return { container, ui: within(container), request, verify }
}

/** Disposes every shell `mountNodeUi` mounted and empties the document. */
export async function cleanupNodeUi(): Promise<void> {
  await act(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await Promise.resolve()
  })
  document.body.replaceChildren()
}
