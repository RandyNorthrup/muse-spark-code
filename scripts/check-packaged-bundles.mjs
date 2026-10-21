// Derive sibling edges from production esbuild outputs and installed lazy-loader sources.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const normalized = (file) => file.replaceAll('\\', '/')
function tree(file) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
}
function walk(node, action) {
  action(node)
  ts.forEachChild(node, (child) => walk(child, action))
}

export function requiredPackagedBundles(root, files) {
  const outputs = new Map()
  const configured = new Set()
  for (const file of ['scripts/build.mjs', 'scripts/lib/deferredBundles.mjs']) {
    walk(tree(path.join(SOURCE_ROOT, file)), (node) => {
      if (ts.isStringLiteral(node) && /^dist\/.*\.js$/.test(node.text)) configured.add(node.text)
    })
  }
  for (const directory of ['dist/meta', 'dist/meta-acp']) {
    let entries
    try {
      entries = readdirSync(path.join(root, directory))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const meta = JSON.parse(readFileSync(path.join(root, directory, name), 'utf8'))
      const generated = Object.entries(meta.outputs ?? {})
      for (const [file, output] of generated) {
        if (file.endsWith('.js'))
          outputs.set(normalized(file), { output, inputs: meta.inputs ?? {} })
      }
    }
  }
  const constants = new Map()
  walk(tree(path.join(SOURCE_ROOT, 'src/shared/constants.ts')), (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      constants.set(node.name.text, node.initializer.text)
  })
  const built = new Set([...configured, ...outputs.keys()])
  const packaged = new Set(files.map((file) => normalized(file)))
  const required = new Set(['dist/extension.js'])
  const pending = [...new Set(['dist/extension.js', ...packaged])].filter(
    (file) => file.startsWith('dist/') && file.endsWith('.js'),
  )
  const sources = new Map()
  const sibling = (value, from) => {
    value = normalized(value)
    const file = value.startsWith('dist/')
      ? value
      : path.posix.join(path.posix.dirname(from), value)
    return built.has(file) ? file : undefined
  }
  for (const file of pending) required.add(file)
  let cursor = 0
  while (cursor < pending.length) {
    const file = pending[cursor]
    cursor += 1
    const meta = outputs.get(file)
    if (!meta) continue
    const edges = new Set()
    const imports = meta.output.imports ?? []
    for (const imported of imports) {
      const target = imported.external ? sibling(imported.path, file) : normalized(imported.path)
      if (target?.endsWith('.js')) edges.add(target)
    }
    for (const input of Object.keys(meta.inputs)) {
      // Definition tables carry all bundle names; only their actual readers declare lazy edges.
      if (!normalized(input).startsWith('src/') || normalized(input) === 'src/shared/constants.ts')
        continue
      let references = sources.get(input)
      if (!references) {
        references = new Set()
        const source = tree(path.join(SOURCE_ROOT, normalized(input)))
        const locals = new Map()
        walk(source, (node) => {
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
            locals.set(node.name.text, node.initializer)
        })
        const collect = (node, seen = new Set()) => {
          walk(node, (child) => {
            let value
            if (ts.isStringLiteral(child)) value = child.text
            else if (ts.isIdentifier(child)) value = constants.get(child.text)
            if (value?.endsWith('.js')) references.add(value)
            if (!(ts.isIdentifier(child) && locals.has(child.text)) || seen.has(child.text)) {
              return
            }

            seen.add(child.text)
            collect(locals.get(child.text), seen)
          })
        }
        walk(source, (node) => {
          if (!(
            (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
            (/require|(?:^|\.)load(?:[A-Z]\w*)?$/i.test(node.expression.getText(source)) ||
              /(?:Worker|spawnResourceProcess|handoffResourceFile)$/.test(
                node.expression.getText(source),
              ) ||
              node.expression.kind === ts.SyntaxKind.ImportKeyword)
          )) {
            return
          }

          const argumentsOfCall = node.arguments ?? []
          for (const argument of argumentsOfCall) collect(argument)
        })
        sources.set(input, references)
      }
      for (const reference of references) {
        const target = sibling(reference, file)
        if (target) edges.add(target)
      }
    }
    for (const edge of edges)
      if (!required.has(edge)) {
        required.add(edge)
        pending.push(edge)
      }
  }
  return [...required].toSorted((a, b) => a.localeCompare(b))
}

export function assertPackagedBundles(root, files) {
  const packaged = new Set(files.map((file) => normalized(file)))
  const required = requiredPackagedBundles(root, files)
  const missing = required.filter((file) => !packaged.has(file))
  if (missing.length > 0)
    throw new Error(`Required production bundles excluded from VSIX: ${missing.join(', ')}`)
  return required
}
