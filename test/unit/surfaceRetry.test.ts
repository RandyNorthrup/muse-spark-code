import { expect, it, vi } from 'vitest'
import { installSurfaceRetry, retrySurface } from '../../src/webview/surfaceRetry'

it('flushes the existing persisted state before asking the shell to rebuild the document', () => {
  const order: string[] = []
  const save = vi.fn(() => {
    order.push('saved')
  })
  const rebuild = vi.fn(() => {
    order.push('rebuilt')
  })
  installSurfaceRetry(save, rebuild)
  retrySurface()
  expect(order).toEqual(['saved', 'rebuilt'])
  expect(save).toHaveBeenCalledOnce()
  expect(rebuild).toHaveBeenCalledOnce()
})
