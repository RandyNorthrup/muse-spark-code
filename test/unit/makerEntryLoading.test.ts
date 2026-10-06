// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { listenForMaker } from '../../src/webview/makerEntry'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

const mounting = vi.hoisted(() => ({ mount: vi.fn() }))
vi.mock('../../src/webview/maker/MakerSurface', () => ({ mountMaker: mounting.mount }))
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.body.replaceChildren()
})
it('initial load failure preserves Stop, Retry and pending messages', async () => {
  const { host, post } = uiBridge()
  const receive = vi.fn()
  const dispose = vi.fn()
  const pendingReceived: unknown[] = []
  mounting.mount
    .mockImplementationOnce(() => {
      throw new Error('unavailable loader')
    })
    .mockImplementationOnce((_element: unknown, _host: unknown, pending: unknown[]) => {
      pendingReceived.push(...pending)
      return { receive, dispose }
    })
  listenForMaker(host)
  window.dispatchEvent(new MessageEvent('message', { data: MAKER_UI_STATE }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.makerLoadFailed))
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerRetry }))
  await waitFor(() => {
    expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerReady' })
  })
  expect(pendingReceived).toEqual([MAKER_UI_STATE])
  expect(mounting.mount).toHaveBeenCalledTimes(2)
  window.dispatchEvent(new Event('pagehide'))
  expect(dispose).toHaveBeenCalledOnce()
})
