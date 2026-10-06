import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { TextEncoder } from 'node:util'

const source = await readFile(
  new URL('../src/main/resources/embedded.mjs', import.meta.url),
  'utf8',
)
const contract = JSON.parse(
  await readFile(
    new URL('../../../src/shared/hostApi/mhp-v1.1.schema.json', import.meta.url),
    'utf8',
  ),
)
function setup(kind = 0) {
  const sent = []
  const context = vm.createContext({
    TextEncoder,
    URL,
    MessageEvent: globalThis.MessageEvent,
    structuredClone: globalThis.structuredClone,
    dispatchEvent: (event) => event.type,
  })
  context.window = context
  vm.runInContext(source, context)
  context.window.installMuseHost(
    {
      toHost: contract.panel.envelope.oneOf[0].properties.payload.anyOf[kind],
      toPanel: contract.panel.envelope.oneOf[1].properties.payload.anyOf[kind],
      stateSchema: contract.embeddedBridge.setState.state,
      limits: contract.panel.limits,
    },
    (request, success, failure) => {
      sent.push({ request: JSON.parse(request), success, failure })
    },
  )
  return { api: context.window.museHost, receive: context.window.__museReceive, sent, context }
}

test('requires a listener and validates payloads before forwarding', () => {
  const { api, sent } = setup()
  assert.throws(() => api.postMessage({ type: 'ready' }), /MHP_PANEL_NOT_READY/)
  api.onMessage(() => null)
  assert.throws(() => api.postMessage({ type: 'invented' }), /MHP_PANEL_INVALID_PAYLOAD/)
  assert.throws(
    () => api.postMessage({ type: 'ready', apiKey: 'fixture-only' }),
    /MHP_PANEL_INVALID_PAYLOAD/,
  )
  api.postMessage({ type: 'ready' })
  assert.deepEqual(
    sent.map((item) => item.request.operation),
    ['ready', 'post'],
  )
})

test('preserves listener order, isolates mutations, and unsubscribes one listener', () => {
  const { api, receive, sent } = setup()
  const values = []
  const remove = api.onMessage((value) => {
    values.push('first')
    value.type = 'corrupted'
  })
  api.onMessage((value) => {
    values.push(value.type)
  })
  receive({ type: 'attachmentsCleared' }, 1)
  remove()
  receive({ type: 'attachmentsCleared' }, 2)
  assert.deepEqual(values, ['first', 'attachmentsCleared', 'attachmentsCleared'])
  assert.deepEqual(
    sent.filter((item) => item.request.operation === 'delivered').map((item) => item.request.value),
    [1, 2],
  )
  assert.throws(() => receive({ type: 'invented' }, 3), /MHP_PANEL_INVALID_PAYLOAD/)
})

test('enforces Tasks vocabulary and JSON-only state', () => {
  const { api } = setup(1)
  api.onMessage(() => null)
  assert.throws(() => api.postMessage({ type: 'cancelTurn' }), /MHP_PANEL_INVALID_PAYLOAD/)
  api.postMessage({ type: 'tasksReady' })
  api.setState({ selection: 'task' })
  const copy = api.getState()
  copy.selection = 'changed'
  assert.equal(api.getState().selection, 'task')
  assert.throws(
    () =>
      api.setState({
        illegal() {
          return 'not JSON'
        },
      }),
    /MHP_PANEL_INVALID_PAYLOAD/,
  )
  assert.throws(() => api.setState(Infinity), /MHP_PANEL_INVALID_PAYLOAD/)
})

test('refuses local backpressure before admitting another query', () => {
  const { api, sent } = setup()
  api.onMessage(() => null)
  for (let index = 1; index < contract.panel.limits.maximumQueuedMessages; index++)
    api.postMessage({ type: 'ready' })
  assert.throws(() => api.postMessage({ type: 'ready' }), /MHP_PANEL_BACKPRESSURE/)
  assert.equal(sent.length, contract.panel.limits.maximumQueuedMessages)
  sent[0].success()
  api.postMessage({ type: 'ready' })
})

test('compatibility serialization omits undefined while the frozen bridge stays strict', () => {
  const { api, sent, context } = setup()
  const legacy = context.acquireVsCodeApi()
  assert.throws(
    () => api.postMessage({ type: 'ready', attachmentEpoch: undefined }),
    /MHP_PANEL_INVALID_PAYLOAD/,
  )
  legacy.postMessage({ type: 'ready', attachmentEpoch: undefined })
  legacy.setState({ draft: 'kept', absent: undefined })
  assert.deepEqual(sent.at(-2).request.value, { type: 'ready' })
  assert.deepEqual(sent.at(-1).request.value, { draft: 'kept' })
})

test('bounds original UTF-8 and aggregate query bytes before dispatch', () => {
  const { api, sent } = setup()
  api.onMessage(() => null)
  assert.throws(
    () => api.setState({ draft: 'é'.repeat(contract.panel.limits.maximumEnvelopeBytes / 2) }),
    /MHP_PANEL_TOO_LARGE/,
  )
  const overLimit = 'é'.repeat(contract.panel.limits.maximumEnvelopeBytes / 2)
  assert.throws(
    () =>
      api.setState({
        draft: overLimit,
        illegal() {
          return 'not JSON'
        },
      }),
    /MHP_PANEL_TOO_LARGE/,
  )
  assert.throws(
    () => api.postMessage({ type: 'ready', overflow: overLimit }),
    /MHP_PANEL_TOO_LARGE/,
  )
  assert.throws(
    () => api.setState({ draft: 'x'.repeat(contract.panel.limits.maximumEnvelopeBytes - 28) }),
    /MHP_PANEL_TOO_LARGE/,
  )
  const almostFrame = 'x'.repeat(contract.panel.limits.maximumEnvelopeBytes - 100)
  api.setState({ draft: almostFrame })
  api.setState({ draft: almostFrame })
  assert.throws(() => api.setState({ draft: 'x'.repeat(300) }), /MHP_PANEL_BACKPRESSURE/)
  assert.equal(sent.length, 3)
  sent[1].success()
  api.setState({ draft: 'released' })
})
