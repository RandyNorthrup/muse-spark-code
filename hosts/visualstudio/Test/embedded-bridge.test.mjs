import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'

const { outputFiles } = await esbuild.build({
  entryPoints: ['hosts/visualstudio/Panel/embedded-bridge.mjs'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
})
const { install } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
function fixture(kind = 'chat', overrides = {}) {
  const posted = []
  const errors = []
  const events = []
  let receive
  const page = {
    TextEncoder: globalThis.TextEncoder,
    MessageEvent: globalThis.MessageEvent,
    dispatchEvent: (event) => {
      events.push(event)
    },
    console: {
      error: (code) => {
        errors.push(code)
      },
    },
    chrome: {
      webview: {
        postMessage: (frame) => {
          posted.push(frame)
        },
        addEventListener: (_type, handler) => {
          receive = handler
        },
      },
    },
  }
  const configuration = {
    binding: { surface: 'surface', sessionId: 'session', surfaceKind: kind },
    outgoing: 1,
    incoming: 1,
    reloaded: false,
    ...overrides,
  }
  const api = install(page, configuration)
  return { api, page, posted, errors, events, receive: (data) => receive({ data }) }
}
const envelope = (seq = 1, payload, fields = {}) => ({
  mhp: '1.5',
  kind: 'panel',
  surface: 'surface',
  direction: 'toPanel',
  seq,
  payload: payload ?? { type: 'focusInput' },
  ...fields,
})

test('installs window.museHost before page scripts and refuses unready or invalid payloads synchronously', () => {
  const f = fixture()
  assert.equal(f.page.museHost, f.api)
  assert.equal(Object.isFrozen(f.api), true)
  assert.throws(() => f.api.postMessage({ type: 'ready' }), /MHP_PANEL_NOT_READY/u)
  f.api.onMessage(() => false)
  assert.throws(() => f.api.postMessage({ type: 'invented' }), /MHP_PANEL_INVALID_PAYLOAD/u)
  f.api.postMessage({ type: 'ready' })
  assert.equal(f.posted[1].direction, 'toHost')
  assert.equal(f.posted[1].seq, 1)
  assert.equal(f.api.postMessage({ type: 'ready' }), undefined)
})
test('delivers only validated payloads in sequence and unsubscribe removes only its listener', () => {
  const f = fixture()
  const first = []
  const second = []
  const unsubscribe = f.api.onMessage((payload) => {
    first.push(payload)
  })
  f.api.onMessage((payload) => {
    second.push(payload)
  })
  for (const invalid of [
    envelope(2),
    envelope(1, { type: 'focusInput' }, { surface: 'other' }),
    envelope(1, { type: 'ready' }, { direction: 'toHost' }),
    envelope(1, { type: 'invented' }),
  ])
    f.receive(invalid)
  assert.equal(first.length, 0)
  f.receive(envelope())
  f.receive(envelope())
  unsubscribe()
  f.receive(envelope(2))
  assert.deepEqual(first, [{ type: 'focusInput' }])
  assert.deepEqual(second, [{ type: 'focusInput' }, { type: 'focusInput' }])
  assert.equal(f.posted.filter((frame) => frame.bridge === 'subscribed').length, 1)
})
test('keeps JSON state isolated from callers and rejects values JSON cannot retain', () => {
  const f = fixture()
  assert.equal(f.api.getState(), undefined)
  const value = { history: [1, { text: 'saved' }] }
  f.api.setState(value)
  value.history[1].text = 'mutated'
  assert.equal(f.api.getState().history[1].text, 'saved')
  const returned = f.api.getState()
  returned.history[1].text = 'changed'
  assert.equal(f.api.getState().history[1].text, 'saved')
  for (const invalid of [undefined, () => false, NaN, new Date(), { nested: undefined }])
    assert.throws(() => f.api.setState(invalid))
})
test('reload restores state and sequences and suppresses the single lifecycle replay copy', () => {
  const f = fixture('chat', { reloaded: true, outgoing: 7, incoming: 9, state: { text: 'saved' } })
  const received = []
  f.api.onMessage((payload) => {
    received.push(payload)
  })
  f.api.postMessage({ type: 'ready' })
  assert.equal(f.posted.length, 1)
  f.api.postMessage({ type: 'ready' })
  assert.equal(f.posted[1].seq, 7)
  f.receive(envelope(9))
  assert.equal(received.length, 1)
  assert.equal(f.api.getState().text, 'saved')
})
test('bounds pending messages before sequence allocation and releases capacity only on native transport drain', () => {
  const f = fixture()
  f.api.onMessage(() => false)
  for (let i = 0; i < 128; i++) f.api.postMessage({ type: 'ready' })
  assert.throws(() => f.api.postMessage({ type: 'ready' }), /MHP_PANEL_BACKPRESSURE/u)
  assert.equal(f.posted.length, 129)
  f.receive({ bridge: 'drained', surface: 'other', seq: 1 })
  assert.throws(() => f.api.postMessage({ type: 'ready' }), /MHP_PANEL_BACKPRESSURE/u)
  f.receive({ bridge: 'drained', surface: 'surface', seq: 1 })
  f.api.postMessage({ type: 'ready' })
  assert.equal(f.posted.at(-1).seq, 129)
})
test('enforces serialized UTF-8 envelope and aggregate byte budgets including unknown payload fields', () => {
  const f = fixture()
  f.api.onMessage(() => false)
  assert.throws(
    () => f.api.postMessage({ type: 'ready', unknown: 'é'.repeat(8_388_608) }),
    /MHP_PANEL_TOO_LARGE/u,
  )
  const message = {
    type: 'sendMessage',
    localId: 'fixture',
    text: 'é'.repeat(8_000_000),
    attachmentIds: [],
  }
  f.api.postMessage(message)
  f.api.postMessage(message)
  assert.throws(
    () => f.api.postMessage({ ...message, text: 'é'.repeat(1_000_000) }),
    /MHP_PANEL_BACKPRESSURE/u,
  )
  assert.equal(f.posted.at(-1).seq, 2)
})
test('isolates Tasks vocabulary and handles remote errors without exposing them to payload listeners', () => {
  const f = fixture('tasks')
  const received = []
  f.api.onMessage((payload) => {
    received.push(payload)
  })
  assert.throws(
    () => f.api.postMessage({ type: 'sendMessage', localId: 'x', text: 'x', attachmentIds: [] }),
    /MHP_PANEL_INVALID_PAYLOAD/u,
  )
  f.api.postMessage({ type: 'tasksReady' })
  f.receive(envelope())
  assert.equal(received.length, 0)
  f.receive({
    mhp: '1.5',
    kind: 'panelError',
    surface: 'surface',
    seq: 1,
    code: 'MHP_PANEL_UNKNOWN_SURFACE',
  })
  assert.equal(received.length, 0)
  assert.equal(f.errors.at(-1), 'MHP_PANEL_UNKNOWN_SURFACE')
  assert.throws(() => f.api.postMessage({ type: 'tasksReady' }), /MHP_PANEL_UNKNOWN_SURFACE/u)
})
test('the frozen React compatibility adapter uses the same real museHost API', () => {
  const f = fixture()
  const api = f.page.acquireVsCodeApi()
  assert.equal(api, f.api)
  api.postMessage({ type: 'ready' })
  f.receive(envelope())
  assert.equal(f.events[0].data.type, 'focusInput')
  assert.equal(f.posted[1].payload.type, 'ready')
})
