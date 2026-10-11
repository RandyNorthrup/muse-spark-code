/** @vitest-environment jsdom */
import { act, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { UI_TEXT } from '../../src/shared/constants'

vi.mock('esbuild', () => ({
  build: vi.fn(() => {
    throw new Error('Unexpected acceptance build')
  }),
}))
vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn(() => {
      throw new Error('Unexpected acceptance browser')
    }),
  },
}))

it('rejects unsupported acceptance arguments before a build or browser starts', async () => {
  const previous = process.argv
  try {
    process.argv = ['node', 'resource-history-check.mjs', 'invalid']
    await expect(import('../harness/resource-history-check.mjs')).rejects.toThrow(
      'Resource history acceptance takes no arguments',
    )
    expect(build).not.toHaveBeenCalled()
    expect(chromium.launch).not.toHaveBeenCalled()
  } finally {
    process.argv = previous
  }
})

it('mounts the actual history harness and its real lazy charts and totals', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const previous = globalThis.document.title
  globalThis.document.body.innerHTML = '<div id="root"></div>'
  const mounted = { root: undefined }
  try {
    await act(async () => {
      const entry = await import('../harness/resource-history-entry.mjs')
      mounted.root = entry.root
    })
    expect(await screen.findByRole('table', { name: UI_TEXT.resourceHarness })).toHaveTextContent(
      '16s',
    )
    expect(screen.getByRole('heading', { name: UI_TEXT.usageHeading })).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: UI_TEXT.resourceCpu }).querySelectorAll('[data-reading]'),
    ).toHaveLength(3)
    expect(globalThis.document.querySelectorAll('[data-level]')).toHaveLength(4)
  } finally {
    await act(() => {
      mounted.root?.unmount()
    })
    globalThis.document.body.replaceChildren()
    globalThis.document.title = previous
    vi.unstubAllGlobals()
  }
})
