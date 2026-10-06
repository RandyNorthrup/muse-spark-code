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
    return { ...budget, outputs }
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
