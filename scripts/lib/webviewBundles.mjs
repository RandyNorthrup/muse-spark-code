const normalPath = (file) => file.replaceAll('\\', '/')

// Count every eagerly imported JavaScript chunk, once. Dynamic surfaces have
// their own budget; moving startup code into a static chunk buys no headroom.
function staticOutputs(meta, roots) {
  const eager = new Set()
  const outputs = Object.fromEntries(
    Object.entries(meta.outputs).map(([file, output]) => [normalPath(file), output]),
  )
  const visit = (file) => {
    file = normalPath(file)
    if (eager.has(file)) return
    const output = outputs[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    eager.add(file)
    for (const imported of output.imports) {
      if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
    }
  }
  for (const file of roots) visit(file)
  return [...eager]
}

export function webviewStartupOutputs(meta) {
  return staticOutputs(meta, ['dist/webview/main.js'])
}

// Additional lazy closures have measured caps. The original optional surfaces
// and every unclassified deferred output retain the existing 50 KiB total cap.
export const ADDITIONAL_WEBVIEW_BUDGETS = [
  ...[
    'SignIn',
    'GoalPanel',
    'SchedulePanel',
    'Palette',
    'PopoverMenu',
    'GooeyMenuContent',
    'UsageDialogContent',
    'AgentMapContent',
  ].map((name) => ({
    name,
    entries: [`src/webview/components/${name}.tsx`],
    budgetKiB: 25,
  })),
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
      .filter(([, output]) =>
        sources.includes(
          output.entryPoint === undefined ? undefined : normalPath(output.entryPoint),
        ),
      )
      .map(([file]) => normalPath(file))
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
  const preview = webviewPreviewOutputs(meta).map((file) => normalPath(file))
  for (const file of preview) assigned.add(file)
  groups.push({ name: 'argument preview JS', budgetKiB: 25, outputs: preview })
  const pacing = webviewPacingOutputs(meta).map((file) => normalPath(file))
  for (const file of pacing) assigned.add(file)
  groups.push({ name: 'pacing/status JS', budgetKiB: 25, outputs: pacing })
  groups.unshift({
    name: 'deferred JS',
    budgetKiB: 50,
    outputs: Object.keys(meta.outputs)
      .map((file) => normalPath(file))
      .filter((file) => file.endsWith('.js') && !eager.has(file) && !assigned.has(file)),
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
  'ServiceStatusRow',
]

// M106 L1: this new surface has its own measured cap. Shared/static dependencies
// stay under their existing startup/deferred caps; only its entry moves here.
export function webviewPreviewOutputs(meta) {
  return Object.entries(meta.outputs)
    .filter(
      ([, output]) =>
        output.entryPoint?.replaceAll('\\', '/') ===
        'src/webview/components/ToolArgumentPreview.tsx',
    )
    .map(([file]) => file)
}

// M106R: only files exclusive to the optional pacing/status UI get its budget.
// Static dependencies shared with another optional surface stay in the original group.
function normalize(file) {
  return file.replaceAll('\\', '/')
}

export function webviewPacingOutputs(meta) {
  const source = 'src/webview/components/ServiceStatusRow.tsx'
  const entries = Object.entries(meta.outputs)
  const pacing = entries.find(([, output]) => normalize(output.entryPoint ?? '') === source)
  if (pacing === undefined) return []
  const closure = (entry) => {
    const files = new Set()
    const visit = (file) => {
      if (files.has(file)) return
      const output = meta.outputs[file]
      if (output === undefined) throw new Error(`Missing webview output: ${file}`)
      files.add(file)
      for (const imported of output.imports) {
        if (!imported.external && imported.kind !== 'dynamic-import') visit(imported.path)
      }
    }
    visit(entry)
    return files
  }
  const exclusive = closure(pacing[0])
  for (const file of webviewStartupOutputs(meta)) exclusive.delete(file)
  for (const [file, output] of entries) {
    if (!output.entryPoint || normalize(output.entryPoint) === source) continue
    for (const shared of closure(file)) exclusive.delete(shared)
  }
  return [...exclusive]
}
