// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { MakerSurface } from '../../src/webview/maker/MakerSurface'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

const view = vi.hoisted(() => ({ fails: true }))
const reload = vi.hoisted(() => vi.fn())
vi.mock('../../src/webview/reloadPanelSurface', () => ({ reloadPanelSurface: reload }))
vi.mock('../../src/webview/maker/DevicePanel', () => ({
  DevicePanel: () => {
    if (view.fails) throw new Error('chunk unavailable')
    return <p>Devices recovered</p>
  },
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('a failed optional view preserves Stop and Retry reloads its whole module graph', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { store, post } = uiBridge()
  store.receive({ ...MAKER_UI_STATE, machines: [] })
  render(<MakerSurface store={store} />)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle }))
  expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.makerLoadFailed)
  expect(document.querySelector('.maker-toolbar')).toBeInTheDocument()
  fireEvent.click(
    screen.getAllByRole('button', { name: UI_TEXT.makerStopAll }).at(-1) ?? document.body,
  )
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerRetry }))
  expect(reload).toHaveBeenCalledExactlyOnceWith()
  store.dispose()
})

it('dismissing a rejected optional view restores chat and toolbar', async () => {
  view.fails = true
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const chat = document.createElement('div')
  chat.id = 'root'
  document.body.append(chat)
  const { store } = uiBridge()
  render(<MakerSurface store={store} />)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle }))
  await screen.findByRole('alert')
  expect(chat.inert).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(chat.inert).toBe(false)
  expect(document.querySelector('.maker-toolbar')).not.toHaveAttribute('inert')
  store.dispose()
  chat.remove()
})
