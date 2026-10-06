// Count every eagerly imported JavaScript chunk, once. Dynamic surfaces have
// their own budget; moving startup code into a static chunk buys no headroom.
export function webviewStartupOutputs(meta) {
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
  visit('dist/webview/main.js')
  return [...eager]
}

export const DEFERRED_WEBVIEW_SURFACES = [
  'GitPanel',
  'AgentMap',
  'TeamTree',
  'TeamCards',
  'TeamUi',
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
