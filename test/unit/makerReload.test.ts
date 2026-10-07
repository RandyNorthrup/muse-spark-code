// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { MakerApproval } from '../../src/core/maker/ports'
import { MAKER_RELOAD_STATE_KEY, PANEL_RELOAD_EVENT } from '../../src/shared/constants'
import { isMakerReloadPending, reloadPanelSurface } from '../../src/webview/reloadPanelSurface'
import { uiApproval, uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reload persists only UI position before notifying chat and refetching the document', () => {
  const reload = vi.fn()
  const dispatched = vi.fn((event: Event) => {
    expect(event.type).toBe(PANEL_RELOAD_EVENT)
    expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBe('1')
  })
  vi.stubGlobal('window', { dispatchEvent: dispatched, location: { reload } })
  reloadPanelSurface()
  expect(dispatched).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(isMakerReloadPending()).toBe(true)
  expect(isMakerReloadPending()).toBe(false)
})

it('storage denial still reloads the document and malformed stored state is consumed', () => {
  const reload = vi.fn()
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { reload } })
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied')
  })
  reloadPanelSurface()
  expect(reload).toHaveBeenCalledOnce()
  failure.mockRestore()
  for (const state of ['{', '{}', 'null']) {
    sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, state)
    expect(isMakerReloadPending()).toBe(false)
    expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBeNull()
  }
})
it('large previews, approvals and JSON-expanding bytes persist only a tiny maker UI marker', () => {
  const reload = vi.fn()
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { reload } })
  const content = '\0'.repeat(400_000)
  const { store } = uiBridge()
  store.receive(MAKER_UI_STATE)
  store.receive({
    v: 1,
    type: 'makerPreview',
    preview: { kind: 'payload', title: 'Large', content },
  })
  store.receive({ v: 1, type: 'makerApproval', request: { ...uiApproval(), payload: content } })
  expect(store.getState().approvals).toHaveLength(1)
  reloadPanelSurface()
  expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBe('1')
  expect(reload).toHaveBeenCalledOnce()
  store.dispose(false)
})

it('reload re-fetches the host request and clears every review confirmation and grant', () => {
  const original = uiBridge()
  const request = { ...uiApproval(), expiresAt: Date.now() + 60_000 }
  original.store.receive(MAKER_UI_STATE)
  original.store.receive({ v: 1, type: 'makerApproval', request })
  original.store.previewRendered(request.id, request.digest)
  original.store.reviewCompleted(request.id, request.digest)
  const engine = new MakerApproval(request, () => true)
  expect(
    engine.review({
      v: 1,
      type: 'makerPayloadReviewed',
      id: request.id,
      digest: request.digest,
      isComplete: true,
    }),
  ).toBe(true)
  original.store.dispose(false)
  expect(original.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'makerAnswer' }))
  const restored = uiBridge()
  const frames = [MAKER_UI_STATE, engine.reopen({ v: 1, type: 'makerReady' })]
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
  const raw = restored.post.mock.calls.at(-1)?.[0]
  expect(engine.answer(raw?.type === 'makerAnswer' ? raw.answer : undefined)).toBeUndefined()
  restored.store.dispose()
})
