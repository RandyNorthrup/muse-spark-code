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
  { name: 'help reference', entries: ['src/webview/components/ReferencePage.tsx'], budgetKiB: 50 },
  {
    // TRAIN15C: 4,018 bytes +15%, rounded up to 25 KiB (D6).
    name: 'paid usage',
    entries: ['src/webview/components/PaidUsageSection.tsx'],
    budgetKiB: 25,
  },
  {
    name: 'provider usage',
    entries: ['src/webview/components/ProviderUsageSection.tsx'],
    budgetKiB: 25,
  },
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
      'src/webview/components/PlanUi.tsx',
      'src/webview/components/UsageProviderSections.tsx',
      'src/webview/components/SetupBanner.tsx',
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
  const reachable = new Set()
  const visit = (file) => {
    if (reachable.has(file)) return
    reachable.add(file)
    const output = meta.outputs[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    for (const imported of output.imports) if (!imported.external) visit(imported.path)
  }
  visit('dist/webview/main.js')
  const separate = new Set()
  for (const root of ['dist/webview/models.js', 'dist/webview/usage.js']) {
    if (!Object.hasOwn(meta.outputs, root)) continue
    for (const file of staticOutputs(meta, [root])) if (!reachable.has(file)) separate.add(file)
  }
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
  const teamOutputs = Object.values(meta.outputs).some(
    (output) => output.entryPoint === 'src/webview/components/TeamUi.tsx',
  )
    ? webviewTeamOutputs(meta)
    : []
  for (const file of teamOutputs) assigned.add(file)
  groups.push({ name: 'team UI', budgetKiB: 25, outputs: teamOutputs })
  groups.unshift({
    name: 'deferred JS',
    budgetKiB: 50,
    outputs: Object.keys(meta.outputs).filter(
      (file) =>
        file.endsWith('.js') && !separate.has(file) && !eager.has(file) && !assigned.has(file),
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

// Team-only static dependencies have their own cap. Dependencies shared with
// startup or another deferred surface stay charged to those existing budgets.
export function webviewTeamOutputs(meta) {
  const team = new Set()
  const other = new Set(webviewStartupOutputs(meta))
  const visit = (file, outputs) => {
    if (outputs.has(file)) return
    const output = meta.outputs[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    outputs.add(file)
    for (const imported of output.imports) {
      if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path, outputs)
    }
  }
  for (const [file, output] of Object.entries(meta.outputs)) {
    if (!file.endsWith('.js') || output.entryPoint === undefined) continue
    if (output.entryPoint === 'src/webview/components/TeamUi.tsx') visit(file, team)
    else if (file !== 'dist/webview/main.js') visit(file, other)
  }
  if (team.size === 0) throw new Error('Missing deferred team UI chunk')
  return [...team.difference(other)]
}
