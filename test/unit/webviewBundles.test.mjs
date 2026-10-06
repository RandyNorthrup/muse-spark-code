import { describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
  webviewEntryMetafile,
  webviewPanelOutputs,
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
      'dist/webview/models.js': output(),
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
  it('charges nested panel dependencies once and excludes its shared bootstrap', () => {
    const meta = metafile()
    const panel = 'dist/webview/chunks/panel.js'
    const source = 'src/webview/usage/UsageApp.tsx'
    meta.outputs[MAIN].imports.push(edge(panel, 'dynamic-import'))
    meta.outputs[panel] = output([edge(CORE), edge(SHARED), edge(SHARED)], source)
    expect(webviewPanelOutputs(meta, MAIN, source)).toEqual([panel, SHARED])
    Reflect.deleteProperty(meta.outputs, panel)
    expect(() => webviewPanelOutputs(meta, MAIN, source)).toThrow(
      'Missing or duplicated panel body',
    )
  })
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
  it('normalizes Windows output, import and entry paths before grouping', () => {
    const meta = metafile()
    meta.outputs = Object.fromEntries(
      Object.entries(meta.outputs).map(([file, value]) => [
        file.replaceAll('/', '\\'),
        {
          ...value,
          entryPoint: value.entryPoint?.replaceAll('/', '\\'),
          imports: value.imports.map((entry) => ({
            ...entry,
            path: entry.path.replaceAll('/', '\\'),
          })),
        },
      ]),
    )
    expect(webviewStartupOutputs(meta)).toEqual([MAIN, CORE])
    expect(webviewDeferredBudgetGroups(meta)).toEqual(webviewDeferredBudgetGroups(metafile()))
  })

  it('refuses an incomplete static import graph', () => {
    const meta = metafile()
    Reflect.deleteProperty(meta.outputs, CORE)
    expect(() => webviewStartupOutputs(meta)).toThrow(`Missing webview output: ${CORE}`)
  })

  it('charges independent usage and models pages to their own static closures', () => {
    const meta = metafile()
    meta.outputs['dist/webview/usage.js'] = output([edge(CORE), edge('usage-only.js')])
    meta.outputs['usage-only.js'] = output()
    expect(webviewStartupOutputs(meta, 'dist/webview/usage.js')).toEqual([
      'dist/webview/usage.js',
      CORE,
      MAIN,
      'usage-only.js',
    ])
    expect(
      webviewDeferredBudgetGroups(meta).find(({ name }) => name === 'deferred JS')?.outputs,
    ).toEqual([HISTORY, SHARED, UNKNOWN])
  })
})
