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
// Plain substrings first (cheap); a word-bounded check only for the short words.
const CANDIDATE_WORDS = [
  'child_process',
  'worker_threads',
  'spawn',
  'execFile',
  'execSync',
  'fork',
  'ResourceFile',
  'runBootstrap',
  ...[...PROCESS_WRAPPERS].filter((name) => name !== 'zx'),
]
const CANDIDATE_BOUNDED = /\bWorker\b|\bzx\b|(?<![.\w])exec\b/u
const CANDIDATE = {
  test: (text) =>
    CANDIDATE_WORDS.some((word) => text.includes(word)) || CANDIDATE_BOUNDED.test(text),
}
const isWorkerModule = (text) => text === 'worker_threads' || text === 'node:worker_threads'
/** The module a `require('m')` or `(await) import('m')` initializer loads, if literal. */
function loadedModule(initializer) {
  let expression = initializer
  while (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression))
    expression = expression.expression
  if (!ts.isCallExpression(expression)) return
  const loader = expression.expression
  const isLoader =
    loader.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(loader) && loader.text === 'require')
  const [argument] = expression.arguments
  return isLoader && argument !== undefined && ts.isStringLiteral(argument)
    ? argument.text
    : undefined
}
/** Bounded concurrency: a cold Windows checkout pays per open file, not per byte. */
const READ_CONCURRENCY = 16
async function readAll(files) {
  const texts = new Map()
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const index = next++
      texts.set(files[index], await fs.promises.readFile(files[index], 'utf8'))
    }
  }
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker))
  return new Map(files.map((name) => [name, texts.get(name)]))
}
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
 * The source corpus, read with bounded concurrency. A first read of thousands of
 * files is slow on a fresh Windows checkout; a test reads it here, in its hook.
 * Test files are not prefetched: a proof reads them lazily, likeliest first.
 */
export async function readCorpus(root) {
  return { sources: await readAll(sourceFiles(root)) }
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
  // Each test file is read at most once per scan, and only when a proof needs it.
  let names
  const testTexts = new Map()
  const tests = () => (names ??= testFiles(root))
  const testText = (name) => {
    let text = testTexts.get(name)
    if (text === undefined) {
      text = fs.readFileSync(name, 'utf8')
      testTexts.set(name, text)
    }
    return text
  }
  return { containing, tests, testText, testsRead: () => testTexts.size }
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
    // Local names of worker_threads' Worker (any `.Worker` member also counts).
    const workers = new Set(['Worker'])
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
    // A Worker class by its local name, or any `.Worker` / `['Worker']` member
    // (a namespace, default import or re-export of worker_threads, spelled any way).
    const isWorkerClass = (expression) =>
      ts.isIdentifier(expression)
        ? workers.has(expression.text)
        : (ts.isPropertyAccessExpression(expression) && expression.name.text === 'Worker') ||
          (ts.isElementAccessExpression(expression) &&
            ts.isStringLiteralLike(expression.argumentExpression) &&
            expression.argumentExpression.text === 'Worker')
    const launchOf = (expression) => {
      if (ts.isIdentifier(expression)) {
        const operation = aliases.get(expression.text) ?? expression.text
        return operations.has(operation) ? operation : undefined
      }
      if (!ts.isPropertyAccessExpression(expression)) return
      const operation = expression.name.text
      if (!operations.has(operation)) return
      // `x.exec` is RegExp.exec unless x is a child_process binding.
      if (
        operation === 'exec' &&
        !(ts.isIdentifier(expression.expression) && namespaces.has(expression.expression.text))
      )
        return
      return operation
    }
    const imports = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isWorkerModule(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings))
          for (const entry of bindings.elements)
            if ((entry.propertyName ?? entry.name).text === 'Worker') workers.add(entry.name.text)
      }
      // A re-export carries a launch past this file's own uses: it is a site.
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        if (isChildModule(node.moduleSpecifier.text)) add('import', node)
        if (isWrapperModule(node.moduleSpecifier.text)) add('wrapper', node)
        if (
          isWorkerModule(node.moduleSpecifier.text) &&
          (node.exportClause === undefined ||
            (ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.some(
                (entry) => (entry.propertyName ?? entry.name).text === 'Worker',
              )) ||
            ts.isNamespaceExport(node.exportClause))
        )
          add('worker', node)
      }
      // Any binding of a `Worker` property is that class: `{ Worker: Thread } = …`.
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name))
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name
          if (
            ts.isIdentifier(property) &&
            property.text === 'Worker' &&
            ts.isIdentifier(element.name)
          )
            workers.add(element.name.text)
        }
      // `const Thread = Worker` or `= wt.Worker`.
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isWorkerClass(node.initializer)
      )
        workers.add(node.name.text)
      // `const run = spawn.bind(null)`: a bound launch is that launch.
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        ts.isPropertyAccessExpression(node.initializer.expression) &&
        node.initializer.expression.name.text === 'bind'
      ) {
        const operation = launchOf(node.initializer.expression.expression)
        if (operation !== undefined) aliases.set(node.name.text, operation)
      }
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
      // `const launch = cp.spawn` (and `cp.exec` on a child_process binding)
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        ts.isPropertyAccessExpression(node.initializer)
      ) {
        const operation = launchOf(node.initializer)
        if (operation !== undefined) aliases.set(node.name.text, operation)
      }
      // `const cp = require('child_process')` or `await import(…)`: a namespace.
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined &&
        isChildModule(loadedModule(node.initializer) ?? '')
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
        !ts.isVariableDeclaration(node) ||
        !ts.isIdentifier(node.name) ||
        node.initializer === undefined ||
        !ts.isIdentifier(node.initializer)
      )
        return
      const operation = aliases.get(node.initializer.text) ?? node.initializer.text
      if (operations.has(operation)) aliases.set(node.name.text, operation)
    }
    // One traversal: bindings are collected everywhere, and only the nodes that can
    // be sites are kept, in source order, to be checked once every binding is known.
    const candidates = []
    const walk = (node) => {
      imports(node)
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTemplateExpression(node) ||
        (ts.isStringLiteralLike(node) && LAUNCH_TEXT.test(node.text))
      )
        candidates.push(node)
      ts.forEachChild(node, walk)
    }
    walk(source)
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
        if (
          ts.isPropertyAccessExpression(expression) &&
          ['call', 'apply'].includes(expression.name.text)
        ) {
          const operation = launchOf(expression.expression)
          if (operation !== undefined) add(`call:${operation}`, node, isEmbedded)
        }
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
      if (ts.isNewExpression(node) && isWorkerClass(node.expression)) {
        const [, options] = node.arguments ?? []
        // Program text (eval) is a site; options that cannot be read statically are too.
        const isEval =
          options !== undefined &&
          (!ts.isObjectLiteralExpression(options) ||
            options.properties.some(
              (property) =>
                !ts.isPropertyAssignment(property) ||
                (property.name !== undefined &&
                  ts.isIdentifier(property.name) &&
                  property.name.text === 'eval'),
            ))
        if (isEval) add('worker', node, isEmbedded)
      }
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
      // Only an embedded program is walked here; the file's own nodes were collected.
      if (isEmbedded) ts.forEachChild(node, (child) => visit(child, true))
    }
    for (const node of candidates) visit(node)
  }
  return { sites, program: tree }
}

/**
 * A function expression that may run where it is written: called at once
 * (an IIFE) or handed to a call, which can call it before returning.
 */
function runsInPlace(node) {
  let current = node
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent
  const parent = current.parent
  return (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    (parent.expression === current || (parent.arguments ?? []).includes(current))
  )
}

/**
 * A call that runs when the module loads: written outside any deferred
 * function, or inside code evaluated with its class (static fields and blocks,
 * decorators, `extends`, computed names) or with its enclosing call (IIFEs,
 * callbacks handed to a load-time call). Only an uncalled function or method
 * body, or an instance member, defers it.
 */
function runsAtLoad(node) {
  const parent = node.parent
  const isCallee =
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node
  if (!isCallee) return false
  let isEagerMember = false
  for (let current = parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isDecorator(current)) {
      // Evaluated when its class is defined, whatever member or parameter it decorates.
      isEagerMember = true
      while (!ts.isClassLike(current.parent) && !ts.isSourceFile(current.parent))
        current = current.parent
      continue
    }
    const isStatic =
      ts.isPropertyDeclaration(current) &&
      (ts.getModifiers(current) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
      )
    if (
      isStatic ||
      ts.isClassStaticBlockDeclaration(current) ||
      ts.isHeritageClause(current) ||
      ts.isComputedPropertyName(current)
    ) {
      isEagerMember = true
      continue
    }
    if (ts.isClassLike(current)) {
      if (!isEagerMember) return false
      isEagerMember = false
      continue
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && runsInPlace(current))
      continue
    if (ts.isFunctionLike(current)) return false
  }
  return true
}

/** Lowercase words of a symbol or path, for ranking likely test files first. */
const words = (text) =>
  text
    .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter((word) => word.length > 2)

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
    // Only a file whose text contains the name can use it. A plain substring
    // match: identifiers hold no pattern syntax, and semgrep refuses a RegExp
    // built from data (detect-non-literal-regexp).
    const word = { test: (text) => text.includes(name) }
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
  // A call or a member use in a test, not merely an import binding. Tests are
  // read lazily, files sharing a word with the chain first; the first use ends it.
  const wanted = new Set([...chain].flatMap((name) => words(name)))
  const ranked = program
    .tests()
    .map((file) => ({ file, score: words(relativeTo(file)).filter((w) => wanted.has(w)).length }))
    .toSorted((left, right) => right.score - left.score || left.file.localeCompare(right.file))
  const isExercised = ranked.some(({ file }) => {
    const text = program.testText(file)
    return [...chain].some((name) => text.includes(`${name}(`) || text.includes(`${name}.`))
  })
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
