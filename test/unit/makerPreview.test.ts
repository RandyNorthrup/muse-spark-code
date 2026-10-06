// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAKER_PREVIEW_MAX_COORDINATE,
  MAKER_PREVIEW_MAX_TRIANGLES,
  MAKER_TRIANGLE_COMPONENTS,
} from '../../src/shared/constants'
import { makerMeshMessageSchema } from '../../src/shared/makerProtocol'
import { createMeshRenderer } from '../../src/webview/maker/meshRenderer'
import { wireMakerPreview } from '../../src/webview/maker/previewPage'
import { uiBridge, MAKER_UI_ID } from './helpers/makerUi'

vi.mock('../../src/webview/maker/meshRenderer', () => ({ createMeshRenderer: vi.fn() }))
const renderer = { rotate: vi.fn(), zoom: vi.fn(), reset: vi.fn(), dispose: vi.fn() }
const mesh = {
  v: 1,
  type: 'makerMesh',
  artifactId: MAKER_UI_ID,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
}
const emit = (message: unknown) => {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}
const lifetime: { dispose: (() => void) | undefined } = { dispose: undefined }

beforeEach(() => {
  vi.resetAllMocks()
  document.body.dataset['artifactId'] = MAKER_UI_ID
  document.body.innerHTML =
    '<main><canvas id="maker-canvas" aria-label="Maker preview"></canvas><p id="maker-preview-unavailable" role="alert" hidden>Unavailable</p><button data-maker-view="left">Left</button><button data-maker-view="right">Right</button><button data-maker-view="in">In</button><button data-maker-view="out">Out</button><button data-maker-view="reset">Reset</button></main>'
  vi.mocked(createMeshRenderer).mockReturnValue(renderer)
})
afterEach(() => {
  lifetime.dispose?.()
  lifetime.dispose = undefined
  document.body.replaceChildren()
  delete document.body.dataset['artifactId']
})

describe('bounded host-owned STL preview', () => {
  it('three machines and Stop all get separate controls in one viewport stack', () => {
    const buttons = ['', 'one', 'two', 'three'].map((id) => {
      const button = document.createElement('button')
      button.dataset['makerStop'] = id
      document.body.append(button)
      return button
    })
    const { host, post } = uiBridge()
    lifetime.dispose = wireMakerPreview(document, host)
    const stack = document.querySelector('.maker-stop-stack')
    expect(stack?.querySelectorAll('[data-maker-stop]')).toHaveLength(4)
    expect(stack?.children).toHaveLength(2)
    for (const [index, button] of buttons.entries()) {
      expect(button.closest('.maker-stop-stack')).toBe(stack)
      button.click()
      expect(post).toHaveBeenLastCalledWith({
        v: 1,
        type: 'makerStop',
        ...(index > 0 && { machineId: button.dataset['makerStop'] }),
      })
    }
  })
  it.each([undefined, 'not-an-artifact'])(
    'refuses a preview document without its host artifact UUID',
    (id) => {
      if (id === undefined) delete document.body.dataset['artifactId']
      else document.body.dataset['artifactId'] = id
      expect(() => wireMakerPreview(document, uiBridge().host)).toThrow('makerPreviewArtifact')
    },
  )
  it('validates matching geometry, exposes keyboard buttons and posts only readiness', () => {
    const { host, post } = uiBridge()
    lifetime.dispose = wireMakerPreview(document, host)
    emit(mesh)
    expect(createMeshRenderer).toHaveBeenCalledWith(
      document.querySelector('canvas'),
      mesh.positions,
    )
    expect(post).toHaveBeenCalledExactlyOnceWith({ v: 1, type: 'makerReady' })
    expect(document.querySelector('canvas')?.dataset['rendered']).toBe('true')
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-maker-view]'))
      control.click()
    expect(renderer.rotate).toHaveBeenNthCalledWith(1, -1)
    expect(renderer.rotate).toHaveBeenNthCalledWith(2, 1)
    expect(renderer.zoom).toHaveBeenNthCalledWith(1, 1)
    expect(renderer.zoom).toHaveBeenNthCalledWith(2, -1)
    expect(renderer.reset).toHaveBeenCalledOnce()
  })
  it('host-rendered Stop works before geometry loads and after WebGL failure', () => {
    const { host, post } = uiBridge()
    lifetime.dispose = wireMakerPreview(document, host)
    const stop = document.createElement('button')
    stop.dataset['makerStop'] = 'printer'
    document.body.append(stop)
    stop.click()
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop', machineId: 'printer' })
    vi.mocked(createMeshRenderer).mockImplementationOnce(() => {
      throw new Error('webgl failed')
    })
    emit(mesh)
    stop.dataset['makerStop'] = ''
    stop.click()
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  })
  it.each([
    { ...mesh, artifactId: '954e0cdb-0f0a-4be0-80f2-fd0e47a93d61' },
    { ...mesh, v: 2 },
    { ...mesh, url: 'file:///arbitrary.stl' },
    { ...mesh, positions: [0, 0, NaN] },
    { ...mesh, positions: [0, 0, Infinity] },
    { ...mesh, positions: [0] },
    { ...mesh, positions: [...mesh.positions, 0] },
    { ...mesh, positions: [MAKER_PREVIEW_MAX_COORDINATE + 1, ...mesh.positions.slice(1)] },
  ])('refuses wrong generation, malformed and unbounded geometry %#', (message) => {
    lifetime.dispose = wireMakerPreview(document, uiBridge().host)
    emit(message)
    expect(createMeshRenderer).not.toHaveBeenCalled()
  })
  it('rejects a mesh beyond the hard triangle count before allocating WebGL buffers', () => {
    expect(
      makerMeshMessageSchema.safeParse({
        ...mesh,
        positions: Array.from(
          { length: (MAKER_PREVIEW_MAX_TRIANGLES + 1) * MAKER_TRIANGLE_COMPONENTS },
          () => 0,
        ),
      }).success,
    ).toBe(false)
  })
  it.each([false, true])(
    'invalid matching geometry clears the preview (replacement=%s)',
    (replacement) => {
      lifetime.dispose = wireMakerPreview(document, uiBridge().host)
      if (replacement) emit(mesh)
      emit({ ...mesh, positions: [0] })
      expect(document.querySelector('canvas')?.dataset['rendered']).toBe('false')
      expect(document.querySelector<HTMLElement>('#maker-preview-unavailable')?.hidden).toBe(false)
      if (replacement) expect(renderer.dispose).toHaveBeenCalledOnce()
    },
  )
  it('a twice-oversized mesh reads zero components and Stop still responds', () => {
    const { host, post } = uiBridge()
    lifetime.dispose = wireMakerPreview(document, host)
    const positions = Array.from(
      { length: 2 * MAKER_PREVIEW_MAX_TRIANGLES * MAKER_TRIANGLE_COMPONENTS },
      () => 0,
    )
    const read = vi.fn(() => 0)
    Object.defineProperty(positions, '0', { get: read })
    emit({ ...mesh, positions })
    expect(read).not.toHaveBeenCalled()
    const stop = document.createElement('button')
    stop.dataset['makerStop'] = ''
    document.body.append(stop)
    stop.click()
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
    expect(createMeshRenderer).not.toHaveBeenCalled()
  })
  it('large accepted input yields before its second chunk and Stop cancels validation', () => {
    vi.useFakeTimers()
    const { host, post } = uiBridge()
    lifetime.dispose = wireMakerPreview(document, host)
    emit({ ...mesh, positions: Array.from({ length: 18_000 }, () => 0) })
    expect(createMeshRenderer).not.toHaveBeenCalled()
    const stop = document.createElement('button')
    stop.dataset['makerStop'] = ''
    document.body.append(stop)
    stop.click()
    vi.runAllTimers()
    expect(createMeshRenderer).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
    vi.useRealTimers()
  })
  it('validation has a deadline and refuses late work', () => {
    lifetime.dispose = wireMakerPreview(document, uiBridge().host)
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(1001)
    emit(mesh)
    expect(createMeshRenderer).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('#maker-preview-unavailable')?.hidden).toBe(false)
    clock.mockRestore()
  })
  it('disposes replaced and closed geometry and removes listeners', () => {
    lifetime.dispose = wireMakerPreview(document, uiBridge().host)
    emit(mesh)
    emit(mesh)
    expect(renderer.dispose).toHaveBeenCalledOnce()
    lifetime.dispose()
    lifetime.dispose = undefined
    emit(mesh)
    expect(createMeshRenderer).toHaveBeenCalledTimes(2)
    expect(renderer.dispose).toHaveBeenCalledTimes(2)
  })
  it('reports WebGL failure and context loss without leaking raw errors', () => {
    lifetime.dispose = wireMakerPreview(document, uiBridge().host)
    vi.mocked(createMeshRenderer).mockImplementationOnce(() => {
      throw new Error('private driver detail')
    })
    emit(mesh)
    expect(document.querySelector<HTMLElement>('#maker-preview-unavailable')?.hidden).toBe(false)
    expect(document.body).not.toHaveTextContent('private driver detail')
    emit(mesh)
    const event = new Event('webglcontextlost', { cancelable: true })
    document.querySelector('canvas')?.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(renderer.dispose).toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('#maker-preview-unavailable')?.hidden).toBe(false)
  })
})
