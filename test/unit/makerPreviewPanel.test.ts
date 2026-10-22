import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MakerApprovalReceipt } from '../../src/host/maker/makerApprovalReceipt'
import { MakerPreviewPanel } from '../../src/host/maker/makerPreviewPanel'
import type { ApprovalRequest } from '../../src/shared/makerProtocol'
import { MAKER_PREVIEW_VIEW_TYPE, UI_TEXT } from '../../src/shared/constants'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { window } from './mocks/vscode'

beforeEach(() => {
  window.showWarningMessage.mockReset()
  window.createWebviewPanel.mockReset()
  window.createWebviewPanel.mockImplementation((type, title, _column, options) => {
    const view = new FakeWebviewPanel(type, title)
    view.webview.options = options ?? {}
    return view
  })
})
function harness() {
  const context = fakeHostContext()
  const stop = vi.fn<(id?: string) => Promise<void>>().mockResolvedValue(undefined)
  const port = new MakerPreviewPanel({ ...context, stop })
  return { port, stop, log: context.log }
}
function panel() {
  const value = window.createWebviewPanel.mock.results.at(-1)?.value
  if (!(value instanceof FakeWebviewPanel)) throw new Error('missing fake preview')
  return value
}
const preview = {
  kind: 'payload',
  title: 'Exact bytes',
  content: '<script>G1 X1</script>',
} as const

function approval(): Extract<ApprovalRequest, { kind: 'command' }> {
  const payload = 'G1 X1\n'.repeat(34)
  return {
    kind: 'command',
    action: 'program',
    id: randomUUID(),
    digest: createHash('sha256').update(payload).digest('hex'),
    target: { kind: 'serial', port: '/dev/ttyACM0' },
    expiresAt: Date.now() + 10_000,
    payload,
  }
}
async function flush() {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
}
function rendered(input: ApprovalRequest) {
  return { v: 1, type: 'makerPreviewRendered', id: input.id, digest: input.digest }
}
function waitingApproval() {
  const { port } = harness()
  const input = approval()
  const pending = port.openApproval(input, new AbortController().signal)
  const view = panel()
  const delivery = Promise.withResolvers<boolean>()
  view.webview.postMessage.mockReturnValue(delivery.promise)
  const settled = vi.fn()
  void pending.then(settled)
  return { port, input, pending, view, delivery, settled }
}
describe('restricted maker preview tab', () => {
  it('requires both successful delivery and a matching rendered-byte acknowledgement', async () => {
    const { port, input, pending, view, delivery, settled } = waitingApproval()
    expect(settled).not.toHaveBeenCalled()
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    delivery.resolve(true)
    view.webview.messages.fire({
      v: 1,
      type: 'makerAnswer',
      answer: {
        id: input.id,
        digest: input.digest,
        target: input.target,
        decision: 'allow_once',
      },
    })
    await flush()
    expect(settled).not.toHaveBeenCalled()
    view.webview.messages.fire(rendered(input))
    expect(await pending).toMatchObject({ id: input.id, digest: input.digest })
    port.dispose()
  })
  it('does not resolve a valid rendered acknowledgement until postMessage confirms delivery', async () => {
    const { port, input, pending, view, delivery, settled } = waitingApproval()
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    view.webview.messages.fire(rendered(input))
    await flush()
    expect(settled).not.toHaveBeenCalled()
    delivery.resolve(true)
    expect(await pending).toMatchObject({ id: input.id, digest: input.digest })
    port.dispose()
  })
  it.each([
    'close',
    'abort',
    'reload',
    'stop',
    'deliveryFalse',
    'deliveryRejected',
    'ownerDispose',
  ])('cancels an approval preview on %s and ignores late acknowledgement', async (event) => {
    const { port } = harness()
    const input = approval()
    const controller = new AbortController()
    const pending = port.openApproval(input, controller.signal)
    const state = { settled: false }
    void pending.then(() => {
      state.settled = true
    })
    const view = panel()
    if (event === 'deliveryFalse') view.webview.postMessage.mockResolvedValue(false)
    else if (event === 'deliveryRejected')
      view.webview.postMessage.mockRejectedValue(new Error('failed'))
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    await flush()
    switch (event) {
      case 'close': {
        view.dispose()
        break
      }
      case 'abort': {
        controller.abort()
        break
      }
      case 'reload': {
        view.webview.messages.fire({ v: 1, type: 'makerReady' })
        break
      }
      case 'stop': {
        view.webview.messages.fire({ v: 1, type: 'makerStop' })
        break
      }
      case 'ownerDispose': {
        port.dispose()
        break
      }
      default: {
        break
      }
    }
    try {
      await flush()
      expect(state.settled).toBe(true)
      expect(await pending).toBeUndefined()
    } finally {
      port.dispose()
    }
    view.webview.messages.fire({
      v: 1,
      type: 'makerPreviewRendered',
      id: input.id,
      digest: input.digest,
    })
    port.dispose()
  })
  it.each([
    'beforeReady',
    'wrongId',
    'wrongDigest',
    'wrongVersion',
    'extraField',
    'malformed',
    'changedRendered',
    'invalidRendered',
  ])('revokes an invalid %s acknowledgement and cannot bind again', async (fault) => {
    const { port, input, pending, view, delivery, settled } = waitingApproval()
    const repeated = new AbortController()
    try {
      if (fault !== 'beforeReady') view.webview.messages.fire({ v: 1, type: 'makerReady' })
      if (fault === 'changedRendered' || fault === 'invalidRendered') {
        delivery.resolve(true)
        view.webview.messages.fire(rendered(input))
        const receipt = await pending
        if (receipt === undefined) throw new Error('missing rendered receipt')
        view.webview.messages.fire({
          ...rendered(input),
          ...(fault === 'changedRendered' ? { digest: 'b'.repeat(64) } : { v: 2 }),
        })
        expect(receipt.state).toBe('revoked')
        expect(receipt.canSend(input.id, input.digest)).toBe(false)
        expect(receipt.signal.aborted).toBe(true)
      } else {
        const ack = {
          ...rendered(input),
          ...(fault === 'wrongId' && { id: randomUUID() }),
          ...(fault === 'wrongDigest' && { digest: 'b'.repeat(64) }),
          ...(fault === 'wrongVersion' && { v: 2 }),
          ...(fault === 'extraField' && { confirm: true }),
          ...(fault === 'malformed' && { digest: 1 }),
        }
        view.webview.messages.fire(ack)
        delivery.resolve(true)
        await flush()
        expect(settled).toHaveBeenCalledOnce()
        expect(await pending).toBeUndefined()
      }
      expect(window.showWarningMessage).toHaveBeenCalledWith(UI_TEXT.makerPreviewWithdrawn)
      view.webview.messages.fire(rendered(input))
      settled.mockClear()
      void port.openApproval(input, repeated.signal).then(settled)
      await flush()
      expect(settled).toHaveBeenCalledWith(undefined)
    } finally {
      repeated.abort()
      port.dispose()
    }
  })

  it('does not replace an approval preview with a repeated id or an ordinary preview', async () => {
    const { port } = harness()
    const input = approval()
    const pending = port.openApproval(input, new AbortController().signal)
    const view = panel()
    const duplicate = new AbortController()
    const repeated = port.openApproval(input, duplicate.signal)
    const state = { settled: false }
    void repeated.then(() => {
      state.settled = true
    })
    try {
      await flush()
      expect(state.settled).toBe(true)
      expect(await repeated).toBeUndefined()
    } finally {
      duplicate.abort()
    }
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    await flush()
    view.webview.messages.fire(rendered(input))
    const receipt = await pending
    if (receipt === undefined) throw new Error('missing receipt')
    await port.open(preview)
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2)
    expect(view.webview.postMessage).toHaveBeenCalledOnce()
    expect(receipt.signal.aborted).toBe(false)
    view.dispose()
    expect(receipt.signal.aborted).toBe(true)
    port.dispose()
  })

  it('loads only the separate preview page with CSP, no command URIs, and bundle-only roots', async () => {
    const { port } = harness()
    await port.open(preview)
    const view = panel()
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      MAKER_PREVIEW_VIEW_TYPE,
      preview.title,
      -2,
      expect.objectContaining({ enableScripts: true, enableCommandUris: false }),
    )
    expect(view.webview.html).toContain('makerPreview.js')
    expect(view.webview.html).toContain('makerPreview.css')
    expect(view.webview.html).toContain("default-src 'none'")
    expect(view.webview.html).not.toContain("'unsafe-inline'")
    expect(view.webview.html).not.toContain('connect-src')
    expect(view.webview.html).not.toContain(preview.content)
    expect(view.webview.options.localResourceRoots?.map((uri) => uri.path)).toEqual([
      '/ext/dist/webview',
    ])
    expect(view.webview.postMessage).not.toHaveBeenCalled()
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    expect(view.webview.postMessage).toHaveBeenCalledWith({ v: 1, type: 'makerPreview', preview })
    port.dispose()
  })
  it('reuses the tab, replays after readiness/reload, and opens only opaque STL references', async () => {
    const { port } = harness()
    await port.open(preview)
    const first = panel()
    first.webview.messages.fire({ v: 1, type: 'makerReady' })
    const mesh = {
      kind: 'stl',
      title: 'Cube',
      artifactId: randomUUID(),
      triangles: 12,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    } as const
    await port.open(mesh)
    expect(window.createWebviewPanel).toHaveBeenCalledOnce()
    expect(first.title).toBe(mesh.title)
    expect(first.webview.postMessage).toHaveBeenLastCalledWith({
      v: 1,
      type: 'makerPreview',
      preview: mesh,
    })
    first.webview.messages.fire({ v: 1, type: 'makerReady' })
    expect(first.webview.postMessage).toHaveBeenCalledTimes(3)
    first.dispose()
    await port.open(preview)
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2)
    first.webview.messages.fire({ v: 1, type: 'makerReady' })
    expect(panel().webview.postMessage).not.toHaveBeenCalled()
    port.dispose()
  })
  it('ignores malformed, wrong-version, approval, arbitrary-path and action messages while Stop runs before readiness', async () => {
    const { port, stop } = harness()
    await port.open(preview)
    const view = panel()
    for (const raw of [
      null,
      { v: 2, type: 'makerStop' },
      { v: 1, type: 'makerStop', payload: 'G1 X1' },
      { v: 1, type: 'makerHardware', enabled: false },
      { v: 1, type: 'makerOpenPreview', artifactId: '/etc/passwd' },
      { v: 1, type: 'makerSend', id: randomUUID(), machineId: 'printer', payload: 'G1 X1' },
      { type: 'sendMessage', text: 'send' },
    ])
      view.webview.messages.fire(raw)
    expect(stop).not.toHaveBeenCalled()
    view.webview.messages.fire({ v: 1, type: 'makerStop', machineId: 'printer' })
    expect(stop).toHaveBeenCalledWith('printer')
    view.webview.messages.fire({ v: 1, type: 'makerStop' })
    expect(stop).toHaveBeenCalledWith(undefined)
    expect(view.webview.postMessage).not.toHaveBeenCalled()
    port.dispose()
    view.webview.messages.fire({ v: 1, type: 'makerStop' })
    expect(stop).toHaveBeenCalledTimes(2)
  })
  it('refuses invalid previews and owner disposal and records fixed errors only', async () => {
    const { port, stop, log } = harness()
    await expect(port.open({ ...preview, title: '' })).rejects.toThrow()
    await port.open(preview)
    const view = panel()
    stop.mockRejectedValue(new Error(randomUUID()))
    view.webview.messages.fire({ v: 1, type: 'makerStop' })
    await Promise.resolve()
    expect(log.error).toHaveBeenCalledWith('Maker preview Stop failed')
    view.webview.postMessage.mockRejectedValue(new Error(randomUUID()))
    view.webview.messages.fire({ v: 1, type: 'makerReady' })
    await Promise.resolve()
    await Promise.resolve()
    expect(log.error).toHaveBeenCalledWith('Maker preview update failed')
    port.dispose()
    await expect(port.open(preview)).rejects.toThrow()
  })
})

// Exhaust the public event table, including attempts to revive either terminal latch.
describe('maker approval receipt transition table', () => {
  const states = ['awaiting-render', 'rendered', 'decided', 'revoked'] as const
  const events = [
    'sameAck',
    'differentAck',
    'invalidAck',
    'send',
    'wrongDecision',
    'close',
    'reload',
    'stop',
    'expiry',
    'cancel',
    'ownerDispose',
  ] as const
  const transitions = {
    'awaiting-render': [
      'rendered',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
    ],
    rendered: [
      'rendered',
      'revoked',
      'revoked',
      'decided',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
      'revoked',
    ],
    decided: events.map(() => 'decided'),
    revoked: events.map(() => 'revoked'),
  }
  function applyEvent(
    receipt: MakerApprovalReceipt,
    event: (typeof events)[number],
    state: (typeof states)[number],
  ): void {
    switch (event) {
      case 'sameAck': {
        receipt.rendered('id', 'digest')
        return
      }
      case 'differentAck': {
        receipt.rendered('id', 'changed')
        return
      }
      case 'send': {
        expect(receipt.decide('id', 'digest')).toBe(state === 'rendered')
        return
      }
      case 'wrongDecision': {
        expect(receipt.decide('other', 'digest')).toBe(false)
        return
      }
      case 'close': {
        receipt.dispose()
        return
      }
      default: {
        receipt.revoke()
      }
    }
  }
  it.each(states)('walks every event from %s and holds terminal latches', (state) => {
    for (const [index, event] of events.entries()) {
      const receipt = new MakerApprovalReceipt('id', 'digest', vi.fn())
      if (state !== 'awaiting-render') receipt.rendered('id', 'digest')
      if (state === 'decided') expect(receipt.decide('id', 'digest')).toBe(true)
      else if (state === 'revoked') receipt.revoke()
      applyEvent(receipt, event, state)
      const expected = transitions[state][index]
      expect(receipt.state, `${state} + ${event}`).toBe(expected)
      expect(receipt.canSend('id', 'digest')).toBe(expected === 'rendered')
      expect(receipt.signal.aborted).toBe(expected === 'revoked')
      if (expected !== 'decided' && expected !== 'revoked') continue
      receipt.rendered('id', 'digest')
      receipt.revoke()
      expect(receipt.decide('id', 'digest')).toBe(false)
      expect(receipt.state).toBe(expected)
    }
  })
})
