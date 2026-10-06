import { describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
  webviewEntryMetafile,
} from '../../scripts/lib/webviewBundles.mjs'

const MAIN = 'dist/webview/main.js'
const CORE = 'dist/webview/chunks/core.js'
const HIGHLIGHT = 'dist/webview/chunks/highlight.js'
const GRAMMARS = 'dist/webview/chunks/grammars.js'
const HISTORY = 'dist/webview/chunks/history.js'
const SHARED = 'dist/webview/chunks/shared.js'
const UNKNOWN = 'dist/webview/chunks/unclassified.js'
const edge = (path, kind = 'import-statement') => ({ path, kind })
const output = (imports = [], entryPoint) => ({ imports, entryPoint })
function metafile() {
  return {
    outputs: {
      [MAIN]: output([
        edge(CORE),
        edge(HIGHLIGHT, 'dynamic-import'),
        edge(HISTORY, 'dynamic-import'),
      ]),
      [CORE]: output([edge(MAIN), { path: 'external', external: true, kind: 'import-statement' }]),
      [HIGHLIGHT]: output(
        [edge(CORE), edge(GRAMMARS), edge(SHARED), edge(SHARED)],
        'src/webview/components/HighlightedCode.tsx',
      ),
      [GRAMMARS]: output(),
      [HISTORY]: output([edge(SHARED)], 'src/webview/components/HistoryDialog.tsx'),
      [SHARED]: output(),
      [UNKNOWN]: output(),
      'dist/webview/main.css': output(),
    },
  }
}

describe('webview import budgets', () => {
  it('counts the whole static closure exactly once, excluding dynamic and external imports', () => {
    expect(webviewStartupOutputs(metafile())).toEqual([MAIN, CORE])
  })

  it('keeps legacy shared/unclassified bytes charged to their original cap', () => {
    const groups = webviewDeferredBudgetGroups(metafile())
    expect(groups.find(({ name }) => name === 'deferred JS')).toEqual({
      name: 'deferred JS',
      budgetKiB: 50,
      outputs: [HISTORY, SHARED, UNKNOWN],
    })
    expect(groups.find(({ name }) => name === 'code highlighting')).toMatchObject({
      budgetKiB: 125,
      outputs: [HIGHLIGHT, GRAMMARS, SHARED],
    })
  })

  it('charges only the new provider closure separately and retains shared legacy helpers', () => {
    const meta = metafile()
    const provider = 'dist/webview/chunks/providers.js'
    meta.outputs[HISTORY].imports.push(edge(provider, 'dynamic-import'))
    meta.outputs[provider] = output(
      [edge(CORE), edge(SHARED)],
      'src/webview/components/ProviderUsageSection.tsx',
    )
    const groups = webviewDeferredBudgetGroups(meta)
    expect(groups.find(({ name }) => name === 'provider usage')).toMatchObject({
      budgetKiB: 25,
      outputs: [provider, SHARED],
    })
    expect(groups.find(({ name }) => name === 'deferred JS').outputs).toEqual([
      HISTORY,
      SHARED,
      UNKNOWN,
    ])
  })

  it('charges a statically re-imported lazy module and its dependencies to startup', () => {
    const meta = metafile()
    meta.outputs[MAIN].imports.push(edge(HIGHLIGHT))
    expect(webviewStartupOutputs(meta)).toEqual([MAIN, CORE, HIGHLIGHT, GRAMMARS, SHARED])
    expect(
      webviewDeferredBudgetGroups(meta).find(({ name }) => name === 'code highlighting')?.outputs,
    ).toEqual([])
  })

  it('projects each page with its dynamic imports and CSS, excluding the other app', () => {
    const meta = metafile()
    const models = 'dist/webview/models.js'
    const css = 'dist/webview/models.css'
    meta.inputs = { 'src/webview/main.tsx': {}, 'src/webview/models/models.tsx': {} }
    meta.outputs[MAIN].inputs = { 'src/webview/main.tsx': { bytesInOutput: 1 } }
    meta.outputs[models] = {
      ...output([edge(CORE)], 'src/webview/models/models.tsx'),
      inputs: { 'src/webview/models/models.tsx': { bytesInOutput: 1 } },
      cssBundle: css,
    }
    meta.outputs[css] = output()
    // The actual common chunk does not import either app entry.
    meta.outputs[CORE].imports = []
    const page = webviewEntryMetafile(meta, models)
    expect(Object.keys(page.outputs)).toEqual([models, CORE, css])
    expect(Object.keys(page.inputs)).toEqual(['src/webview/models/models.tsx'])
    const chat = webviewEntryMetafile(meta, MAIN)
    expect(Object.hasOwn(chat.outputs, HISTORY)).toBe(true)
    expect(Object.hasOwn(chat.outputs, models)).toBe(false)
  })

  it('refuses an incomplete static import graph', () => {
    const meta = metafile()
    Reflect.deleteProperty(meta.outputs, CORE)
    expect(() => webviewStartupOutputs(meta)).toThrow(`Missing webview output: ${CORE}`)
  })
})
