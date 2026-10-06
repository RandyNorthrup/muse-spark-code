import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MakerPreviewPanel } from '../../src/host/maker/makerPreviewPanel'
import { MAKER_PREVIEW_VIEW_TYPE } from '../../src/shared/constants'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { window } from './mocks/vscode'

beforeEach(() => {
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

describe('restricted maker preview tab', () => {
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
