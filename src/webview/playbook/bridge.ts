// A shared postMessage adapter for VS Code, WebView2, JCEF and the companion
// page. M104 binds these same schemas to its authenticated host API routes.
import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import {
  playbookChangeSchema,
  playbookSnapshotSchema,
  type PlaybookChange,
  type PlaybookSurfacePort,
} from '../../runtime/playbook/command'
import type { MessageSource } from '../hostBridge'

const requestId = z.int().check(z.gte(1))
export const playbookRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('playbookRead'), requestId }),
  z.strictObject({ type: z.literal('playbookChange'), requestId, change: playbookChangeSchema }),
])
export type PlaybookRequest = z.infer<typeof playbookRequestSchema>
export const playbookResponseSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('playbookState'), requestId, snapshot: playbookSnapshotSchema }),
  z.strictObject({ type: z.literal('playbookUnavailable'), requestId }),
])

/** The caller owns the transport deadline (its normal host-request timeout).
 * Dispose rejects in-flight reads/changes and removes its only listener. */
export function createPlaybookBridge(
  messages: MessageSource,
  postMessage: (message: PlaybookRequest) => void,
  timeoutMs: number,
): PlaybookSurfacePort & { dispose(): void } {
  z.int().check(z.gte(1)).parse(timeoutMs)
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
    const parsed = playbookResponseSchema.safeParse(event.data)
    if (!parsed.success) return
    const response = parsed.data
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
              ? { type: 'playbookRead', requestId: id }
              : { type: 'playbookChange', requestId: id, change },
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
