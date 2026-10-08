import { describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
  checkResourceWebview,
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

  it('charges lazy question closures to their measured cap and counts eager imports at startup', () => {
    const meta = metafile()
    const question = 'dist/webview/chunks/question.js'
    meta.outputs[question] = output([edge(SHARED)], 'src/webview/components/QuestionCard.tsx')
    meta.outputs[MAIN].imports.push(edge(question, 'dynamic-import'))
    expect(
      webviewDeferredBudgetGroups(meta, 25).find(({ name }) => name === 'question UI'),
    ).toEqual({
      name: 'question UI',
      budgetKiB: 25,
      entries: [
        'src/webview/components/QuestionUi.tsx',
        'src/webview/components/QuestionCard.tsx',
        'src/webview/components/OpenQuestionsChip.tsx',
        'src/webview/components/ElicitationCard.tsx',
      ],
      outputs: [question, SHARED],
    })
    expect(webviewStartupOutputs(meta)).not.toContain(question)
    meta.outputs[MAIN].imports.push(edge(question))
    expect(webviewStartupOutputs(meta)).toContain(question)
    expect(
      webviewDeferredBudgetGroups(meta, 25).find(({ name }) => name === 'question UI')?.outputs,
    ).toEqual([])
  })
  it('counts the whole static closure exactly once, excluding dynamic and external imports', () => {
    expect(webviewStartupOutputs(metafile())).toEqual([MAIN, CORE])
  })

  it('keeps legacy shared/unclassified bytes charged to their original cap', () => {
    const groups = webviewDeferredBudgetGroups(metafile(), 25)
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

  it('assigns question-only bytes their own cap without moving legacy shared bytes', () => {
    const meta = metafile()
    const question = 'dist/webview/chunks/questions.js'
    const helper = 'dist/webview/chunks/question-helper.js'
    meta.outputs[MAIN].imports.push(edge(question, 'dynamic-import'))
    meta.outputs[question] = output(
      [edge(CORE), edge(helper), edge(SHARED)],
      'src/webview/components/QuestionUi.tsx',
    )
    meta.outputs[helper] = output()
    const groups = webviewDeferredBudgetGroups(meta, 25)
    expect(groups.find(({ name }) => name === 'question UI')).toEqual({
      name: 'question UI',
      entries: [
        'src/webview/components/QuestionUi.tsx',
        'src/webview/components/QuestionCard.tsx',
        'src/webview/components/OpenQuestionsChip.tsx',
        'src/webview/components/ElicitationCard.tsx',
      ],
      budgetKiB: 25,
      outputs: [question, helper, SHARED],
    })
    expect(groups.find(({ name }) => name === 'deferred JS')?.outputs).toEqual([
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
      webviewDeferredBudgetGroups(meta, 25).find(({ name }) => name === 'code highlighting')
        ?.outputs,
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
