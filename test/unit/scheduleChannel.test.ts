// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCHEDULE_POLL_INTERVAL_MS, SCHEDULE_PROTOCOL_VERSION } from '../../src/shared/constants'
import type { ScheduleWebviewMessage } from '../../src/shared/scheduleProtocol'
import { scheduleChannel } from '../../src/webview/schedules/channel'

afterEach(() => {
  vi.useRealTimers()
})
function channel() {
  const post = vi.fn<(message: ScheduleWebviewMessage) => void>()
  const instance = scheduleChannel(window, post)
  return { ...instance, post }
}
function send(requestId: string, version: number = SCHEDULE_PROTOCOL_VERSION, response?: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'schedulesResponse',
        version,
        requestId,
        response: response ?? { kind: 'accepted' },
      },
    }),
  )
}

describe('schedule versioned channel', () => {
  it('correlates concurrent requests and ignores wrong ids, versions and malformed settlements', async () => {
    const instance = channel()
    const first = instance.request({ method: 'schedules/list', workspaceKey: 'workspace' })
    const second = instance.request({
      method: 'schedules/runNow',
      workspaceKey: 'workspace',
      id: 'schedule',
    })
    const id = instance.post.mock.calls[0]?.[0].requestId ?? ''
    const secondId = instance.post.mock.calls[1]?.[0].requestId ?? ''
    expect(id).not.toBe(secondId)
    expect(instance.post.mock.calls[0]?.[0]).toMatchObject({ version: 1, type: 'schedulesRequest' })
    const settled = vi.fn()
    void first.then(settled)
    send(id, 2)
    send(id, 1, { kind: 'list', schedules: [{ id: 'broken' }] })
    send('other')
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    send(secondId)
    await expect(second).resolves.toEqual({ kind: 'accepted' })
    send(id, 1, { kind: 'list', schedules: [] })
    await expect(first).resolves.toEqual({ kind: 'list', schedules: [] })
    instance.dispose()
  })

  it('refuses invalid outbound payloads without posting, and settles pending work on close', async () => {
    const instance = channel()
    await expect(
      instance.request({ method: 'schedules/list', workspaceKey: '../escape' }),
    ).rejects.toThrow()
    expect(instance.post).not.toHaveBeenCalled()
    const pending = instance.request({ method: 'schedules/list', workspaceKey: 'workspace' })
    const rejection = expect(pending).rejects.toThrow()
    instance.dispose()
    await rejection
    await expect(
      instance.request({ method: 'schedules/list', workspaceKey: 'workspace' }),
    ).rejects.toThrow()
    expect(instance.post).toHaveBeenCalledTimes(1)
  })

  it('times out a vanished host and removes the pending request', async () => {
    vi.useFakeTimers()
    const instance = channel()
    const pending = instance.request({ method: 'schedules/list', workspaceKey: 'workspace' })
    const rejection = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(SCHEDULE_POLL_INTERVAL_MS)
    await rejection
    send(instance.post.mock.calls[0]?.[0].requestId ?? '')
    instance.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles a synchronous transport failure and cleans up its timer', async () => {
    vi.useFakeTimers()
    const instance = scheduleChannel(window, () => {
      throw new Error('Transport closed')
    })
    await expect(
      instance.request({ method: 'schedules/list', workspaceKey: 'workspace' }),
    ).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    instance.dispose()
  })
  it('publishes only validated schedule changes independently of pending responses', async () => {
    const instance = channel()
    const listener = vi.fn()
    const unsubscribe = instance.subscribeChanges(listener)
    const pending = instance.request({ method: 'schedules/list', workspaceKey: 'workspace' })
    const change = {
      type: 'scheduleChanged',
      version: SCHEDULE_PROTOCOL_VERSION,
      workspaceKey: 'workspace',
      revision: 1,
    }
    window.dispatchEvent(new MessageEvent('message', { data: { ...change, revision: -1 } }))
    window.dispatchEvent(new MessageEvent('message', { data: { ...change, version: 2 } }))
    expect(listener).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { data: change }))
    expect(listener).toHaveBeenCalledWith(change)
    send(instance.post.mock.calls[0]?.[0].requestId ?? '', 1, { kind: 'list', schedules: [] })
    await expect(pending).resolves.toEqual({ kind: 'list', schedules: [] })
    unsubscribe()
    window.dispatchEvent(new MessageEvent('message', { data: change }))
    expect(listener).toHaveBeenCalledOnce()
    instance.dispose()
  })
})
