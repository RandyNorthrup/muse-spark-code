import { describe, expect, it, vi } from 'vitest'
import { PortableTasks } from '../../../src/host/views/portableTasks'
import { parseMhpResult } from '../../../src/shared/hostApi/protocol'
import type { HostServices } from '../../../src/shared/hostApi/methods'
import type { MhpPanelBinding } from '../../../src/shared/hostApi/panel'
import type { TasksHostMessage } from '../../../src/shared/tasksProtocol'

function fixture() {
  let currentSession = 'session'
  let serial = 0
  const requests: { method: string; params: unknown }[] = []
  const responses = new Map<string, () => Promise<unknown>>()
  const host: HostServices = {
    request: async (method, params) => {
      requests.push({ method, params })
      const custom = responses.get(method)
      let result: unknown = null
      if (custom !== undefined) result = await custom()
      else if (method === 'surfaces/open') result = { surfaceId: `tasks-${String(++serial)}` }
      return parseMhpResult(method, { jsonrpc: '2.0', id: 1, result }).result
    },
    notify: vi.fn(),
  }
  const reveal = vi.fn()
  const notice = vi.fn()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const tasks = new PortableTasks(host, () => currentSession, reveal, log, notice)
  const initial = { conversation: 'Parser', items: [{ text: 'Test', status: 'pending' }] }
  function bind(id = 'tasks-1', sessionId = 'session') {
    const binding: MhpPanelBinding = { surface: id, surfaceKind: 'tasks', sessionId }
    const view = tasks.view(binding)
    expect(view).toBeDefined()
    const messages: TasksHostMessage[] = []
    const stop = view!.subscribe((message) => {
      if (message.type === 'tasksState') messages.push(message)
    })
    return { view: view!, messages, stop }
  }
  return {
    tasks,
    requests,
    responses,
    reveal,
    notice,
    log,
    initial,
    bind,
    setSession: (id: string) => {
      currentSession = id
    },
  }
}

describe('portable Tasks ownership', () => {
  it('opens one bound tab, replays the latest state and ends without a composer', async () => {
    const f = fixture()
    await f.tasks.show(f.initial)
    const { view, messages, stop } = f.bind()
    await view.handle({ type: 'tasksReady' })
    expect(messages.at(-1)).toMatchObject({
      conversation: 'Parser',
      ended: false,
      canMoveToWindow: true,
    })
    f.tasks.update({ conversation: 'Renamed', items: [{ text: 'Done', status: 'completed' }] })
    await view.handle({ type: 'tasksReady' })
    expect(messages.at(-1)?.items[0]?.text).toBe('Done')
    await view.handle({ type: 'revealConversation' })
    expect(f.reveal).toHaveBeenCalledOnce()
    f.tasks.ended()
    f.tasks.update(f.initial)
    await view.handle({ type: 'revealConversation' })
    expect(f.reveal).toHaveBeenCalledOnce()
    expect(messages.at(-1)).toMatchObject({
      conversation: 'Renamed',
      ended: true,
      canMoveToWindow: false,
    })
    stop()
    await f.tasks.dispose()
    expect(f.requests.at(-1)).toEqual({
      method: 'surfaces/close',
      params: { surfaceId: 'tasks-1' },
    })
  })

  it('refuses other identities and chat commands; user close permits a fresh open', async () => {
    const f = fixture()
    await f.tasks.show(f.initial)
    for (const binding of [
      { surface: 'foreign', surfaceKind: 'tasks', sessionId: 'session' },
      { surface: 'tasks-1', surfaceKind: 'tasks', sessionId: 'foreign' },
      { surface: 'tasks-1', surfaceKind: 'chat', sessionId: 'session' },
    ] satisfies MhpPanelBinding[])
      expect(f.tasks.view(binding)).toBeUndefined()
    const { view } = f.bind()
    await expect(
      view.handle({ type: 'sendMessage', text: 'unsafe', localId: 'x', attachmentIds: [] }),
    ).rejects.toThrow()
    f.tasks.closed('foreign')
    await f.tasks.show(f.initial)
    expect(f.requests.at(-1)?.method).toBe('surfaces/focus')
    f.tasks.closed('tasks-1')
    await expect(view.handle({ type: 'tasksReady' })).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    await f.tasks.show(f.initial)
    f.bind('tasks-2')
    await f.tasks.dispose()
  })

  it('coalesces concurrent opens and closes a late acquisition during release', async () => {
    const f = fixture()
    const { promise, resolve } = Promise.withResolvers<unknown>()
    f.responses.set('surfaces/open', () => promise)
    const first = f.tasks.show(f.initial)
    const second = f.tasks.show({ ...f.initial, conversation: 'Latest' })
    const closing = f.tasks.dispose()
    expect(f.tasks.dispose()).toBe(closing)
    resolve({ surfaceId: 'late' })
    await Promise.all([first, second, closing])
    expect(f.requests.filter((request) => request.method === 'surfaces/open')).toHaveLength(1)
    expect(f.requests.at(-1)).toEqual({ method: 'surfaces/close', params: { surfaceId: 'late' } })
    expect(
      f.tasks.view({ surface: 'late', surfaceKind: 'tasks', sessionId: 'session' }),
    ).toBeUndefined()
    await expect(f.tasks.show(f.initial)).rejects.toThrow('MHP_PRESENTATION_DISPOSED')
  })

  it('retires old session bindings and never adopts a stale acquisition', async () => {
    const f = fixture()
    await f.tasks.show(f.initial)
    const { view } = f.bind()
    f.setSession('next')
    await expect(view.handle({ type: 'tasksReady' })).rejects.toThrow('MHP_PANEL_UNKNOWN_SURFACE')
    await f.tasks.show(f.initial)
    f.bind('tasks-2', 'next')
    await f.tasks.dispose()
  })

  it('closes an acquisition made for a replaced session before show completes', async () => {
    const f = fixture()
    const opened = Promise.withResolvers<unknown>()
    const closed = Promise.withResolvers<unknown>()
    f.responses.set('surfaces/open', () => opened.promise)
    f.responses.set('surfaces/close', () => closed.promise)
    let hasShown = false
    const showing = (async () => {
      await f.tasks.show(f.initial)
      hasShown = true
    })()
    f.setSession('next')
    opened.resolve({ surfaceId: 'stale' })
    await vi.waitFor(() => {
      expect(f.requests.at(-1)?.method).toBe('surfaces/close')
    })
    expect(hasShown).toBe(false)
    closed.resolve(null)
    await showing
    expect(
      f.tasks.view({ surface: 'stale', surfaceKind: 'tasks', sessionId: 'session' }),
    ).toBeUndefined()
    await f.tasks.dispose()
  })

  it('moves with a fresh binding, preserving latest state and exposing errors', async () => {
    const f = fixture()
    await f.tasks.show(f.initial)
    const { view } = f.bind()
    await view.handle({ type: 'moveTasksToWindow' })
    expect(f.requests).toContainEqual({
      method: 'surfaces/open',
      params: { kind: 'tasks', placement: 'window', sessionId: 'session' },
    })
    expect(f.requests.at(-1)).toEqual({
      method: 'surfaces/close',
      params: { surfaceId: 'tasks-1' },
    })
    const moved = f.bind('tasks-2')
    await moved.view.handle({ type: 'tasksReady' })
    expect(moved.messages.at(-1)?.items[0]?.text).toBe('Test')
    f.responses.set('surfaces/open', () => Promise.reject(new Error('private path')))
    await moved.view.handle({ type: 'moveTasksToWindow' })
    expect(f.notice).toHaveBeenCalledOnce()
    expect(f.log.warn).toHaveBeenCalledWith('MHP_TASKS_MOVE_FAILED')
    expect(JSON.stringify(f.log.warn.mock.calls)).not.toContain('private path')
    await f.tasks.dispose()
  })

  it('retains a failed close for release and rejects incomplete cleanup', async () => {
    const f = fixture()
    await f.tasks.show(f.initial)
    const { view } = f.bind()
    f.responses.set('surfaces/close', () => Promise.reject(new Error('private close failure')))
    await view.handle({ type: 'moveTasksToWindow' })
    await expect(f.tasks.dispose()).rejects.toThrow('MHP_TASKS_CLOSE_FAILED')
    expect(f.requests.filter((request) => request.method === 'surfaces/close')).toHaveLength(3)
    expect(JSON.stringify(f.log.warn.mock.calls)).not.toContain('private close failure')
  })
})
