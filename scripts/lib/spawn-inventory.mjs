import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const operations = new Set([
  'spawn',
  'execFile',
  'exec',
  'fork',
  'execSync',
  'execFileSync',
  'spawnSync',
  'spawnResourceProcess',
  'execResourceFile',
  'handoffResourceFile',
  'runBootstrap',
])
const isChildModule = (text) => text === 'child_process' || text === 'node:child_process'
const PROCESS_WRAPPERS = new Set([
  'execa',
  'cross-spawn',
  'shelljs',
  'zx',
  'tinyexec',
  'nano-spawn',
  'node-pty',
  '@lydell/node-pty',
  'child-process-promise',
  'spawn-async',
  'execa-sync',
])
const isWrapperModule = (text) => PROCESS_WRAPPERS.has(text)
const LAUNCH_TEXT = /(?:require|import).*child_process/u

/** The top-level declaration (function, variable or class) a node sits in, if any. */
function topLevelOwner(node) {
  let current = node
  while (current.parent !== undefined && !ts.isSourceFile(current.parent)) current = current.parent
  if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) return current.name?.text
  if (ts.isVariableStatement(current)) {
    const [declaration] = current.declarationList.declarations
    if (declaration !== undefined && ts.isIdentifier(declaration.name)) return declaration.name.text
  }
  return
}

/** The operation a call names: directly, through an alias, a member, or promisify(op)(). */
function calledName(expression, aliases, source) {
  if (ts.isIdentifier(expression)) return aliases.get(expression.text) ?? expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression))
    return expression.argumentExpression.text
  const [argument] = ts.isCallExpression(expression) ? expression.arguments : []
  if (
    argument !== undefined &&
    ts.isCallExpression(expression) &&
    expression.expression.getText(source) === 'promisify' &&
    ts.isIdentifier(argument)
  )
    return aliases.get(argument.text) ?? argument.text
  return
}

/**
 * Syntax only, file by file (a type-checked program is too slow for a unit
 * test), parsed lazily. Every site needs one of these words in its file's
 * text, so skipping files without any cannot miss a site. A bare `exec` counts
 * only when no `.` precedes it: `x.exec(` is a site only for a child_process
 * namespace, and that file names child_process.
 */
const CANDIDATE =
  /child_process|spawn|execFile|execSync|fork|ResourceFile|runBootstrap|(?<![.\w])exec\b/u
const sourceFiles = (root) =>
  fs
    .readdirSync(path.join(root, 'src'), { recursive: true })
    .filter((file) => /\.(?:[cm]?[jt]s|tsx)$/.test(file))
    .map((file) => path.join(root, 'src', file))
const testFiles = (root) =>
  fs
    .readdirSync(path.join(root, 'test'), { recursive: true })
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    .map((file) => path.join(root, 'test', file))

/**
 * Both corpora, read in parallel. A first read of thousands of files is slow on
 * a fresh Windows checkout; a test reads them here, in its hook, once.
 */
export async function readCorpus(root) {
  const read = async (files) =>
    new Map(
      await Promise.all(
        files.map(
          async (file) => /** @type {const} */ ([file, await fs.promises.readFile(file, 'utf8')]),
        ),
      ),
    )
  const [sources, tests] = await Promise.all([read(sourceFiles(root)), read(testFiles(root))])
  return { sources, tests: tests.values().toArray() }
}

function sourceTree(root, corpus) {
  const texts =
    corpus?.sources ??
    new Map(sourceFiles(root).map((file) => [file, fs.readFileSync(file, 'utf8')]))
  const parsed = new Map()
  const parse = (file) => {
    let source = parsed.get(file)
    if (source === undefined) {
      source = ts.createSourceFile(
        file,
        texts.get(file),
        ts.ScriptTarget.ESNext,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : undefined,
      )
      parsed.set(file, source)
    }
    return source
  }
  /** Files whose text contains `word`; any use of `word` must be in one of them. */
  const containing = (word) =>
    [...texts].filter(([, text]) => word.test(text)).map(([file]) => parse(file))
  // Test texts are read once per scan, not once per proof.
  let testTexts = corpus?.tests
  const tests = () => {
    testTexts ??= testFiles(root).map((file) => fs.readFileSync(file, 'utf8'))
    return testTexts
  }
  return { containing, tests }
}

/** Every source process site, including embedded supervisor programs and aliased imports. */
export function scanSpawnSites(root, corpus) {
  const tree = sourceTree(root, corpus)
  const sites = []
  for (const source of tree.containing(CANDIDATE)) {
    const relative = path.relative(root, source.fileName).replaceAll('\\', '/')
    const aliases = new Map()
    // Namespace or default bindings of child_process (import * as cp, require).
    const namespaces = new Set()
    const counts = new Map()
    const add = (operation, node, isEmbedded = false) => {
      const name = `${isEmbedded ? 'embedded:' : ''}${operation}`
      const count = (counts.get(name) ?? 0) + 1
      counts.set(name, count)
      const owner = isEmbedded ? undefined : topLevelOwner(node)
      const selected =
        ts.isCallExpression(node) &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0])
          ? node.arguments[0].text
          : undefined
      sites.push({
        site: `${relative}#${name}:${String(count)}`,
        file: relative,
        line: source.getLineAndCharacterOfPosition(isEmbedded ? 0 : node.getStart(source)).line + 1,
        owner,
        selected,
      })
    }
    const imports = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isChildModule(node.moduleSpecifier.text)
      ) {
        add('import', node)
        const bindings = node.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings))
          for (const entry of bindings.elements)
            aliases.set(entry.name.text, entry.propertyName?.text ?? entry.name.text)
        if (bindings !== undefined && ts.isNamespaceImport(bindings))
          namespaces.add(bindings.name.text)
        if (node.importClause?.name !== undefined) namespaces.add(node.importClause.name.text)
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isWrapperModule(node.moduleSpecifier.text)
      )
        add('wrapper', node)
      // `const { spawn: launch } = …`: any binding of a launch name is that launch.
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name))
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (!ts.isIdentifier(property) || !ts.isIdentifier(element.name)) continue
          const operation = aliases.get(property.text) ?? property.text
          if (operations.has(operation)) aliases.set(element.name.text, operation)
        }
      // `const launch = cp.spawn`
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isPropertyAccessExpression(node.initializer) &&
        operations.has(node.initializer.name.text) &&
        node.initializer.name.text !== 'exec'
      )
        aliases.set(node.name.text, node.initializer.name.text)
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'require' &&
        node.initializer.arguments.some((arg) => ts.isStringLiteral(arg) && isChildModule(arg.text))
      )
        namespaces.add(node.name.text)
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(source) === 'promisify' &&
        node.initializer.arguments[0] !== undefined &&
        ts.isIdentifier(node.initializer.arguments[0])
      ) {
        const argument = node.initializer.arguments[0].text
        const operation = aliases.get(argument) ?? argument
        if (operations.has(operation)) aliases.set(node.name.text, operation)
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isIdentifier(node.initializer)
      ) {
        const operation = aliases.get(node.initializer.text) ?? node.initializer.text
        if (operations.has(operation)) aliases.set(node.name.text, operation)
      }
      ts.forEachChild(node, imports)
    }
    imports(source)
    const visit = (node, isEmbedded = false) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression
        if (
          ts.isIdentifier(expression) &&
          expression.text === 'require' &&
          node.arguments.some((arg) => ts.isStringLiteral(arg) && isChildModule(arg.text))
        )
          add('import', node, isEmbedded)
        if (
          expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.some((arg) => ts.isStringLiteral(arg) && isChildModule(arg.text))
        )
          add('import', node, isEmbedded)
        if (
          (expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(expression) && expression.text === 'require')) &&
          node.arguments.some((arg) => ts.isStringLiteral(arg) && isWrapperModule(arg.text))
        )
          add('wrapper', node, isEmbedded)
        const name = calledName(expression, aliases, source)
        if (name !== undefined && operations.has(name)) {
          // `x.exec(` is RegExp.exec unless x is a child_process binding.
          const isOtherExec =
            name === 'exec' &&
            ts.isPropertyAccessExpression(expression) &&
            !(ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text))
          if (!isOtherExec) add(`call:${name}`, node, isEmbedded)
        }
      }
      if (
        ts.isNewExpression(node) &&
        (ts.isIdentifier(node.expression)
          ? node.expression.text === 'Worker'
          : ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'Worker') &&
        node.arguments?.some(
          (arg) =>
            ts.isObjectLiteralExpression(arg) &&
            arg.properties.some(
              (property) =>
                property.name !== undefined &&
                ts.isIdentifier(property.name) &&
                property.name.text === 'eval',
            ),
        ) === true
      )
        add('worker', node, isEmbedded)
      // Interpolated program text is undecidable: it is a site to list (or remove).
      if (
        !isEmbedded &&
        ts.isTemplateExpression(node) &&
        LAUNCH_TEXT.test(
          [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(''),
        )
      )
        add('embedded:dynamic', node)
      if (!isEmbedded && ts.isStringLiteralLike(node) && LAUNCH_TEXT.test(node.text)) {
        const nested = ts.createSourceFile(
          'supervisor.js',
          node.text,
          ts.ScriptTarget.ESNext,
          true,
          ts.ScriptKind.JS,
        )
        visit(nested, true)
      }
      ts.forEachChild(node, (child) => visit(child, isEmbedded))
    }
    visit(source)
  }
  return { sites, program: tree }
}

/** A call written in a top-level initializer, outside any function, runs when the module loads. */
function runsAtLoad(node) {
  const parent = node.parent
  const isCallee =
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node
  if (!isCallee) return false
  for (let current = parent; !ts.isSourceFile(current); current = current.parent)
    if (ts.isFunctionLike(current) || ts.isClassLike(current)) return false
  return true
}

const indexes = new WeakMap()
/**
 * Every use of every name in one file, once: its top-level owner, or the
 * local alias an import or destructuring gives it. Declaration names and plain
 * import bindings are not uses (the uses of a plain import are its name).
 */
function referenceIndex(source) {
  let index = indexes.get(source)
  if (index !== undefined) return index
  index = new Map()
  const record = (name, use) => {
    const list = index.get(name)
    if (list === undefined) index.set(name, [use])
    else list.push(use)
  }
  const visit = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
      const parent = node.parent
      const isDeclaration =
        (ts.isFunctionDeclaration(parent) ||
          ts.isVariableDeclaration(parent) ||
          ts.isClassDeclaration(parent)) &&
        parent.name === node
      if (ts.isImportSpecifier(parent)) {
        if (parent.propertyName === node) record(node.text, { alias: parent.name.text })
      } else if (ts.isBindingElement(parent) && parent.propertyName === node) {
        if (ts.isIdentifier(parent.name)) record(node.text, { alias: parent.name.text })
      } else if (!isDeclaration && !ts.isImportClause(parent))
        record(node.text, { owner: runsAtLoad(node) ? undefined : topLevelOwner(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  indexes.set(source, index)
  return index
}

/**
 * A test-only claim is proved, not asserted: every production use of the
 * owning top-level symbol must sit inside another symbol that is itself only
 * reachable that way, transitively. A use at module level (a call, an export,
 * a re-export, a string naming it) is production. Import bindings are not
 * uses. At least one symbol in the chain must be called by a test.
 */
export function proveTestOnly(program, symbol, root) {
  const relativeTo = (file) => path.relative(root, file).replaceAll('\\', '/')
  const references = []
  const chain = new Set([symbol])
  const pending = [symbol]
  const follow = (name) => {
    if (chain.has(name)) return
    chain.add(name)
    pending.push(name)
  }
  while (pending.length > 0) {
    const name = pending.pop()
    // Only a file whose text contains the name can use it.
    const word = new RegExp(name.replaceAll('$', String.raw`\$`), 'u')
    const sources = program.containing(word)
    for (const source of sources) {
      const uses = referenceIndex(source).get(name) ?? []
      for (const use of uses) {
        // `import { name as alias }` and `{ name: alias } = …`: the alias is the symbol.
        if (use.alias !== undefined) follow(use.alias)
        else if (use.owner === undefined) references.push(`${relativeTo(source.fileName)}:${name}`)
        else follow(use.owner)
      }
    }
  }
  const tests = program.tests()
  // A call or a member use in a test, not merely an import binding.
  const isExercised = [...chain].some((name) =>
    tests.some((text) => text.includes(`${name}(`) || text.includes(`${name}.`)),
  )
  return {
    references,
    exercised: isExercised,
    chain: [...chain].toSorted((left, right) => left.localeCompare(right)),
  }
}

export function inventoryTable(inventory) {
  return [
    '| Site | Profile | Reason |',
    '| --- | --- | --- |',
    ...inventory.map((entry) => `| \`${entry.site}\` | ${entry.profile} | ${entry.reason} |`),
  ].join('\n')
}
