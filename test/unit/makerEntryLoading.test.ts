// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { listenForMaker } from '../../src/webview/makerEntry'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

const mounting = vi.hoisted(() => ({ mount: vi.fn() }))
const reload = vi.hoisted(() => vi.fn())
vi.mock('../../src/webview/reloadPanelSurface', () => ({
  reloadPanelSurface: reload,
  makerReloadMessages: () => [],
}))
vi.mock('../../src/webview/maker/MakerSurface', () => ({ mountMaker: mounting.mount }))
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
})
it('initial load failure preserves Stop, Retry and pending messages', async () => {
  const { host, post } = uiBridge()
  mounting.mount.mockImplementationOnce(() => {
    throw new Error('unavailable loader')
  })
  listenForMaker(host)
  window.dispatchEvent(new MessageEvent('message', { data: MAKER_UI_STATE }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.makerLoadFailed))
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerRetry }))
  expect(reload).toHaveBeenCalledExactlyOnceWith([MAKER_UI_STATE])
  expect(mounting.mount).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
