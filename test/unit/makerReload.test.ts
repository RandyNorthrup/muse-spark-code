// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { MakerApproval } from '../../src/core/maker/ports'
import { MAKER_RELOAD_STATE_KEY, PANEL_RELOAD_EVENT } from '../../src/shared/constants'
import { isMakerReloadPending, reloadPanelSurface } from '../../src/webview/reloadPanelSurface'
import { uiApproval, uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

// jsdom's location.reload is a read-only own property that never reloads
// the document; the cases below prove everything reloadPanelSurface does
// around that call (the marker, the chat event, the denial path) and let
// jsdom's real no-op reload run.
const nativeSetItem = Storage.prototype.setItem
afterEach(() => {
  sessionStorage.clear()
  Storage.prototype.setItem = nativeSetItem
})

it('reload persists only UI position before notifying chat and refetching the document', () => {
  const seen: string[] = []
  const notified = (event: Event) => {
    seen.push(event.type)
    expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBe('1')
  }
  window.addEventListener(PANEL_RELOAD_EVENT, notified)
  try {
    reloadPanelSurface()
  } finally {
    window.removeEventListener(PANEL_RELOAD_EVENT, notified)
  }
  expect(seen).toEqual([PANEL_RELOAD_EVENT])
  expect(isMakerReloadPending()).toBe(true)
  expect(isMakerReloadPending()).toBe(false)
})

it('storage denial still reloads the document and malformed stored state is consumed', () => {
  Storage.prototype.setItem = () => {
    throw new Error('Denied')
  }
  try {
    reloadPanelSurface()
  } finally {
    Storage.prototype.setItem = nativeSetItem
  }
  for (const state of ['{', '{}', 'null']) {
    sessionStorage.setItem(MAKER_RELOAD_STATE_KEY, state)
    expect(isMakerReloadPending()).toBe(false)
    expect(sessionStorage.getItem(MAKER_RELOAD_STATE_KEY)).toBeNull()
  }
})
it('large previews, approvals and JSON-expanding bytes persist only a tiny maker UI marker', () => {
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
  expect(original.posted.some((message) => message.type === 'makerAnswer')).toBe(false)
  const restored = uiBridge()
  const frames = [MAKER_UI_STATE, engine.reopen({ v: 1, type: 'makerReady' })]
  for (const frame of frames) restored.store.receive(frame)
  expect(restored.store.getState().approvals).toHaveLength(1)
  restored.store.answer(request.id, 'allow_once')
  expect(restored.posted.at(-1)).toMatchObject({
    type: 'makerAnswer',
    answer: { decision: 'reject_once' },
  })
  expect(restored.store.getState().approvals).toHaveLength(0)
  const raw = restored.posted.at(-1)
  expect(engine.answer(raw?.type === 'makerAnswer' ? raw.answer : undefined)).toBeUndefined()
  restored.store.dispose()
})
