import { NODE_WORKSPACE_ASSET, UI_TEXT } from '../../shared/constants'
import type { NodeWorkspaceBinding } from '../node/files/main'
import type * as WorkspaceModule from '../node/files/main'

declare global {
  interface Window {
    /** M104-D/A1 supplies this after sign-in. Neither bearer nor proof is put
    in HTML, state, a URL, cookies or persistent storage. */
    museNode?: NodeWorkspaceBinding & {
      loadWorkspace(): Promise<typeof WorkspaceModule>
    }
  }
}

/** Separate node entry: the ordinary chat bundle carries no node schemas,
editor or page. C/M104 wires the independent build and lazy loader. */
export async function mountNodeSurface(element: Element, scriptUrl: string): Promise<void> {
  const binding = window.museNode
  if (binding === undefined) {
    element.textContent = UI_TEXT.nodeErrors.unavailable
    return
  }
  const sheet = document.createElement('link')
  sheet.rel = 'stylesheet'
  sheet.href = new URL(NODE_WORKSPACE_ASSET, scriptUrl).href
  document.head.append(sheet)
  try {
    const module = await binding.loadWorkspace()
    if (window.museNode !== binding) {
      sheet.remove()
      element.textContent = UI_TEXT.nodeErrors.unavailable
      return
    }
    module.mountNodeWorkspace(element, binding)
  } catch (error: unknown) {
    // A dead surface still reports: the person sees the fixed refusal
    // above, and the rethrow files the cause on the window's failure
    // channel, like main's fatal table throw.
    sheet.remove()
    element.textContent = UI_TEXT.nodeErrors.unavailable
    throw error
  }
}
