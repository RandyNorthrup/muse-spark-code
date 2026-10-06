/** @vitest-environment jsdom */
import { act, fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { UI_TEXT } from '../../src/shared/constants'

vi.mock('esbuild', () => ({
  build: vi.fn(() => {
    throw new Error('Invalid scenes must not build')
  }),
}))
vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn(() => {
      throw new Error('Invalid scenes must not start a browser')
    }),
  },
}))

it('rejects an unknown harness scene before any build or browser starts', async () => {
  const previous = process.argv
  try {
    process.argv = ['node', 'resources-check.mjs', 'unknown-resource-scene']
    await expect(import('../harness/resources-check.mjs')).rejects.toThrow('Unknown resource scene')
    expect(build).not.toHaveBeenCalled()
    expect(chromium.launch).not.toHaveBeenCalled()
  } finally {
    process.argv = previous
  }
})

it('mounts the real companion harness entry and dispatches its resource controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const previous = globalThis.location.href
  globalThis.history.replaceState(null, '', '?level=pause&surface=companion')
  globalThis.document.body.innerHTML = '<div id="root"></div>'
  const scene = { root: undefined }
  try {
    await act(async () => {
      const module = await import('../harness/resources-entry.mjs')
      scene.root = module.root
    })
    expect(screen.getByRole('heading', { name: UI_TEXT.resourceTitle })).toBeInTheDocument()
    expect(globalThis.document.querySelector('.heartbeat-trace')).toBeNull()
    const chip = await screen.findByRole('button', {
      name: `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}`,
    })
    for (const label of [UI_TEXT.resourceResumeNow, UI_TEXT.openSettings, UI_TEXT.resourceShow]) {
      fireEvent.click(chip)
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
    expect(globalThis.window.resourceHarness.actions).toEqual(['resume', 'settings', 'show'])
  } finally {
    await act(() => {
      scene.root?.unmount()
    })
    globalThis.history.replaceState(null, '', previous)
    globalThis.document.body.replaceChildren()
    vi.unstubAllGlobals()
  }
})
