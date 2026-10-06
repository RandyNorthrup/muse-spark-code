import { describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
  checkResourceWebview,
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

  it('charges a statically re-imported lazy module and its dependencies to startup', () => {
    const meta = metafile()
    meta.outputs[MAIN].imports.push(edge(HIGHLIGHT))
    expect(webviewStartupOutputs(meta)).toEqual([MAIN, CORE, HIGHLIGHT, GRAMMARS, SHARED])
    expect(
      webviewDeferredBudgetGroups(meta).find(({ name }) => name === 'code highlighting')?.outputs,
    ).toEqual([])
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

  it('M107 charges controls and history CSS independently and refuses missing, eager or duplicate surfaces', () => {
    const meta = metafile()
    const entries = {
      'dist/webview/resourceSurface.js': 'src/webview/resources/ResourceSurface.tsx',
      'dist/webview/resourceHistory.js': 'src/webview/usage/ResourcesSection.tsx',
    }
    for (const [file, entryPoint] of Object.entries(entries))
      meta.outputs[file] = { ...output([edge(CORE)], entryPoint), inputs: { [entryPoint]: {} } }
    const css = 'dist/webview/resourceHistory.css'
    meta.outputs['dist/webview/resourceHistory.js'].cssBundle = css
    meta.outputs[css] = output()
    expect(checkResourceWebview(meta)).toEqual([])
    const parser = 'resource-validation:/project/node_modules/zod/v4/core/schemas.js'
    const leaked = globalThis.structuredClone(meta)
    leaked.outputs[CORE].inputs = { [parser]: {} }
    expect(checkResourceWebview(leaked)).toContain(
      `Resource browser validation must stay deferred: ${parser}`,
    )
    expect(
      webviewDeferredBudgetGroups(meta).find(({ name }) => name === 'resource history').outputs,
    ).toContain(css)
    for (const [file, source] of Object.entries(entries)) {
      const changed = globalThis.structuredClone(meta)
      Reflect.deleteProperty(changed.outputs, file)
      expect(checkResourceWebview(changed)).toContain(`Missing resource webview entry ${file}`)
      const eager = globalThis.structuredClone(meta)
      eager.outputs[MAIN].imports.push(edge(file))
      expect(checkResourceWebview(eager)).toContain(
        `${source} must occur in exactly one deferred webview chunk`,
      )
      const duplicate = globalThis.structuredClone(meta)
      duplicate.outputs['dist/webview/chunks/duplicate.js'] = {
        ...output(),
        inputs: { [source]: {} },
      }
      expect(checkResourceWebview(duplicate)).toContain(
        `${source} must occur in exactly one deferred webview chunk`,
      )
    }
    const windows = {
      outputs: Object.fromEntries(
        Object.entries(meta.outputs).map(([file, entry]) => [
          file.replaceAll('/', '\\'),
          {
            ...entry,
            entryPoint: entry.entryPoint?.replaceAll('/', '\\'),
            cssBundle: entry.cssBundle?.replaceAll('/', '\\'),
            inputs: Object.fromEntries(
              Object.entries(entry.inputs ?? {}).map(([file, input]) => [
                file.replaceAll('/', '\\'),
                input,
              ]),
            ),
            imports: entry.imports.map((item) => ({
              ...item,
              path: item.path.replaceAll('/', '\\'),
            })),
          },
        ]),
      ),
    }
    expect(checkResourceWebview(windows)).toEqual([])
    expect(webviewDeferredBudgetGroups(windows)).toEqual(webviewDeferredBudgetGroups(meta))
  })
  it('refuses an incomplete static import graph', () => {
    const meta = metafile()
    Reflect.deleteProperty(meta.outputs, CORE)
    expect(() => webviewStartupOutputs(meta)).toThrow(`Missing webview output: ${CORE}`)
  })
})
