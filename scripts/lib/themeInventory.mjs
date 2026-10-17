import { readFileSync } from 'node:fs'
import path from 'node:path'

const variablePattern = /--vscode-[\w-]+/g
const importPattern = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/g

/** Follow local stylesheet imports as well as the webview's own source files. */
export function collectThemeVariables(files, root = process.cwd()) {
  const variables = new Map()
  const seen = new Set()
  const pending = files.map((file) => file.replaceAll('\\', '/'))
  while (pending.length > 0) {
    const file = pending.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(path.resolve(root, file), 'utf8')
    for (const [variable] of text.matchAll(variablePattern)) {
      if (!variables.has(variable)) variables.set(variable, new Set())
      variables.get(variable).add(file)
    }
    if (!file.endsWith('.css')) continue
    for (const [, imported] of text.matchAll(importPattern)) {
      if (/^(?:[a-z]+:|\/\/)/i.test(imported)) continue
      const target = path.resolve(root, path.dirname(file), imported.replaceAll('\\', '/'))
      const relative = path.relative(root, target).replaceAll('\\', '/')
      if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
        throw new Error(`Stylesheet import escapes repository: ${file} -> ${imported}`)
      }
      pending.push(relative)
    }
  }
  return variables
}
