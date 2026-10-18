import { readFileSync } from 'node:fs'
import path from 'node:path'

const normalPath = (file) => file.replaceAll('\\', '/')

// Resource-only schema exports must not enlarge chat's shared eager mini-parser.
/** @type {import('esbuild').Plugin} */
export const resourceBrowserValidation = {
  name: 'resource-browser-validation',
  setup(build) {
    const namespace = 'resource-validation'
    build.onResolve({ filter: /^zod\/mini$/ }, async (args) => {
      if (
        args.pluginData === namespace ||
        !/(?:^|\/)src\/shared\/(?:resources|resourceHistory)\.ts$/.test(normalPath(args.importer))
      )
        return
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        pluginData: namespace,
      })
      return { ...resolved, namespace }
    })
    build.onResolve({ filter: /.*/, namespace }, (args) => ({
      path: path.resolve(args.resolveDir, args.path),
      namespace,
    }))
    build.onLoad({ filter: /.*/, namespace }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'js',
      resolveDir: path.dirname(args.path),
    }))
  },
}

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
export const RESOURCE_WEBVIEW_ENTRIES = {
  'dist/webview/resourceSurface.js': 'src/webview/resources/ResourceSurface.tsx',
  'dist/webview/resourceHistory.js': 'src/webview/usage/ResourcesSection.tsx',
}

export const ADDITIONAL_WEBVIEW_BUDGETS = [
  {
    name: 'resource controls',
    entries: [RESOURCE_WEBVIEW_ENTRIES['dist/webview/resourceSurface.js']],
    budgetKiB: 50,
  },
  {
    name: 'resource history',
    entries: [RESOURCE_WEBVIEW_ENTRIES['dist/webview/resourceHistory.js']],
    budgetKiB: 50,
  },
  ...['SetupBanner'].map((name) => ({
    name,
    entries: [`src/webview/components/${name}.tsx`],
    budgetKiB: 25,
  })),
  {
    name: 'surface English',
    entries: ['browser-surface-english:browser-surface-english'],
    // TRAIN15H: 21,695 bytes +15%, rounded up to 25 KiB. Release 0.19.0:
    // 25,638 bytes (the merged truth lanes' sentences) +15%, rounded up to
    // 29 KiB.
    budgetKiB: 29,
  },
  {
    name: 'account English',
    entries: ['browser-account-english:browser-account-english'],
    budgetKiB: 25,
  },
  {
    // STARTUP017: the schedule surfaces' English, out of chat startup:
    // 4,933 bytes measured, +15%, rounded up to 25 KiB (D6).
    name: 'schedule English',
    entries: ['browser-schedule-english:browser-schedule-english'],
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
    'ToolBodies',
    // INT0170B: 13.5 KiB measured +15%, rounded to the existing 25 KiB scale.
    'ToolRow',
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
    name: 'tool cards',
    entries: ['src/webview/components/ToolBodies.tsx'],
    budgetKiB: 25,
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
      'src/webview/playbook/DeferredPlaybook.tsx',
    ],
    budgetKiB: 25,
  },
  // M115's schedule surface (list, editor, timeline, audit): 33.1 KiB
  // measured, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  {
    name: 'schedule surface',
    entries: [
      'src/webview/schedules/ScheduleSurfaceView.tsx',
      'src/webview/schedules/channel.ts',
      // STARTUP017: `/schedule` prompt mapping loads on first submit.
      'src/webview/schedules/prompt.ts',
    ],
    budgetKiB: 50,
  },
  // STARTUP017: exact money display (feature prices, reply costs) loads
  // after first paint for tooltips and usage lines: 12.4 KiB measured,
  // plus 15%, rounded up to 25 KiB (PLAN.md D6).
  {
    name: 'exact money',
    entries: ['src/shared/paid.ts', 'src/core/usage/insights.ts'],
    budgetKiB: 25,
  },
  // FIXM116I: the startup diet's on-demand overlays (measured 5.5 KiB
  // unregistered; +15% rounded up to 10 KiB). The chat's first paint keeps
  // none of them: composer menus, edit totals, task list, effort control.
  {
    name: 'deferred overlays',
    entries: [
      'src/webview/components/SlashMenu.tsx',
      'src/webview/components/MentionMenu.tsx',
      'src/webview/components/DiffTally.tsx',
      'src/webview/components/TodoPanel.tsx',
      'src/webview/components/EffortSlider.tsx',
    ],
    budgetKiB: 10,
  },
  // M105 lane W: the attachment chip's lazy cost/metadata surface, loaded
  // with the first media attachment: 1.2 KiB when split out. Measured size
  // plus 15%, rounded up to 25 KiB (PLAN.md D6).
  {
    name: 'media',
    entries: ['src/webview/components/AttachmentMediaCost.tsx'],
    budgetKiB: 25,
  },
  {
    // The capacity estimator's panel and submit composer (M117): 9.6 KiB
    // when split out (2026-10-06); the composer loads on the first
    // `/estimate` ahead of the panel; plus 15%, rounded up to 25 KiB.
    // D119 (2026-10-17): the estimator's own worded refusal
    // (`isEstimateRefusal`/`estimateRefusalDetail` in `src/shared/estimate.ts`)
    // runs in the panel's and composer's catch handlers, so it stays in this
    // closure; the panel hands a foreign failure to the host log through the
    // port's `report` (2026-10-18), which lands in the same closure:
    // 26,418 bytes measured on `fix/catch-money-final` x 1.15 = 30,380.7
    // bytes = 29.67 KiB, so 30 KiB by the same rule.
    name: 'estimator panel',
    entries: [
      'src/webview/estimator/EstimatorPanel.tsx',
      'src/webview/estimator/composer.ts',
      'src/shared/estimate.ts',
      'src/shared/estimatorProtocol.ts',
    ],
    budgetKiB: 30,
  },
]

// MODELSPLIT: the Models panel's deferred sections, out of the panel body
// (2026-10-10). The lane's brief caps each group at its measured closure
// plus 15% with no 25 KiB rounding: on the lane's base (0.17.0) the providers
// section (with the wizard) measured 28,146 bytes and the models section
// 11,685 bytes (11.4 KiB; +15% is 13,437 bytes, cap 13 KiB).
// Each closure charges the sections' shared InlineError/ScanStatus chunk,
// following the same shared-imports convention as the chat's deferred
// groups; chunks the panel body also imports stay charged to the body.
//
// Both rows are new with this split. The providers row takes its first value
// where it first lands (lead ruling, 2026-10-11, the precedent for a new
// chunk): the production bytes measured on the landing tree plus 15 percent,
// rounded up to a whole KiB. On the release train (the merge of b92fab054
// onto acf388a14, macbook rig) the closure is 32,197 bytes, 4,051 more than
// on 0.17.0 because the train's wizard carries 0.17.1's repairs and exact
// money (M121); 32,197 x 1.15 = 37,026.6 bytes = 36.16 KiB, so 37 KiB. The
// models section measured 12,074 bytes there and keeps 13 KiB. The row
// tightens when the wizard (15,397 bytes, opened on demand) moves out of
// the section chunk.
export const MODELS_DEFERRED_BUDGETS = [
  {
    name: 'models providers section',
    entries: ['src/webview/models/ProvidersSection.tsx', 'src/webview/models/Wizard.tsx'],
    budgetKiB: 37,
  },
  {
    name: 'models models section',
    entries: ['src/webview/models/ModelsSection.tsx'],
    budgetKiB: 13,
  },
]

/**
 * The Models page's lazy section closures from its own metafile: every file
 * statically reachable from the section entries except the page's startup
 * and the panel body's own files.
 */
export function modelsDeferredBudgetGroups(modelsMeta) {
  const meta = { ...modelsMeta, outputs: normalOutputs(modelsMeta) }
  const excluded = new Set([
    ...staticOutputs(meta, ['dist/webview/models.js']),
    ...webviewPanelOutputs(meta, 'dist/webview/models.js', 'src/webview/models/panel.tsx'),
  ])
  const entries = (sources) =>
    Object.entries(meta.outputs)
      .filter(
        ([, output]) =>
          Object.keys(output.inputs ?? {}).some((source) => sources.includes(normalPath(source))) ||
          sources.includes(
            output.entryPoint === undefined ? undefined : normalPath(output.entryPoint),
          ),
      )
      .map(([file]) => normalPath(file))
  return MODELS_DEFERRED_BUDGETS.map((budget) => {
    const roots = entries(budget.entries)
    const outputs = staticOutputs(meta, roots).filter((file) => !excluded.has(file))
    return { ...budget, outputs }
  })
}

/** Both independently delivered resource surfaces stay outside chat startup. */
export function checkResourceWebview(meta) {
  const problems = []
  const eager = new Set(webviewStartupOutputs(meta))
  for (const [file, output] of Object.entries(meta.outputs)) {
    if (!eager.has(normalPath(file))) continue
    const sources = Object.keys(output.inputs ?? {})
    for (const source of sources)
      if (source.startsWith('resource-validation:'))
        problems.push(`Resource browser validation must stay deferred: ${source}`)
  }
  for (const [file, source] of Object.entries(RESOURCE_WEBVIEW_ENTRIES)) {
    const entry = Object.entries(meta.outputs).find(([output]) => normalPath(output) === file)?.[1]
    if (entry === undefined || normalPath(entry.entryPoint ?? '') !== source)
      problems.push(`Missing resource webview entry ${file}`)
    const carriers = Object.entries(meta.outputs).filter(([, output]) =>
      Object.keys(output.inputs ?? {}).some((input) => normalPath(input) === source),
    )
    if (carriers.length !== 1 || eager.has(normalPath(carriers[0]?.[0] ?? '')))
      problems.push(`${source} must occur in exactly one deferred webview chunk`)
  }
  return problems
}

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
      .filter(
        ([, output]) =>
          Object.keys(output.inputs ?? {}).some((source) => sources.includes(normalPath(source))) ||
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
    const roots = entries(budget.entries)
    const outputs = staticOutputs(meta, roots).filter((file) => !eager.has(file))
    // Entry-specific CSS is part of the lazy closure's cost too.
    for (const file of roots) {
      const css = Object.entries(meta.outputs).find(([output]) => normalPath(output) === file)?.[1]
        .cssBundle
      if (css !== undefined && !eager.has(normalPath(css)) && !outputs.includes(normalPath(css)))
        outputs.push(normalPath(css))
    }
    for (const file of outputs) if (!legacy.has(file)) assigned.add(file)
    return {
      ...budget,
      budgetKiB: budget.name === 'question UI' ? questionBudgetKiB : budget.budgetKiB,
      outputs,
    }
  })
  const preview = webviewPreviewOutputs(meta).map((file) => normalPath(file))
  for (const file of preview) assigned.add(file)
  groups.push({ name: 'argument preview JS', budgetKiB: 25, outputs: preview })
  const pacing = webviewPacingOutputs(meta).map((file) => normalPath(file))
  for (const file of pacing) assigned.add(file)
  groups.push({ name: 'pacing/status JS', budgetKiB: 25, outputs: pacing })
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
