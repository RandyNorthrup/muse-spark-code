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
    name: 'question UI',
    entries: [
      'src/webview/components/QuestionUi.tsx',
      'src/webview/components/QuestionCard.tsx',
      'src/webview/components/OpenQuestionsChip.tsx',
      'src/webview/components/ElicitationCard.tsx',
    ],
  },
  {
    name: 'workflow details',
    entries: ['src/webview/components/WorkflowRun.tsx'],
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
    ],
    budgetKiB: 25,
  },
  {
    name: 'tasks tab',
    entries: ['src/webview/TasksApp.tsx'],
    budgetKiB: 25,
  },
  // M115's schedule surface (list, editor, timeline, audit): 33.1 KiB
  // measured, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  {
    name: 'schedule surface',
    entries: ['src/webview/schedules/ScheduleSurfaceView.tsx'],
    budgetKiB: 50,
  },
]

export function webviewDeferredBudgetGroups(meta, questionBudgetKiB) {
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
    return {
      ...budget,
      budgetKiB: budget.name === 'question UI' ? questionBudgetKiB : budget.budgetKiB,
      outputs,
    }
  })
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
]
