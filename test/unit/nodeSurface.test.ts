/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountNodeSurface } from '../../src/webview/bridges/nodeSurface'
import { validatedNodePort } from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import type { NodeWorkspaceBinding } from '../../src/webview/node/files/main'

function fixture() {
  const element = document.createElement('div')
  const mount = vi.fn((_element: Element, _binding: NodeWorkspaceBinding) => vi.fn())
  const binding: NonNullable<Window['museNode']> = {
    workspaceId: 'repo',
    port: validatedNodePort({ request: () => Promise.reject(new Error('unbound fixture')) }),
    auth: { verify: () => Promise.reject(new Error('unbound fixture')) },
    loadWorkspace: () => Promise.resolve({ mountNodeWorkspace: mount }),
  }
  vi.stubGlobal('museNode', binding)
  return { element, binding, mount }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.museNode
  document.head.replaceChildren()
})
describe('M110-U1 injected lazy surface', () => {
  it('H06 refuses an unbound surface with a fixed localized error', async () => {
    const element = document.createElement('div')
    const creating = vi.spyOn(document, 'createElement')
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
    expect(document.querySelector('link')).toBeNull()
    expect(creating).not.toHaveBeenCalled()
  })
  it('loads the independent stylesheet and passes the trusted binding', async () => {
    const { element, binding, mount } = fixture()
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(document.querySelector('link')).toHaveAttribute(
      'href',
      'https://node.local/node/files/main.css',
    )
    expect(mount).toHaveBeenCalledWith(element, binding)
  })
  it('H06 refuses a binding cleared while the lazy module loads', async () => {
    const { element, binding, mount } = fixture()
    binding.loadWorkspace = () => {
      delete window.museNode
      return Promise.resolve({ mountNodeWorkspace: mount })
    }
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(mount).not.toHaveBeenCalled()
    expect(document.querySelector('link')).toBeNull()
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
  })
  it('scrubs loader failures and removes the unused stylesheet', async () => {
    const { element, binding, mount } = fixture()
    binding.loadWorkspace = () => Promise.reject(new Error('private fixture detail'))
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(mount).not.toHaveBeenCalled()
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
    expect(document.querySelector('link')).toBeNull()
  })
})
