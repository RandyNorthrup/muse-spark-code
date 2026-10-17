import { describe, expect, it, vi } from 'vitest'
import { toggleFocusView } from '../../src/host/commands/toggleFocusView'

describe('toggleFocusView', () => {
  it.each([
    [false, true],
    [true, false],
  ])('flips %s to %s', async (current, expected) => {
    const setFocusViewEnabled = vi.fn(() => Promise.resolve())
    await toggleFocusView({ isFocusViewEnabled: () => current, setFocusViewEnabled })
    expect(setFocusViewEnabled).toHaveBeenCalledWith(expected)
  })
})
