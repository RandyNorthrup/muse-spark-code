import {
  PORTABLE_MODULE_HEX_RADIX,
  portableManifestSchema,
} from '../../shared/hostApi/portableAssets'

declare global {
  interface Window {
    museModules?: { import(path: string): Promise<unknown> }
  }
}

/** Assets use C's authenticated fetch; every executable module inherits its nonce. */
async function boot(): Promise<void> {
  const manifest = portableManifestSchema.parse(
    JSON.parse(document.querySelector('#muse-modules')?.textContent ?? 'null'),
  )
  const modules = new Map(manifest.modules.map((module) => [module.path, module]))
  if (modules.size !== manifest.modules.length) throw new Error('MHP_MODULE_DUPLICATE')
  const loading = new Map<string, Promise<string>>()
  const urls: string[] = []
  const stopped = new AbortController()
  window.addEventListener(
    'pagehide',
    () => {
      stopped.abort()
      for (const url of urls) URL.revokeObjectURL(url)
    },
    { once: true },
  )

  function load(path: string, ancestors: ReadonlySet<string> = new Set()): Promise<string> {
    if (ancestors.has(path)) return Promise.reject(new Error('MHP_MODULE_CYCLE'))
    const previous = loading.get(path)
    if (previous !== undefined) return previous
    const next = materialize(path, new Set([...ancestors, path]))
    loading.set(path, next)
    return next
  }
  async function materialize(path: string, ancestors: ReadonlySet<string>): Promise<string> {
    stopped.signal.throwIfAborted()
    const module = modules.get(path)
    if (module === undefined) throw new Error('MHP_MODULE_UNLISTED')
    const response = await window.fetch(path, { credentials: 'omit', signal: stopped.signal })
    if (!response.ok) throw new Error('MHP_MODULE_FETCH')
    const bytes = await response.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(PORTABLE_MODULE_HEX_RADIX).padStart(2, '0'))
      .join('')
    if (bytes.byteLength !== module.bytes || hash !== module.sha256)
      throw new Error('MHP_MODULE_CHANGED')
    let source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const imports = module.imports.toSorted((a, b) => b.start - a.start)
    let bound = source.length
    for (const imported of imports) {
      if (imported.end > bound || source.slice(imported.start, imported.end) !== imported.text)
        throw new Error('MHP_MODULE_IMPORT_CHANGED')
      const replacement = imported.dynamic
        ? `window.museModules.import(${JSON.stringify(imported.target)})`
        : JSON.stringify(await load(imported.target, ancestors))
      source = source.slice(0, imported.start) + replacement + source.slice(imported.end)
      bound = imported.start
    }
    stopped.signal.throwIfAborted()
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    urls.push(url)
    return url
  }
  Object.assign(window, {
    museModules: {
      import: async (path: string): Promise<unknown> => {
        const module: unknown = await import(await load(path))
        return module
      },
    },
  })
  const entries = [...document.querySelectorAll<HTMLScriptElement>('script[data-muse-entry]')]
  for (const entry of entries) {
    const path = entry.dataset['museEntry']
    if (path === undefined) throw new Error('MHP_MODULE_ENTRY')
    entry.src = await load(path)
    delete entry.dataset['museEntry']
    // Module scripts parsed without a src have already executed. Replace the
    // element to start its fetched graph with the original CSP nonce.
    const replacement = document.createElement('script')
    replacement.type = 'module'
    replacement.nonce = entry.nonce
    replacement.src = entry.src
    entry.replaceWith(replacement)
  }
}

function start(): void {
  void boot().catch((error: unknown) => {
    document.documentElement.dataset['launch'] = 'failed'
    const alert = document.querySelector<HTMLElement>('#launch-error')
    if (alert !== null) {
      alert.hidden = false
      alert.focus()
    }
    // Unhandled on purpose: the page's error reporting keeps the cause.
    throw error
  })
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
