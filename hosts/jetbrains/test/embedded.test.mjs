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
function setup(kind = 0, toHost = contract.panel.envelope.oneOf[0].properties.payload.anyOf[kind]) {
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
      toHost,
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

test('uses only the seven reviewed panel/state pattern literals and keeps their verdicts', () => {
  const cases = [
    [String.raw`^[\w-][\w.-]*$`, 'skill-name_2.md', '../outside'],
    [
      String.raw`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))$`,
      '2024-02-29',
      '2023-02-29',
    ],
    [String.raw`^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$`, '0.000001', '1.0'],
    [String.raw`^[^\s\-\p{Cc}][^\s\p{Cc}]*$`, 'Personal-key', ' key'],
    ['^(?!meta$)[a-z][a-z0-9-]{0,31}$', 'openai', 'meta'],
    ['^[a-f0-9]{64}$', 'a'.repeat(64), 'A'.repeat(64)],
    ['^[a-z][a-z0-9-]{0,31}$', 'meta', 'Meta'],
  ]
  const patterns = new Set()
  const collect = (value) => {
    if (typeof value !== 'object' || value === null) return
    if (value.pattern !== undefined) patterns.add(value.pattern)
    for (const child of Object.values(value)) collect(child)
  }
  collect(contract.panel)
  collect(contract.embeddedBridge)
  assert.deepEqual(patterns, new Set(cases.map(([pattern]) => pattern)))
  for (const [pattern, accepted, refused] of cases) {
    const { api, sent } = setup(0, { type: 'string', pattern })
    api.onMessage(() => null)
    api.postMessage(accepted)
    assert.throws(() => api.postMessage(refused), /MHP_PANEL_INVALID_PAYLOAD/u)
    assert.equal(sent.at(-1).request.value, accepted)
  }
})

test('refuses unknown schema regex source instead of compiling or dispatching it', () => {
  for (const pattern of ['^(a+)+$', '[', '']) {
    const { api, sent } = setup(0, { type: 'string', pattern })
    api.onMessage(() => null)
    assert.throws(() => api.postMessage('aaa'), /MHP_SCHEMA_UNSUPPORTED/u)
    assert.equal(sent.length, 1)
  }
})

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

test('closed inputs refuse every unknown member while JSON state keeps arbitrary entries', () => {
  const { api } = setup()
  api.onMessage(() => null)
  for (const field of ['apiKey', 'token', 'unrelated'])
    assert.throws(
      () => api.postMessage({ type: 'ready', [field]: 'fixture-only' }),
      /MHP_PANEL_INVALID_PAYLOAD/,
    )
  api.setState({ unrelated: { nested: true } })
  assert.deepEqual(globalThis.structuredClone(api.getState()), { unrelated: { nested: true } })
})

test('exclusive numeric bounds reject their endpoints before dispatch', () => {
  const { context } = setup()
  for (const value of [-1, 0, 2, 3])
    assert.equal(
      vm.runInContext(
        `matches({type:'number',readOnly:true,exclusiveMinimum:0,exclusiveMaximum:2},${value})`,
        context,
      ),
      false,
    )
  assert.equal(
    vm.runInContext(
      "matches({type:'number',readOnly:true,exclusiveMinimum:0,exclusiveMaximum:2},1)",
      context,
    ),
    true,
  )
})
