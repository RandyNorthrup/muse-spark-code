// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { tasksHostMessageSchema, tasksWebviewMessageSchema } from '../../src/shared/tasksProtocol'
import { whatsNewMessageSchema } from '../../src/shared/whatsNewMessages'
import { companionBridge } from '../../src/webview/bridges/companion'
import { companionStateStore } from '../../src/webview/bridges/state'
import type { PanelCodec, PanelPayload } from '../../src/webview/bridges/types'
import { panelBridgeRig as rig, disposePanelRigs } from './helpers/panelBridgeRig'
import { hostToWebviewMessageSchema, webviewToHostMessageSchema } from '../../src/shared/protocol'
import { MHP_PANEL } from '../../src/shared/constants'
const binding = { surface: 'surface-1', sessionId: 'session-1', surfaceKind: 'chat' as const }
const chatCodec: PanelCodec = {
  outgoing: webviewToHostMessageSchema,
  incoming: hostToWebviewMessageSchema,
}
const cleanup: (() => void)[] = []
afterEach(() => {
  disposePanelRigs()
  for (const stop of cleanup.splice(0)) stop()
})

describe.each(['vscode', 'native', 'companion'] as const)('%s panel contract', (kind) => {
  it('posts chat payloads, delivers host messages once, saves state, and removes listeners', async () => {
    const { bridge, posts, receive } = rig(kind)
    const received: unknown[] = []
    const listener = (event: MessageEvent<unknown>) => {
      received.push(event.data)
    }
    bridge.messages.addEventListener('message', listener)
    bridge.post({ type: 'ready' })
    await waitFor(() => {
      expect(posts.some((p) => JSON.stringify(p).includes('ready'))).toBe(true)
    })
    bridge.saveState({ sessionId: 'session-1' })
    expect(bridge.savedState()).toEqual({ sessionId: 'session-1' })
    receive({ type: 'conversationCleared' })
    await waitFor(() => {
      expect(received).toEqual([{ type: 'conversationCleared' }])
    })
    bridge.messages.removeEventListener('message', listener)
    receive({ type: 'conversationCleared' })
    await Promise.resolve()
    expect(received).toHaveLength(1)
  })
  it('refuses another surface vocabulary before posting', () => {
    const { bridge } = rig(kind)
    expect(() => {
      bridge.post({ type: 'tasksReady' })
    }).toThrow()
  })
  it('saves optional snapshot fields with the host’s JSON semantics', () => {
    const { bridge } = rig(kind)
    bridge.saveState({ sessionId: 's', snapshot: { draft: '', goal: undefined } })
    expect(JSON.stringify(bridge.savedState())).toBe(
      JSON.stringify({
        sessionId: 's',
        snapshot: { draft: '' },
      }),
    )
  })
  it('uses the Tasks vocabulary through the same bridge', async () => {
    const codec = { outgoing: tasksWebviewMessageSchema, incoming: tasksHostMessageSchema }
    const { bridge, posts } = rig(kind, codec, { ...binding, surfaceKind: 'tasks' })
    bridge.post({ type: 'tasksReady' })
    await waitFor(() => {
      expect(JSON.stringify(posts)).toContain('tasksReady')
    })
    expect(() => {
      bridge.post({ type: 'ready' })
    }).toThrow()
  })
  it('posts every What’s New action', async () => {
    const codec: PanelCodec = { outgoing: whatsNewMessageSchema, incoming: chatCodec.incoming }
    const { bridge, posts } = rig(kind, codec, { ...binding, surfaceKind: 'whatsNew' })
    const messages: PanelPayload[] = [
      { type: 'openLink', index: 0 },
      { type: 'tryIt', index: 1 },
      { type: 'hideOnUpdate', isHidden: true },
    ]
    for (const message of messages) bridge.post(message)
    await waitFor(() => {
      expect(JSON.stringify(posts)).toContain('hideOnUpdate')
    })
  })
})

it('refuses a duplicate companion sequence and stops dispatch', async () => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      stream = controller
    },
  })
  const send: typeof fetch = (input) =>
    Promise.resolve(
      input === '/panel/events'
        ? new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
        : new Response(null, { status: 204 }),
    )
  const error = vi.fn()
  const bridge = companionBridge(
    binding,
    chatCodec,
    send,
    error,
    companionStateStore(binding.surface, window.sessionStorage),
  )
  cleanup.push(() => {
    bridge.dispose()
  })
  const frame = {
    mhp: '1.5',
    kind: 'panel',
    surface: binding.surface,
    direction: 'toPanel',
    seq: 1,
    payload: { type: 'conversationCleared' },
  }
  const encoded = new TextEncoder().encode(
    `data: ${JSON.stringify(frame)}\n\ndata: ${JSON.stringify(frame)}\n\n`,
  )
  stream?.enqueue(encoded)
  await waitFor(() => {
    expect(error).toHaveBeenCalledOnce()
  })
  expect(String(error.mock.calls[0]?.[0])).toContain('MHP_PANEL_OUT_OF_ORDER')
})

it.each(['', '\n\n'])(
  'bounds companion SSE data before parsing, including delimiter %j',
  async (ending) => {
    const { receiveRaw, errors } = rig('companion')
    receiveRaw(`data: ${'x'.repeat(MHP_PANEL.maximumEnvelopeBytes + 1)}${ending}`)
    await waitFor(() => {
      expect(errors).toHaveLength(1)
    })
    expect(String(errors[0])).toContain('MHP_PANEL_TOO_LARGE')
  },
)

it('refuses companion queue message pressure and posts after disposal', () => {
  const { bridge, posts } = rig('companion')
  for (let index = 1; index < MHP_PANEL.maximumQueuedMessages - 1; index++)
    bridge.post({ type: 'ready' })
  expect(() => {
    bridge.post({ type: 'ready' })
  }).toThrow('MHP_PANEL_BACKPRESSURE')
  expect(posts).toEqual([])
  bridge.dispose()
  expect(() => {
    bridge.post({ type: 'ready' })
  }).toThrow()
})

it('refuses a too-large companion envelope and aggregate byte pressure', () => {
  const { bridge } = rig('companion')
  const message = {
    type: 'sendMessage' as const,
    localId: 'local',
    text: 'x'.repeat(MHP_PANEL.maximumEnvelopeBytes),
    attachmentIds: [],
  }
  expect(() => {
    bridge.post(message)
  }).toThrow('MHP_PANEL_TOO_LARGE')
  const smaller = { ...message, text: message.text.slice(0, MHP_PANEL.maximumEnvelopeBytes / 2) }
  const admitted =
    Math.floor(MHP_PANEL.maximumQueuedBytes / (MHP_PANEL.maximumEnvelopeBytes / 2)) - 1
  for (let index = 0; index < admitted; index++) bridge.post(smaller)
  expect(() => {
    bridge.post(smaller)
  }).toThrow('MHP_PANEL_BACKPRESSURE')
})
