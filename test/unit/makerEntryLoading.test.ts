// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type * as ReloadModule from '../../src/webview/reloadPanelSurface'
import { listenForMaker } from '../../src/webview/makerEntry'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

const mounting = vi.hoisted(() => ({ mount: vi.fn() }))
const reload = vi.hoisted(() => vi.fn())
vi.mock('../../src/webview/reloadPanelSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof ReloadModule>()),
  reloadPanelSurface: reload,
}))
vi.mock('../../src/webview/maker/MakerSurface', () => ({ mountMaker: mounting.mount }))
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
it('initial load failure preserves Stop, Retry and pending messages', async () => {
  const { host, post } = uiBridge()
  mounting.mount.mockImplementationOnce(() => {
    throw new Error('unavailable loader')
  })
  listenForMaker(host)
  expect(post).toHaveBeenCalledExactlyOnceWith({ v: 1, type: 'makerReady' })
  window.dispatchEvent(new MessageEvent('message', { data: MAKER_UI_STATE }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.makerLoadFailed))
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerRetry }))
  expect(reload).toHaveBeenCalledExactlyOnceWith()
  expect(mounting.mount).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
})

it('Stop is functional before denied storage and remains present before delayed host replay', () => {
  const { host, post } = uiBridge()
  let isStopReadyAtRead = false
  const denied = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    const stop = screen.queryByRole('button', { name: UI_TEXT.makerStopAll })
    if (stop !== null) {
      fireEvent.click(stop)
      isStopReadyAtRead = post.mock.calls.at(-1)?.[0].type === 'makerStop'
    }
    throw new Error('Denied')
  })
  listenForMaker(host)
  expect(denied).toHaveBeenCalledOnce()
  expect(isStopReadyAtRead).toBe(true)
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerReady' })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  expect(document.querySelector('.maker-surface')).toBeNull()
})
