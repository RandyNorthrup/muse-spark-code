/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { mountNodeSurface } from '../../src/webview/bridges/nodeSurface'
import { validatedNodePort } from '../../src/webview/bridges/nodePort'
import { UI_TEXT } from '../../src/shared/constants'
import type { NodeWorkspaceBinding } from '../../src/webview/node/files/main'
import { scripted } from './helpers/recordCalls'

// The mount double's cleanup: the fixture holds no resources, so this only
// carries the comment the empty-function rule requires.
function fixtureCleanup(): void {
  /* the fixture's mount holds no resources */
}
function fixture() {
  const element = document.createElement('div')
  const mount = scripted<[Element, NodeWorkspaceBinding], () => void>(() => fixtureCleanup)
  const binding: NonNullable<Window['museNode']> = {
    workspaceId: 'repo',
    port: validatedNodePort({ request: () => Promise.reject(new Error('unbound fixture')) }),
    auth: { verify: () => Promise.reject(new Error('unbound fixture')) },
    loadWorkspace: () => Promise.resolve({ mountNodeWorkspace: mount }),
  }
  Object.defineProperty(window, 'museNode', {
    value: binding,
    configurable: true,
    writable: true,
  })
  return { element, binding, mount }
}
afterEach(() => {
  delete window.museNode
  document.head.replaceChildren()
})
describe('M110-U1 injected lazy surface', () => {
  it('H06 refuses an unbound surface with a fixed localized error', async () => {
    const element = document.createElement('div')
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
    expect(document.querySelector('link')).toBeNull()
  })
  it('loads the independent stylesheet and passes the trusted binding', async () => {
    const { element, binding, mount } = fixture()
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(document.querySelector('link')).toHaveAttribute(
      'href',
      'https://node.local/node/files/main.css',
    )
    expect(mount.calls).toEqual([[element, binding]])
  })
  it('H06 refuses a binding cleared while the lazy module loads', async () => {
    const { element, binding, mount } = fixture()
    binding.loadWorkspace = () => {
      delete window.museNode
      return Promise.resolve({ mountNodeWorkspace: mount })
    }
    await mountNodeSurface(element, 'https://node.local/main.js')
    expect(mount.calls).toHaveLength(0)
    expect(document.querySelector('link')).toBeNull()
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
  })
  it('scrubs loader failures and removes the unused stylesheet', async () => {
    const { element, binding, mount } = fixture()
    binding.loadWorkspace = () => Promise.reject(new Error('private fixture detail'))
    await expect(mountNodeSurface(element, 'https://node.local/main.js')).rejects.toThrow(
      'private fixture detail',
    )
    expect(mount.calls).toHaveLength(0)
    expect(element.textContent).toBe(UI_TEXT.nodeErrors.unavailable)
    expect(document.querySelector('link')).toBeNull()
  })
})
