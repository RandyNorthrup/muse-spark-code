import { describe, expect, it } from 'vitest'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
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

  it('refuses an incomplete static import graph', () => {
    const meta = metafile()
    Reflect.deleteProperty(meta.outputs, CORE)
    expect(() => webviewStartupOutputs(meta)).toThrow(`Missing webview output: ${CORE}`)
  })
})
