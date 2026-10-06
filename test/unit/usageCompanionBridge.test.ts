// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { companionUsagePort } from '../../src/webview/usage/companion'
import { usageCompanionRequestSchema } from '../../src/shared/usageCompanion'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { usageState } from './helpers/usageAdapters'

const cleanup: (() => void)[] = []
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  for (const close of cleanup.splice(0)) close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function transport(reply: unknown, shouldConfirm = false) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start: (value) => {
      controller = value
    },
  })
  const push = (value: unknown) => {
    if (controller === undefined) throw new Error('missing controller')
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
  }
  const requests: ReturnType<typeof usageCompanionRequestSchema.parse>[] = []
  const fetch = vi.fn<typeof window.fetch>((input, init) => {
    if (input === '/events') return Promise.resolve(new Response(stream))
    if (input !== '/post' || typeof init?.body !== 'string') throw new Error('unexpected endpoint')
    const raw: unknown = JSON.parse(init.body)
    const request = usageCompanionRequestSchema.parse(raw)
    requests.push(request)
    if (shouldConfirm && request.type === 'request')
      push({ type: 'confirm', id: 'confirmation', count: 2, detail: 'Delete 2 records?' })
    else push(reply)
    return Promise.resolve(new Response(null, { status: 202 }))
  })
  vi.stubGlobal('fetch', fetch)
  cleanup.push(() => {
    controller?.close()
  })
  return { fetch, requests }
}
describe('usage fetch-stream bridge', () => {
  it('returns every checked service reply through the authenticated fetch closure without holding a bearer', async () => {
    const messages = [
      { type: 'usage/table', locale: 'en', table: USAGE_EN },
      { type: 'usage/state', state: usageState() },
    ]
    const t = transport({ type: 'reply', id: '1', messages })
    const port = companionUsagePort()
    expect(await port.request({ type: 'usage/ready' })).toEqual(messages)
    expect(t.fetch.mock.calls.map(([url]) => url)).toEqual(['/events', '/post'])
    for (const [, init] of t.fetch.mock.calls) {
      expect(init?.credentials).toBe('omit')
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Muse-Panel': '1' })
    }
    expect(port.savedState()).toBeUndefined()
  })
  it('answers only the received counted challenge and leaves denial explicit', async () => {
    const t = transport(
      {
        type: 'reply',
        id: '1',
        messages: [
          {
            type: 'usage/result',
            requestId: 'delete',
            action: 'deleteHistory',
            outcome: 'cancelled',
          },
        ],
      },
      true,
    )
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const port = companionUsagePort()
    await port.request({ type: 'usage/deleteHistory', requestId: 'delete' })
    expect(t.requests[1]).toEqual({
      type: 'confirm',
      id: 'confirmation',
      count: 2,
      approved: false,
    })
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith('Delete 2 records?')
  })
  it('refuses a malformed outer event rather than accepting its reply fields', async () => {
    transport({ type: 'unexpected', id: '1', messages: [] })
    const port = companionUsagePort()
    await expect(port.request({ type: 'usage/ready' })).rejects.toThrow('EPANEL_CLOSED')
  })
})
