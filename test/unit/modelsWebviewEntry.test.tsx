// @vitest-environment jsdom
import { type ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'

const draw = vi.hoisted(() => vi.fn<(node: ReactNode) => void>())
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: draw }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('retains the Models page failure and reports a loaded body crash to its host', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const postMessage = vi.fn((message: { readonly type: string }) => {
    if (message.type === 'modelsPanel/ready') throw new Error('synthetic panel failure')
  })
  vi.stubGlobal('acquireVsCodeApi', () => ({
    postMessage,
    getState: () => undefined,
    setState: vi.fn(),
  }))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await import('../../src/webview/models/models')
    render(draw.mock.calls.at(-1)?.[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.modelsPanelUnavailable)
    expect(screen.getByRole('button', { name: EN.crashReload })).toBeTruthy()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'webviewError', source: 'render' }),
    )
    expect(screen.queryByText('synthetic panel failure')).toBeNull()
  } finally {
    errors.mockRestore()
  }
})
