import { companionPost, companionEvents } from '../companionChannel'
import { usageCompanionEventSchema, usageCompanionRequestSchema } from '../../shared/usageCompanion'
import type { UsageCompanionEvent } from '../../shared/usageCompanion'
import type { HttpUsagePort } from '../hostBridges/httpHostBridge'
import { USAGE_COMPANION_EVENT_BYTES } from '../../shared/constants'

/** C's launch page supplies an authenticated fetch closure; no bearer enters this bridge. */
export function companionUsagePort(): HttpUsagePort {
  let sequence = 0
  let saved: unknown
  const waiting = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  const ending = new AbortController()
  window.addEventListener(
    'pagehide',
    () => {
      ending.abort()
    },
    { once: true },
  )
  const send = async (message: unknown): Promise<void> => {
    const checked = usageCompanionRequestSchema.parse(message)
    await companionPost(checked, ending.signal)
  }
  const event = async (message: UsageCompanionEvent): Promise<void> => {
    if (message.type === 'confirm') {
      await send({
        type: 'confirm',
        id: message.id,
        count: message.count,
        approved: window.confirm(message.detail),
      })
      return
    }
    if (message.download !== undefined) {
      const file = message.download
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }))
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      URL.revokeObjectURL(url)
    }
    waiting.get(message.id)?.resolve(message.messages)
    waiting.delete(message.id)
  }
  const streamReady = Promise.withResolvers<undefined>()
  const stream = async (): Promise<void> => {
    await companionEvents({
      signal: ending.signal,
      maxBytes: USAGE_COMPANION_EVENT_BYTES,
      ready: () => {
        streamReady.resolve(undefined)
      },
      event: async (raw) => {
        await event(usageCompanionEventSchema.parse(raw))
      },
    })
  }
  void stream().catch(() => {
    const error = new Error('EPANEL_CLOSED')
    streamReady.reject(error)
    for (const request of waiting.values()) request.reject(error)
    waiting.clear()
  })
  void streamReady.promise.catch(() => {
    // Requests consume this failure; an unused page has no request to reject.
  })
  return {
    savedState: () => saved,
    saveState: (state) => {
      saved = state
    },
    request: async (message) => {
      await streamReady.promise
      sequence += 1
      const id = String(sequence)
      const reply = Promise.withResolvers<unknown>()
      waiting.set(id, reply)
      try {
        const [, messages] = await Promise.all([
          send({ type: 'request', id, message }),
          reply.promise,
        ])
        return messages
      } finally {
        waiting.delete(id)
      }
    },
  }
}
