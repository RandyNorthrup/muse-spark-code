// Lane A's isolated meter fixture until lane W connects App's reported context.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextMeter } from '../../src/webview/components/ContextMeter'
import { installEmbeddedTable } from '../../src/webview/installTable'

export function renderContextMeter(context) {
  const error = installEmbeddedTable(globalThis.document)
  if (error !== undefined) throw new Error(error)
  const toolbar = globalThis.document.querySelector('.composer-toolbar-group:last-child')
  if (toolbar === null) throw new Error('The composer toolbar did not render')
  const mount = globalThis.document.createElement('span')
  toolbar.prepend(mount)
  createRoot(mount).render(
    createElement(ContextMeter, {
      context,
      onCompact: () => {
        mount.dataset.compacted = 'true'
      },
    }),
  )
}
