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
  'UsageDialog',
  'BestOfNDialog',
  'ReviewPane',
  'HistoryDialog',
  'ReportDialog',
  'ServiceStatusRow',
]

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
