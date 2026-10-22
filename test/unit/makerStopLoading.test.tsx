// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { MakerSurface } from '../../src/webview/maker/MakerSurface'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

// An optional view that never finishes: the eager Stop must already work.
vi.mock(
  '../../src/webview/maker/DevicePanel',
  () =>
    new Promise<Record<string, unknown>>(() => {
      // Deliberately leave the import pending to exercise the usable fallback.
    }),
)
afterEach(() => {
  cleanup()
})
it('Stop works while its chunk is unavailable, with every admission flag off', async () => {
  const { store, post } = uiBridge()
  store.receive({
    ...MAKER_UI_STATE,
    isTrusted: false,
    hardwareEnabled: false,
    isInteractive: false,
  })
  render(<MakerSurface store={store} />)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  store.dispose()
})
