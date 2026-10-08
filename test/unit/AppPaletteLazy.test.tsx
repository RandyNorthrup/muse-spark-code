// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { installSurfaceRetry } from '../../src/webview/surfaceRetry'
import { renderSignedInApp } from './helpers/initializedApp'

const held = vi.hoisted(() => ({ palette: Promise.withResolvers<undefined>(), loads: 0 }))
vi.mock('../../src/shared/palette', async (original) => {
  held.loads++
  await held.palette.promise
  return await original()
})

it('loads palette data only on use, permits dismissal, and offers a saved-state retry after failure', async () => {
  const save = vi.fn()
  const rebuild = vi.fn()
  installSurfaceRetry(save, rebuild)
  renderSignedInApp(vi.fn())
  expect(held.loads).toBe(0)
  fireEvent.click(screen.getByLabelText(UI_TEXT.commandsTitle))
  expect(await screen.findByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
  expect(held.loads).toBe(1)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByLabelText(UI_TEXT.commandsTitle))
  await act(async () => {
    held.palette.reject(new Error('fake chunk unavailable'))
    await Promise.resolve()
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
  expect(save).toHaveBeenCalledOnce()
  expect(rebuild).toHaveBeenCalledOnce()
})
