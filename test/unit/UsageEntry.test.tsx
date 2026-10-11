// @vitest-environment jsdom
import { isValidElement, type ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

const { draw, mount } = vi.hoisted(() => ({
  draw: vi.fn<(node: ReactNode) => void>(),
  mount: vi.fn(),
}))
vi.mock('react-dom/client', () => ({
  createRoot: (element: unknown) => {
    mount(element)
    return { render: draw }
  },
}))

function renderedType(): string {
  const node = draw.mock.calls.at(-1)?.[0]
  if (!isValidElement(node) || typeof node.type !== 'function')
    throw new Error('No mounted component')
  return node.type.name
}
async function showSharedPage(title = USAGE_EN.title): Promise<void> {
  const node = draw.mock.calls.at(-1)?.[0]
  if (!isValidElement(node)) throw new Error('No mounted element')
  render(node)
  expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeTruthy()
}
beforeEach(() => {
  vi.resetModules()
  draw.mockClear()
  mount.mockClear()
  document.body.innerHTML = '<div id="root"></div>'
  delete document.body.dataset['hostBridge']
  delete window.museUsageHostPorts
  vi.stubGlobal(
    'acquireVsCodeApi',
    vi.fn(() => ({ postMessage: vi.fn(), getState: () => undefined, setState: vi.fn() })),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setUsageText(USAGE_EN)
  setUiText(EN, 'en')
  document.querySelector('#muse-usage-l10n')?.remove()
})
describe('usage entry', () => {
  it.each(['vscode', 'http', 'jcef', 'webView2', 'swt'])(
    'selects the %s transport and mounts the shared page',
    async (kind) => {
      document.body.dataset['hostBridge'] = kind
      const messages = new EventTarget()
      const persistence = { savedState: () => undefined, saveState: vi.fn() }
      vi.stubGlobal('museUsageHostPorts', {
        jcef: { ...persistence, messages, send: vi.fn() },
        swt: { ...persistence, messages, send: vi.fn() },
        webView2: { ...persistence, messages, postMessage: vi.fn() },
        http: { ...persistence, request: vi.fn() },
      })
      await import('../../src/webview/usage/usage')
      expect(renderedType()).toBe('UsageBoundary')
      await showSharedPage()
      expect(acquireVsCodeApi).toHaveBeenCalledTimes(kind === 'vscode' ? 1 : 0)
    },
  )
  it.each(['jcef', 'unknown'])(
    'shows an explicit unsupported state for a missing or unknown %s host',
    async (kind) => {
      document.body.dataset['hostBridge'] = kind
      await import('../../src/webview/usage/usage')
      expect(renderedType()).toBe('Unavailable')
      expect(acquireVsCodeApi).not.toHaveBeenCalled()
    },
  )
  it('installs the checked embedded usage table before mount and refuses malformed JSON or locales', async () => {
    const element = document.createElement('script')
    element.id = 'muse-usage-l10n'
    element.type = 'application/json'
    element.textContent = JSON.stringify({
      type: 'usage/table',
      locale: 'de',
      table: { ...USAGE_EN, title: 'Nutzung und Kosten' },
    })
    document.head.append(element)
    await import('../../src/webview/usage/usage')
    await showSharedPage('Nutzung und Kosten')
    expect(document.documentElement.lang).toBe('de')
    vi.resetModules()
    element.textContent = 'not JSON'
    await import('../../src/webview/usage/usage')
    cleanup()
    render(draw.mock.calls.at(-1)?.[0])
    expect(await screen.findByRole('alert')).toHaveTextContent(USAGE_EN.invalidMessage)
  })
  it('refuses to mount without its root', async () => {
    document.body.replaceChildren()
    await expect(import('../../src/webview/usage/usage')).rejects.toThrow('Missing usage root')
    expect(mount).not.toHaveBeenCalled()
  })
  it('reports a native transport crash without showing its private error content', async () => {
    document.body.dataset['hostBridge'] = 'jcef'
    vi.stubGlobal('museUsageHostPorts', {
      jcef: {
        messages: new EventTarget(),
        savedState: () => undefined,
        saveState: vi.fn(),
        send: () => {
          throw new Error('private content')
        },
      },
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await import('../../src/webview/usage/usage')
      const node = draw.mock.calls.at(-1)?.[0]
      render(node)
      expect(await screen.findByRole('alert')).toHaveTextContent('Usage history could not be read.')
      expect(screen.queryByText('private content')).toBeNull()
    } finally {
      errors.mockRestore()
    }
  })
})
