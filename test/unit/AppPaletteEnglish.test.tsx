// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import type * as Palette from '../../src/shared/palette'
import { renderSignedInApp } from './helpers/initializedApp'

const cold = vi.hoisted(() => ({
  english: Promise.withResolvers<undefined>(),
  load: vi.fn(),
  build: vi.fn(),
}))
vi.mock('../../src/shared/l10n/deferredEnglish', () => ({
  loadDeferredEnglish: () => {
    cold.load()
    return cold.english.promise
  },
}))
vi.mock('../../src/shared/palette', async (original) => {
  const module = await original<typeof Palette>()
  return {
    ...module,
    buildPalette: (...args: Parameters<typeof module.buildPalette>) => {
      cold.build()
      return module.buildPalette(...args)
    },
  }
})

beforeEach(() => {
  cold.english = Promise.withResolvers<undefined>()
  cold.load.mockClear()
  cold.build.mockClear()
})

function openFilteredCommands() {
  renderSignedInApp(vi.fn())
  const box = screen.getByLabelText(EN.composerLabel)
  act(() => {
    box.focus()
  })
  fireEvent.change(box, { target: { value: '/co' } })
  return box
}

describe('cold filtered slash commands', () => {
  it('waits for English before building rows and keeps the composer focus', async () => {
    const box = openFilteredCommands()
    await waitFor(() => {
      expect(cold.load).toHaveBeenCalledOnce()
    })
    expect(cold.build).not.toHaveBeenCalled()
    expect(screen.getByText(EN.loadingOutput)).toHaveAttribute('role', 'status')
    await act(async () => {
      cold.english.resolve(undefined)
      await cold.english.promise
    })
    expect(await screen.findByRole('option', { name: /compact/ })).toBeInTheDocument()
    expect(document.activeElement).toBe(box)
  })

  it('shows the existing failure and retry controls if English cannot load', async () => {
    openFilteredCommands()
    await waitFor(() => {
      expect(cold.load).toHaveBeenCalledOnce()
    })
    await act(async () => {
      cold.english.reject(new Error('chunk unavailable'))
      await expect(cold.english.promise).rejects.toThrow('chunk unavailable')
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.surfaceLoadFailed)
    expect(screen.getByRole('button', { name: EN.surfaceLoadRetry })).toBeInTheDocument()
    expect(cold.build).not.toHaveBeenCalled()
  })

  it('does not reopen commands when the draft changes during loading', async () => {
    const box = openFilteredCommands()
    await waitFor(() => {
      expect(cold.load).toHaveBeenCalledOnce()
    })
    fireEvent.change(box, { target: { value: 'continue' } })
    await act(async () => {
      cold.english.resolve(undefined)
      await cold.english.promise
    })
    expect(screen.queryByRole('option')).toBeNull()
    expect(cold.build).not.toHaveBeenCalled()
    expect(box).toHaveValue('continue')
  })
})
