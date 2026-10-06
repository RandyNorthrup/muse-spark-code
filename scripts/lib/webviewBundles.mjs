// Count every eagerly imported JavaScript chunk, once. Dynamic surfaces have
// their own budget; moving startup code into a static chunk buys no headroom.
function staticOutputs(meta, roots) {
  const eager = new Set()
  const visit = (file) => {
    if (eager.has(file)) return
    const output = meta.outputs[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    eager.add(file)
    for (const imported of output.imports) {
      if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
    }
  }
  for (const file of roots) visit(file)
  return [...eager]
}

export function webviewStartupOutputs(meta, entry = 'dist/webview/main.js') {
  return staticOutputs(meta, [entry])
}

// Keep each page's full reachable graph, including lazy imports and its CSS.
// Shared outputs occur in both records and are counted by each startup cap.
export function webviewEntryMetafile(meta, entry) {
  const outputs = {}
  const visit = (file) => {
    if (Object.hasOwn(outputs, file)) return
    const output = meta.outputs[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    outputs[file] = output
    for (const imported of output.imports) if (!imported.external) visit(imported.path)
    if (output.cssBundle) visit(output.cssBundle)
  }
  visit(entry)
  const inputs = new Set(
    Object.values(outputs).flatMap((output) => Object.keys(output.inputs ?? {})),
  )
  return {
    inputs: Object.fromEntries(Object.entries(meta.inputs).filter(([file]) => inputs.has(file))),
    outputs,
  }
}

// Additional lazy closures have measured caps. The original optional surfaces
// and every unclassified deferred output retain the existing 50 KiB total cap.
export const ADDITIONAL_WEBVIEW_BUDGETS = [
  {
    name: 'code highlighting',
    entries: ['src/webview/components/HighlightedCode.tsx'],
    budgetKiB: 125,
  },
  {
    name: 'action dialogs',
    entries: [
      'src/webview/components/ShareView.tsx',
      'src/webview/components/SessionBoardDialog.tsx',
      'src/webview/components/HandoffDialog.tsx',
      'src/webview/components/SecretPromptDialog.tsx',
    ],
    budgetKiB: 25,
  },
  {
    name: 'tasks tab',
    entries: ['src/webview/TasksApp.tsx'],
    budgetKiB: 25,
  },
]

export function webviewDeferredBudgetGroups(meta) {
  const eager = new Set(webviewStartupOutputs(meta))
  const entries = (sources) =>
    Object.entries(meta.outputs)
      .filter(([, output]) => sources.includes(output.entryPoint))
      .map(([file]) => file)
  const legacy = new Set(
    staticOutputs(
      meta,
      entries(DEFERRED_WEBVIEW_SURFACES.map((name) => `src/webview/components/${name}.tsx`)),
    ),
  )
  const assigned = new Set()
  const groups = ADDITIONAL_WEBVIEW_BUDGETS.map((budget) => {
    const outputs = staticOutputs(meta, entries(budget.entries)).filter((file) => !eager.has(file))
    for (const file of outputs) if (!legacy.has(file)) assigned.add(file)
    return { ...budget, outputs }
  })
  groups.unshift({
    name: 'deferred JS',
    budgetKiB: 50,
    outputs: Object.keys(meta.outputs).filter(
      (file) => file.endsWith('.js') && !eager.has(file) && !assigned.has(file),
    ),
  })
  return groups
}

export const DEFERRED_WEBVIEW_SURFACES = [
  'GitPanel',
  'AgentMap',
  'UsageDialog',
  'BestOfNDialog',
  'ReviewPane',
  'HistoryDialog',
  'ReportDialog',
]
