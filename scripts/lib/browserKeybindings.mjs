// Browser dispatch keeps the canonical gestures; optional contexts travel with their UI.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const TABLE = 'src/shared/keybindings.ts'
const treeOf = (file) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)

function contextsOf(tree) {
  const contexts = new Set()
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'webviewKey'
    ) {
      if (node.arguments[0] === undefined || !ts.isStringLiteral(node.arguments[0]))
        throw new Error(`Nonliteral browser keyboard context: ${tree.fileName}`)
      contexts.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return contexts
}

export function browserStartupSources(roots = ['src/webview/main.tsx']) {
  const seen = new Set()
  const contexts = new Set()
  const visit = (file) => {
    file = path.resolve(file)
    if (seen.has(file)) return
    seen.add(file)
    const tree = treeOf(file)
    for (const context of contextsOf(tree)) contexts.add(context)
    for (const node of tree.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        node.importClause?.isTypeOnly ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        continue
      if (
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.every((element) => element.isTypeOnly)
      )
        continue
      const specifier = node.moduleSpecifier.text
      if (!specifier.startsWith('.') || specifier.endsWith('/keybindings')) continue
      const source = path.resolve(path.dirname(file), specifier)
      const resolved = [`${source}.ts`, `${source}.tsx`, `${source}/index.ts`].find(existsSync)
      if (resolved !== undefined) visit(resolved)
    }
  }
  for (const root of roots) visit(root)
  return { contexts, files: seen }
}

export function browserKeyboardSource(contexts) {
  const tree = treeOf(TABLE)
  const declaration = tree.statements
    .filter((statement) => ts.isVariableStatement(statement))
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => ts.isIdentifier(node.name) && node.name.text === 'WEBVIEW_KEYBINDINGS')
  let object = declaration?.initializer
  while (object !== undefined && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object)))
    object = object.expression
  if (object === undefined || !ts.isObjectLiteralExpression(object))
    throw new Error('Missing canonical keyboard table')
  const properties = object.properties.filter((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isStringLiteral(property.name) || ts.isIdentifier(property.name))
    )
      throw new Error('Unsupported keyboard context declaration')
    return contexts.has(property.name.text)
  })
  if (properties.length !== contexts.size) throw new Error('Unknown browser keyboard context')
  const resolver = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'webviewKey',
  )
  if (resolver?.body === undefined) throw new Error('Missing canonical keyboard dispatcher')
  const tail =
    tree.text.slice(object.end, resolver.body.getStart(tree)) +
    '{ return match(WEBVIEW_KEYBINDINGS[context], event, phase, settings) }' +
    tree.text.slice(resolver.body.end)
  return (
    "import { match } from 'browser-keyboard-matcher';\n" +
    tree.text.slice(0, object.getStart(tree)) +
    '{' +
    properties.map((property) => property.getText(tree)).join(',') +
    '}' +
    tail
  )
}

function matcherSource() {
  const tree = treeOf(TABLE)
  const resolver = tree.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'webviewKey',
  )
  if (resolver?.body === undefined || resolver.body.statements[0] === undefined)
    throw new Error('Missing canonical keyboard dispatcher')
  const body = tree.text
    .slice(resolver.body.statements[0].end, resolver.body.end - 1)
    .replace('isAction(context, action)', 'Object.hasOwn(bindings, action)')
  return ts.transpile(
    `export function match(bindings, event, phase = 'down', settings) {${body}}`,
    { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  )
}

export const lazyBrowserKeybindings = {
  name: 'lazy-browser-keybindings',
  setup(build) {
    let eager
    build.onStart(() => {
      eager = browserStartupSources().contexts
    })
    build.onResolve({ filter: /^browser-keyboard-matcher$/ }, () => ({
      path: 'matcher',
      namespace: 'browser-keyboard-matcher',
    }))
    build.onLoad({ filter: /.*/, namespace: 'browser-keyboard-matcher' }, () => ({
      contents: matcherSource(),
      loader: 'js',
    }))
    build.onResolve({ filter: /\/keybindings$/ }, (args) => {
      if (args.importer === '' || !args.importer.replaceAll('\\', '/').includes('/src/webview/'))
        return
      const own = contextsOf(treeOf(args.importer))
      const contexts = [...own].every((context) => eager.has(context)) ? [...eager] : [...own]
      return {
        path: contexts.toSorted((left, right) => left.localeCompare(right)).join('|'),
        namespace: 'browser-keybindings',
      }
    })
    build.onLoad({ filter: /.*/, namespace: 'browser-keybindings' }, (args) => ({
      contents: browserKeyboardSource(new Set(args.path.split('|'))),
      loader: 'ts',
      resolveDir: path.resolve('src/shared'),
      watchFiles: [path.resolve(TABLE)],
    }))
  },
}
