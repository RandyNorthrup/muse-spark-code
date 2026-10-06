// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { MakerSurface } from '../../src/webview/maker/MakerSurface'
import { uiBridge, MAKER_UI_STATE } from './helpers/makerUi'

// An import that never finishes: Stop must already work in the lazy fallback.
vi.mock(
  '../../src/webview/maker/StopChip',
  () =>
    new Promise<Record<string, unknown>>(() => {
      // Deliberately leave the import pending to exercise the usable fallback.
    }),
)
afterEach(() => {
  cleanup()
})
it('Stop works while its chunk is unavailable, with every admission flag off', () => {
  const { store, post } = uiBridge()
  store.receive({
    ...MAKER_UI_STATE,
    isTrusted: false,
    hardwareEnabled: false,
    isInteractive: false,
  })
  render(<MakerSurface store={store} />)
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerStopAll }))
  expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop' })
  store.dispose()
})
