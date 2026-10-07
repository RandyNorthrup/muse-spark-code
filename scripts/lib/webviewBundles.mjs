const normalPath = (file) => file.replaceAll('\\', '/')

function normalOutputs(meta) {
  return Object.fromEntries(
    Object.entries(meta.outputs).map(([file, output]) => [
      normalPath(file),
      {
        ...output,
        entryPoint: output.entryPoint === undefined ? undefined : normalPath(output.entryPoint),
        cssBundle: output.cssBundle === undefined ? undefined : normalPath(output.cssBundle),
        imports: output.imports.map((imported) => ({
          ...imported,
          path: normalPath(imported.path),
        })),
      },
    ]),
  )
}

// Count every eagerly imported JavaScript chunk, once. Dynamic surfaces have
// their own budget; moving startup code into a static chunk buys no headroom.
function staticOutputs(meta, roots) {
  const eager = new Set()
  const outputs = normalOutputs(meta)
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

export function webviewStartupOutputs(meta, entry = 'dist/webview/main.js') {
  return staticOutputs(meta, [entry])
}

// Optional panel bodies charge all static dependencies outside their page's bootstrap.
export function webviewPanelOutputs(meta, entry, source) {
  const eager = new Set(webviewStartupOutputs(meta, entry))
  const body = Object.entries(meta.outputs).filter(
    ([, output]) => output.entryPoint !== undefined && normalPath(output.entryPoint) === source,
  )
  if (body.length !== 1) throw new Error(`Missing or duplicated panel body: ${source}`)
  return staticOutputs(meta, [body[0][0]]).filter((file) => !eager.has(file))
}

// Keep each page's full reachable graph, including lazy imports and its CSS.
// Shared outputs occur in both records and are counted by each startup cap.
export function webviewEntryMetafile(meta, entry, extraEntries = []) {
  const source = normalOutputs(meta)
  const outputs = {}
  const visit = (file) => {
    file = normalPath(file)
    if (Object.hasOwn(outputs, file)) return
    const output = source[file]
    if (output === undefined) throw new Error(`Missing webview output: ${file}`)
    outputs[file] = output
    for (const imported of output.imports) if (!imported.external) visit(imported.path)
    if (output.cssBundle) visit(output.cssBundle)
  }
  visit(entry)
  for (const extra of extraEntries) visit(extra)
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
    name: 'surface English',
    entries: ['browser-surface-english:browser-surface-english'],
    // TRAIN15H: 21,695 bytes +15%, rounded up to 25 KiB.
    budgetKiB: 25,
  },
  {
    name: 'help reference',
    entries: [
      'src/webview/components/ReferencePage.tsx',
      'browser-reference-english:browser-reference-english',
    ],
    budgetKiB: 50,
  },
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
    name: 'report destinations',
    entries: ['src/webview/reporting/destinations/DestinationPicker.tsx'],
    budgetKiB: 25,
  },
  {
    name: 'reporting UI',
    entries: ['src/webview/reporting/main.tsx', 'src/webview/reporting/UsageReportAction.tsx'],
    budgetKiB: 25,
  },
  ...[
    'EffortSlider',
    'ToolBodies',
    'ReviewFindings',
    'HistoryPromptRow',
    'SignIn',
    'GoalPanel',
    'SchedulePanel',
    'Palette',
    'PopoverMenu',
    'GooeyMenuContent',
    'UsageDialogContent',
    'AgentMapContent',
    'LegalReport',
    'ReviewCommentForm',
  ].map((name) => ({
    name,
    entries: [
      `src/webview/components/${name}.tsx`,
      ...(name === 'Palette' ? ['src/shared/paletteRegistry.ts'] : []),
      ...(name === 'ToolBodies' ? ['src/webview/schedules/ScheduleRunBody.tsx'] : []),
    ],
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
      'src/webview/components/PlanUi.tsx',
      'src/webview/components/UsageProviderSections.tsx',
      'src/webview/components/SetupBanner.tsx',
    ],
    budgetKiB: 25,
  },
  {
    // M118: the prompt library gets its own measured closure budget.
    name: 'prompt library',
    entries: [
      'src/webview/prompts/PromptLibrary.tsx',
      'src/webview/prompts/PromptLibraryBridge.tsx',
    ],
    budgetKiB: 25,
  },
  {
    // M118: chat preview closure 13.4 KiB + 15%, rounded up to 25 KiB.
    name: 'chat sharing',
    entries: ['src/webview/sharing/ChatShareDialog.tsx', 'src/webview/sharing/ChatShareBridge.tsx'],
    budgetKiB: 25,
  },
  {
    name: 'tasks tab',
    entries: ['src/webview/TasksApp.tsx'],
    budgetKiB: 25,
  },
  // M116: the three lazy playbook chunks (measured 14.18 KiB unregistered;
  // +15% rounded up to 25 KiB). The chat's first paint keeps none of it.
  {
    name: 'playbook UI',
    entries: [
      'src/webview/playbook/PlaybookPanel.tsx',
      'src/webview/playbook/PlaybookRows.tsx',
      'src/webview/playbook/PlaybookMap.tsx',
    ],
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
  meta = { ...meta, outputs: normalOutputs(meta) }
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
  meta = { ...meta, outputs: normalOutputs(meta) }
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
