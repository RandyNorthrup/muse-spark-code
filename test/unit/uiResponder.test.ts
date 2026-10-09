/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { createFallbackUi } from '../../src/webview/fallbacks/services'
import { createUiResponder } from '../../src/webview/bridges/uiResponder'
import { MHP_ERROR_CODES } from '../../src/shared/constants'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  document.body.replaceChildren()
})
function rig() {
  const element = document.createElement('div')
  document.body.append(element)
  const ui = createFallbackUi(element, vi.fn())
  const responder = createUiResponder(ui)
  cleanup.push(responder.dispose)
  return { ui, responder }
}
function input(id: number | string) {
  return { jsonrpc: '2.0', id, method: 'ui/input', params: { title: 'Input', prompt: 'Value' } }
}

it('returns the original typed id and rejects a renderer result invalid for its method', async () => {
  const { ui, responder } = rig()
  const request = vi.spyOn(ui, 'request').mockResolvedValue('typed text')
  expect(await responder.receive(input(1))).toEqual({ jsonrpc: '2.0', id: 1, result: 'typed text' })
  request.mockResolvedValue(1)
  expect(await responder.receive(input('1'))).toEqual({
    jsonrpc: '2.0',
    id: '1',
    error: { code: MHP_ERROR_CODES.unsupportedCapability, message: 'MHP_UI_FAILED' },
  })
})

it('refuses bad envelopes and validates parameters before calling the renderer', async () => {
  const { ui, responder } = rig()
  const request = vi.spyOn(ui, 'request').mockResolvedValue(null)
  await expect(responder.receive({ ...input(1), method: 'ui/clipboard' })).rejects.toThrow()
  await expect(responder.receive({ ...input(1), extra: true })).rejects.toThrow()
  expect(await responder.receive({ ...input(1), params: { title: 'Input' } })).toMatchObject({
    id: 1,
    error: { code: MHP_ERROR_CODES.unsupportedCapability, message: 'MHP_UI_FAILED' },
  })
  expect(request).not.toHaveBeenCalled()
})

it('refuses duplicate work, cancels only its typed id and disposes every remaining prompt', async () => {
  const { ui, responder } = rig()
  const signals: AbortSignal[] = []
  vi.spyOn(ui, 'request').mockImplementation((_method, _params, signal) => {
    if (signal === undefined) throw new Error('Missing fixture cancellation signal')
    signals.push(signal)
    return new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new Error('Fixture cancelled'))
        },
        { once: true },
      )
    })
  })
  const numeric = responder.receive(input(1))
  await expect(responder.receive(input(1))).rejects.toThrow('DUPLICATE_REQUEST')
  const string = responder.receive(input('1'))
  await responder.receive({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: '1' } })
  expect(await string).toMatchObject({ id: '1', error: { code: MHP_ERROR_CODES.cancelled } })
  expect(signals[0]?.aborted).toBe(false)
  const dispose = vi.spyOn(ui, 'dispose')
  responder.dispose()
  expect(signals.every((signal) => signal.aborted)).toBe(true)
  expect(await numeric).toMatchObject({ id: 1, error: { code: MHP_ERROR_CODES.cancelled } })
  expect(dispose).toHaveBeenCalledOnce()
  cleanup.pop()
})
