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

export const PORTABLE_PRESENTATION_BUDGETS = [
  ['Walkthrough', 'src/webview/fallbacks/Walkthrough.tsx'],
  ['DiffPage', 'src/webview/fallbacks/DiffPage.tsx'],
  ['ManagerPage', 'src/webview/fallbacks/ManagerPage.tsx'],
  ['PlanPage', 'src/webview/presentation/PlanPage.tsx'],
  ['RoleTrafficPage', 'src/webview/presentation/RoleTrafficPage.tsx'],
].map(([name, entry]) => ({ name, entries: [entry], budgetKiB: 5 }))

export function webviewDeferredBudgetGroups(meta, isPortable = false) {
  const eager = new Set(
    webviewStartupOutputs(
      meta,
      isPortable ? 'dist/webview/portable/main.js' : 'dist/webview/main.js',
    ),
  )
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
  const groups = [
    ...ADDITIONAL_WEBVIEW_BUDGETS,
    ...(isPortable ? PORTABLE_PRESENTATION_BUDGETS : []),
  ].map((budget) => {
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
