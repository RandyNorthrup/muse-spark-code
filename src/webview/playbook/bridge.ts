// A shared postMessage adapter for VS Code, WebView2, JCEF and the companion
// page. M104 binds these same schemas to its authenticated host API routes.
import * as z from 'zod/mini'
import { PLAYBOOK_BRIDGE_ID_BYTES, PLAYBOOK_ID_MAX_CHARS, UI_TEXT } from '../../shared/constants'
import type { PlaybookChange, PlaybookSurfacePort } from '../../runtime/playbook/command'
import {
  playbookRequestSchema,
  playbookResponseSchema,
  type PlaybookRequest,
} from '../../runtime/playbook/panelWire'
import type { MessageSource } from '../hostBridge'

export { playbookRequestSchema } from '../../runtime/playbook/panelWire'

const workspace = z.string().check(z.trim(), z.minLength(1), z.maxLength(PLAYBOOK_ID_MAX_CHARS))

/** The caller owns the transport deadline (its normal host-request timeout).
 * Dispose rejects in-flight reads/changes and removes its only listener.
 * `unwrap` takes a host's envelope off a message before it is parsed. */
export function createPlaybookBridge(
  messages: MessageSource,
  postMessage: (message: PlaybookRequest) => void,
  timeoutMs: number,
  workspaceId: string,
  unwrap: (data: unknown) => unknown = (data) => data,
): PlaybookSurfacePort & { dispose(): void } {
  z.int().check(z.gte(1)).parse(timeoutMs)
  const bridgeId = btoa(
    String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(PLAYBOOK_BRIDGE_ID_BYTES))),
  )
  const lifetime = { bridgeId, workspaceId: workspace.parse(workspaceId) }
  let sequence = 0
  let isDisposed = false
  const pending = new Map<
    number,
    {
      resolve: (snapshot: unknown) => void
      reject: () => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const receive = (event: MessageEvent<unknown>) => {
    if (isDisposed) return
    const parsed = playbookResponseSchema.safeParse(unwrap(event.data))
    if (!parsed.success) return
    const response = parsed.data
    if (response.bridgeId !== lifetime.bridgeId || response.workspaceId !== lifetime.workspaceId)
      return
    const request = pending.get(response.requestId)
    if (request === undefined) return
    pending.delete(response.requestId)
    clearTimeout(request.timer)
    if (response.type === 'playbookState') request.resolve(response.snapshot)
    else request.reject()
  }
  messages.addEventListener('message', receive)
  const request = (change?: PlaybookChange): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const fail = () => {
        reject(new Error(UI_TEXT.playbookUnavailable))
      }
      if (isDisposed) {
        fail()
        return
      }
      sequence += 1
      const id = sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        fail()
      }, timeoutMs)
      pending.set(id, { resolve, reject: fail, timer })
      try {
        postMessage(
          playbookRequestSchema.parse(
            change === undefined
              ? { type: 'playbookRead', ...lifetime, requestId: id }
              : { type: 'playbookChange', ...lifetime, requestId: id, change },
          ),
        )
      } catch {
        clearTimeout(timer)
        pending.delete(id)
        fail()
      }
    })
  return {
    read: () => request(),
    change: (change) => request(change),
    dispose: () => {
      isDisposed = true
      messages.removeEventListener('message', receive)
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject()
      }
      pending.clear()
    },
  }
}
