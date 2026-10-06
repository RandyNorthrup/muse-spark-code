// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MAKER_RELOAD_STATE_KEY, PANEL_RELOAD_EVENT } from '../../src/shared/constants'
import { makerReloadMessages, reloadPanelSurface } from '../../src/webview/reloadPanelSurface'
import { uiApproval, uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reload persists pending frames before notifying chat and refetching the document', () => {
  const reload = vi.fn()
  const dispatched = vi.fn((event: Event) => {
    expect(event.type).toBe(PANEL_RELOAD_EVENT)
    expect(JSON.parse(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY) ?? 'null')).toEqual([
      MAKER_UI_STATE,
    ])
  })
  vi.stubGlobal('window', { dispatchEvent: dispatched, location: { reload } })
  reloadPanelSurface([MAKER_UI_STATE])
  expect(dispatched).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(makerReloadMessages()).toEqual([MAKER_UI_STATE])
  expect(makerReloadMessages()).toEqual([])
})

it('storage denial still reloads the document and malformed stored state is consumed', () => {
  const reload = vi.fn()
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { reload } })
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied')
  })
  reloadPanelSurface([MAKER_UI_STATE])
  expect(reload).toHaveBeenCalledOnce()
  failure.mockRestore()
  for (const state of ['{', '{}', 'null']) {
    sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, state)
    expect(makerReloadMessages()).toEqual([])
    expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBeNull()
  }
})

it('reload retains request state but clears every review confirmation and grant', () => {
  const original = uiBridge()
  const request = { ...uiApproval(), expiresAt: Date.now() + 60_000 }
  original.store.receive(MAKER_UI_STATE)
  original.store.receive({ v: 1, type: 'makerApproval', request })
  original.store.previewRendered(request.id, request.digest)
  original.store.reviewCompleted(request.id, request.digest)
  const frames = original.store.reloadMessages()
  expect(frames).toHaveLength(2)
  original.store.dispose(false)
  expect(original.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'makerAnswer' }))
  const restored = uiBridge()
  for (const frame of frames) restored.store.receive(frame)
  expect(restored.store.getState().approvals).toHaveLength(1)
  restored.store.answer(request.id, 'allow_once')
  expect(restored.post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'makerAnswer',
      answer: expect.objectContaining({ decision: 'reject_once' }),
    }),
  )
  expect(restored.store.getState().approvals).toHaveLength(0)
  restored.store.dispose()
})
