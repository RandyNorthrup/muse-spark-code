/* Native-only module transport. Paths resolve through the packaged manifest, never the filesystem. */
/* global TextEncoder, crypto, Blob */
Object.defineProperty(globalThis, 'installMuseModules', {
  value: function installMuseModules(manifest, query) {
    const modules = new Map(manifest.modules.map((module) => [module.path, module]))
    if (modules.size !== manifest.modules.length) throw new Error('MHP_MODULE_DUPLICATE')
    const loading = new Map()
    const urls = []
    let isStopped = false
    globalThis.addEventListener(
      'pagehide',
      () => {
        isStopped = true
        for (const url of urls) URL.revokeObjectURL(url)
      },
      { once: true },
    )
    function load(path, ancestors = new Set()) {
      if (ancestors.has(path)) return Promise.reject(new Error('MHP_MODULE_CYCLE'))
      if (loading.has(path)) return loading.get(path)
      const promise = materialize(path, new Set([...ancestors, path]))
      loading.set(path, promise)
      return promise
    }
    async function materialize(path, ancestors) {
      if (isStopped) throw new Error('MHP_MODULE_CLOSED')
      const module = modules.get(path)
      if (!module) throw new Error('MHP_MODULE_UNLISTED')
      let source = await new Promise((resolve, reject) => query(path, resolve, reject))
      const bytes = new TextEncoder().encode(source)
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      if (bytes.length !== module.bytes || hash !== module.sha256)
        throw new Error('MHP_MODULE_CHANGED')
      let bound = source.length
      const imports = module.imports.toSorted((a, b) => b.start - a.start)
      for (const imported of imports) {
        if (imported.end > bound || source.slice(imported.start, imported.end) !== imported.text)
          throw new Error('MHP_MODULE_IMPORT_CHANGED')
        const replacement = imported.dynamic
          ? `globalThis.museModules.import(${JSON.stringify(imported.target)})`
          : JSON.stringify(await load(imported.target, ancestors))
        source = source.slice(0, imported.start) + replacement + source.slice(imported.end)
        bound = imported.start
      }
      if (isStopped) throw new Error('MHP_MODULE_CLOSED')
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      urls.push(url)
      return url
    }
    Object.defineProperty(globalThis, 'museModules', {
      value: Object.freeze({ import: async (path) => import(await load(path)) }),
      configurable: true,
    })
    return globalThis.museModules.import('/assets/portable/main.js')
  },
})
