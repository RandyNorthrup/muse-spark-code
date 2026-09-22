import { describe, expect, it, vi } from 'vitest'
import { type FocusInputDeps, toggleInputFocus } from '../../src/host/commands/focusInput'
import { fakeSurface } from './helpers/fakes'

function deps(overrides: Partial<FocusInputDeps> = {}): FocusInputDeps {
  return {
    isInputFocused: () => false,
    activeSurface: () => undefined,
    focusEditor: vi.fn(() => Promise.resolve()),
    openSidebar: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

describe('toggleInputFocus', () => {
  it('returns focus to the editor when the composer has it', async () => {
    const surface = fakeSurface('sidebar')
    const d = deps({ isInputFocused: () => true, activeSurface: () => surface })
    await toggleInputFocus(d)
    expect(d.focusEditor).toHaveBeenCalledOnce()
    expect(surface.posted).toEqual([])
    expect(d.openSidebar).not.toHaveBeenCalled()
  })

  it('reveals the active surface and asks it to focus the composer', async () => {
    const surface = fakeSurface('panel:1')
    const d = deps({ activeSurface: () => surface })
    await toggleInputFocus(d)
    expect(surface.reveal).toHaveBeenCalledOnce()
    expect(surface.posted).toEqual([{ type: 'focusInput' }])
    expect(d.focusEditor).not.toHaveBeenCalled()
  })

  it('opens the sidebar when no surface exists yet', async () => {
    const d = deps()
    await toggleInputFocus(d)
    expect(d.openSidebar).toHaveBeenCalledOnce()
    expect(d.focusEditor).not.toHaveBeenCalled()
  })
})
