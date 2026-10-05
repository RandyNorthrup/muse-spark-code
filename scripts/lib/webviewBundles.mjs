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
  'AgentMap',
  'UsageDialog',
  'BestOfNDialog',
  'ReviewPane',
  'HistoryDialog',
  'SessionBoardDialog',
]
