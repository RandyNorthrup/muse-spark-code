#!/usr/bin/env node
// The host API record (M60, PLAN.md D60), part of `quality:gates`.
//
// Muse Spark Code is to run in hosts other than VS Code (D60): editors that
// implement the VS Code API themselves (Theia documents gaps and stubs),
// remote hosts, and adapters that load the engine with no `vscode` module
// at all. This gate keeps one record of what the extension asks of its
// host, so each target can be checked against it:
//
// - the manifest's facts (engines, extensionKind, entry points,
//   capabilities, activation events, contribution points) and the build
//   targets of the bundles;
// - every VS Code API the host code uses at run time, found with
//   TypeScript's checker: a function, variable, class, enum or member
//   declared in @types/vscode and used outside a type; the members of a
//   VS Code interface the code implements (a provider's method, an options
//   object's field), since the host calls or reads those; and the members
//   of a VS Code object handed to code that takes it by shape (the log
//   channel, SecretStorage), since that code calls them; with the files
//   that use each;
// - the files that import `vscode`: the VS Code adapter;
// - the Node built-ins the host imports;
// - what the webview asks of its host: `acquireVsCodeApi`, and the
//   `--vscode-*` theme variables its styles read.
//
// The record is docs/ide-compatibility/host-api.md, formatted as Prettier
// would. The check fails when the record differs from the source (a new
// API, a new file importing `vscode`, a theme variable): regenerate it
// with --write and review the diff, since each new entry is one more thing
// every target has to provide.
//
// Whatever the record says, the portable code never reaches `vscode`
// through its imports, type-only ones included, nor names one of the
// global types `@types/vscode` declares (`Thenable`), which needs no
// import: everything under PORTABLE_ROOTS and the host modules
// PORTABLE_HOST lists. That fails even after --write; the fix is in the
// code.
//
//   node scripts/check-host-api.mjs          check (quality:gates)
//   node scripts/check-host-api.mjs --write  regenerate the record

import { builtinModules } from 'node:module'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as prettier from 'prettier'
import ts from 'typescript'

const RECORD = 'docs/ide-compatibility/host-api.md'
const MANIFEST = 'package.json'
const HOST_PROJECT = 'tsconfig.json'
const BUILD_SCRIPT = 'scripts/build.mjs'
const SOURCE_ROOT = 'src'
const WEBVIEW_ROOT = 'src/webview'
// Code other hosts load as it is: the engine, the protocol, the React app,
// and the ACP agent with its process (M63, D62), which run with no VS Code.
const PORTABLE_ROOTS = ['src/core', 'src/shared', 'src/webview', 'src/acp', 'src/runtime']
// Host modules another adapter reuses (D60, M61): the conversation, both
// backends and their tool harness, the credential store, the session
// store, the `ide` MCP server.
const PORTABLE_HOST = [
  'src/host/auth/authService.ts',
  'src/host/auth/credentialStore.ts',
  'src/host/backend/fileSessionStore.ts',
  'src/host/backend/modelApiBackendManager.ts',
  'src/host/backend/museCodeBackendManager.ts',
  'src/host/backend/toolIo.ts',
  'src/host/conversation/conversationController.ts',
  'src/host/ide/ideMcpServer.ts',
]
const VSCODE_MODULE = 'vscode'
const VSCODE_DECLARATIONS = '/node_modules/@types/vscode/'
const NODE_SCHEME = 'node:'
const WEBVIEW_HOST_CALL = 'acquireVsCodeApi'
const THEME_VARIABLE = /--vscode-[\w-]+/g
const SCRIPT_FILE = /\.tsx?$/
const STYLE_FILE = /\.css$/
const RESOLVABLE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const BUILD_TARGET = /const (\w+)_TARGET = '([^']+)'/g
const WRITE_FLAG = '--write'
// A symbol that only names a place in the API (the `vscode` module, a
// namespace such as `window`): its members are the API.
const CONTAINER = ts.SymbolFlags.Module
// A symbol that qualifies a member (`Uri` in `Uri.file`): recorded only
// when it is used by itself (`new Uri`, `instanceof FileSystemError`).
const QUALIFIER = ts.SymbolFlags.Class | ts.SymbolFlags.Enum | ts.SymbolFlags.Interface

/** Forward-slash path relative to the repository root. */
function relative(fileName) {
  return path.relative(process.cwd(), fileName).split(path.sep).join('/')
}

/** Code-unit order: the same on every machine, whatever its locale data. */
function byName(a, b) {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

function listFiles(root, pattern) {
  const found = []
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(full, pattern))
    } else if (pattern.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      found.push(relative(full))
    }
  }
  return found.toSorted(byName)
}

function addTo(map, key, file) {
  const files = map.get(key) ?? new Set()
  files.add(file)
  map.set(key, files)
}

// --- imports -----------------------------------------------------------------

/** Every module a file names: imports and re-exports (type-only too), `import()`, `require()`. */
function moduleSpecifiers(sourceFile) {
  const specifiers = []
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

/** The source file a relative specifier names, or undefined for a stylesheet or JSON. */
function resolveRelative(fromFile, specifier) {
  const base = path.join(path.dirname(fromFile), specifier)
  for (const suffix of RESOLVABLE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (SCRIPT_FILE.test(candidate) && existsSync(candidate)) {
      return relative(candidate)
    }
  }
  if (existsSync(base)) {
    return
  }
  throw new Error(`${fromFile}: cannot resolve "${specifier}"`)
}

/** Each source file's relative imports (resolved) and package or built-in imports. */
function importGraph(files) {
  const graph = new Map()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const local = new Set()
    const external = new Set()
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (specifier.startsWith('.')) {
        const target = resolveRelative(file, specifier)
        if (target !== undefined) {
          local.add(target)
        }
      } else {
        external.add(specifier)
      }
    }
    graph.set(file, { local, external, sourceFile })
  }
  return graph
}

/** The import chain from `root` to a file that imports `vscode`, or undefined. */
function chainToVsCode(graph, root) {
  const seen = new Set([root])
  const queue = [[root]]
  while (queue.length > 0) {
    const chain = queue.shift()
    const node = graph.get(chain.at(-1))
    if (node === undefined) {
      continue
    }
    if (node.external.has(VSCODE_MODULE)) {
      return chain
    }
    for (const next of node.local) {
      if (seen.has(next)) {
        continue
      }
      seen.add(next)
      queue.push([...chain, next])
    }
  }
}

function nodeBuiltin(specifier) {
  const name = specifier.startsWith(NODE_SCHEME) ? specifier.slice(NODE_SCHEME.length) : specifier
  return builtinModules.includes(name) ? `${NODE_SCHEME}${name}` : undefined
}

// --- VS Code API uses ----------------------------------------------------------

function isVsCodeDeclaration(declaration) {
  return declaration.getSourceFile().fileName.includes(VSCODE_DECLARATIONS)
}

/**
 * `window.showErrorMessage`, `Uri.file`, `Webview.postMessage`: the name
 * from the declaration's containers. A field of an inline options type
 * names its function and parameter:
 * `window.createOutputChannel(options.log)`.
 */
function apiName(symbol) {
  const declaration = symbol.declarations?.[0]
  if (
    declaration === undefined ||
    !isVsCodeDeclaration(declaration) ||
    (symbol.flags & CONTAINER) !== 0
  ) {
    return
  }
  let names = [symbol.name]
  for (let node = declaration.parent; node !== undefined; node = node.parent) {
    if (
      (ts.isModuleDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isParameter(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      names.unshift(node.name.text)
    } else if (ts.isFunctionLike(node) && node.name !== undefined && ts.isIdentifier(node.name)) {
      names = [`${node.name.text}(${names.join('.')})`]
    }
  }
  return names.join('.')
}

function referencedSymbol(checker, identifier) {
  const symbol = checker.getSymbolAtLocation(identifier)
  return symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0
    ? symbol
    : checker.getAliasedSymbol(symbol)
}

/** `Uri` in `vscode.Uri.file`: the qualifier of a longer name. */
function isQualifier(identifier) {
  const access = identifier.parent
  if (!ts.isPropertyAccessExpression(access)) {
    return false
  }
  return access.name === identifier
    ? ts.isPropertyAccessExpression(access.parent) && access.parent.expression === access
    : access.expression === identifier
}

function memberName(member) {
  return member.name !== undefined &&
    (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
    ? member.name.text
    : undefined
}

/** Members of a VS Code interface the code supplies: a class that implements it, an object literal typed by it. */
function implementedMembers(checker, node, record) {
  if (ts.isClassLike(node)) {
    const clauses = node.heritageClauses ?? []
    for (const clause of clauses) {
      if (clause.token !== ts.SyntaxKind.ImplementsKeyword) {
        continue
      }
      for (const implemented of clause.types) {
        const type = checker.getTypeAtLocation(implemented)
        for (const member of node.members) {
          const name = memberName(member)
          const property = name === undefined ? undefined : checker.getPropertyOfType(type, name)
          if (property !== undefined) {
            record(apiName(property))
          }
        }
      }
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    const contextual = checker.getContextualType(node)
    if (contextual === undefined) {
      return
    }
    const type = checker.getNonNullableType(contextual)
    for (const property of node.properties) {
      const name = memberName(property)
      const member = name === undefined ? undefined : checker.getPropertyOfType(type, name)
      if (member !== undefined) {
        record(apiName(member))
      }
    }
  }
}

function isVsCodeType(type) {
  const symbol = type.aliasSymbol ?? type.getSymbol()
  const declaration = symbol?.declarations?.[0]
  return declaration !== undefined && isVsCodeDeclaration(declaration)
}

/** Where a value is handed to something typed by the receiver: an argument, a field, an initializer, a return. */
function isHandedOver(node) {
  const { parent } = node
  return (
    ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      (parent.arguments ?? []).includes(node)) ||
    ((ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) &&
      parent.initializer === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name === node) ||
    (ts.isReturnStatement(parent) && parent.expression === node) ||
    (ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === node)
  )
}

/**
 * A VS Code object handed to code that takes it by shape (the log channel
 * to `createLogger`, `SecretStorage` to the credential store): the members
 * that shape names are used, though no VS Code type is in sight there.
 */
function handedOverMembers(checker, node, record) {
  if (!ts.isExpression(node) || !isHandedOver(node)) {
    return
  }
  const source = checker.getTypeAtLocation(node)
  const target = checker.getContextualType(node)
  if (target === undefined || !isVsCodeType(source) || isVsCodeType(target)) {
    return
  }
  const properties = checker.getPropertiesOfType(checker.getNonNullableType(target))
  for (const property of properties) {
    const member = checker.getPropertyOfType(source, property.name)
    if (member !== undefined) {
      record(apiName(member))
    }
  }
}

/** Every VS Code API the host's code uses at run time, with the files using it. */
/** The host project's program (tsconfig.json), with the VS Code types it compiles against. */
function hostProgram() {
  const configPath = path.resolve(HOST_PROJECT)
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  return ts.createProgram({ rootNames: config.fileNames, options: config.options })
}

/**
 * A VS Code declaration a portable file names without importing it: the
 * ambient globals `@types/vscode` declares (`Thenable`), which no import
 * shows. Each as "file: name".
 */
function ambientVsCodeNames(program, portableFiles) {
  const checker = program.getTypeChecker()
  const found = new Set()
  for (const sourceFile of program.getSourceFiles()) {
    const file = relative(sourceFile.fileName)
    if (!portableFiles.has(file)) {
      continue
    }
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        const declaration = referencedSymbol(checker, node)?.declarations?.[0]
        if (declaration !== undefined && isVsCodeDeclaration(declaration)) {
          found.add(`${file}: ${node.text}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return found
}

function vsCodeApiUses(program, files) {
  const checker = program.getTypeChecker()
  const hostFiles = new Set(files)
  const uses = new Map()
  for (const sourceFile of program.getSourceFiles()) {
    const file = relative(sourceFile.fileName)
    if (!hostFiles.has(file)) {
      continue
    }
    const record = (name) => {
      if (name !== undefined) {
        addTo(uses, name, file)
      }
    }
    const visit = (node) => {
      // Import lines and types are not run-time uses; a class's `extends`
      // is, so its expression is still read.
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
        return
      }
      if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword) {
        if (ts.isClassLike(node.parent)) {
          for (const type of node.types) {
            visit(type.expression)
          }
        }
        return
      }
      if (ts.isTypeNode(node)) {
        return
      }
      implementedMembers(checker, node, record)
      handedOverMembers(checker, node, record)
      if (ts.isIdentifier(node)) {
        const symbol = referencedSymbol(checker, node)
        if (symbol !== undefined && ((symbol.flags & QUALIFIER) === 0 || !isQualifier(node))) {
          record(apiName(symbol))
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return uses
}

// --- the webview ---------------------------------------------------------------

function webviewHostCalls(graph) {
  const calls = new Map()
  for (const [file, { sourceFile }] of graph) {
    if (!file.startsWith(`${WEBVIEW_ROOT}/`)) {
      continue
    }
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === WEBVIEW_HOST_CALL) {
        addTo(calls, WEBVIEW_HOST_CALL, file)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return calls
}

function themeVariables() {
  const variables = new Map()
  for (const file of [
    ...listFiles(WEBVIEW_ROOT, SCRIPT_FILE),
    ...listFiles(WEBVIEW_ROOT, STYLE_FILE),
  ]) {
    for (const [variable] of readFileSync(file, 'utf8').matchAll(THEME_VARIABLE)) {
      addTo(variables, variable, file)
    }
  }
  return variables
}

// --- the record ------------------------------------------------------------------

function code(text) {
  return `\`${text}\``
}

function codeList(texts) {
  return texts.map((text) => code(text)).join(', ')
}

function fileList(files) {
  return codeList(files.values().toArray().toSorted(byName))
}

function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function sortedEntries(map) {
  return map
    .entries()
    .toArray()
    .toSorted(([a], [b]) => byName(a, b))
}

function manifestRows(manifest) {
  const contributes = manifest.contributes ?? {}
  const contributionPoints = Object.keys(contributes)
    .toSorted(byName)
    .map((point) => {
      const value = contributes[point]
      const size = Array.isArray(value) ? value.length : Object.keys(value).length
      return `${code(point)} (${String(size)})`
    })
  const capabilities = manifest.capabilities ?? {}
  return [
    ['`engines.vscode`', code(manifest.engines.vscode)],
    ['`engines.node`', code(manifest.engines.node)],
    ['`main`', manifest.main === undefined ? 'none' : code(manifest.main)],
    ['`browser`', manifest.browser === undefined ? 'none' : code(manifest.browser)],
    ['`extensionKind`', codeList(manifest.extensionKind ?? [])],
    [
      '`capabilities.virtualWorkspaces`',
      code(String(capabilities.virtualWorkspaces?.supported ?? 'unset')),
    ],
    [
      '`capabilities.untrustedWorkspaces`',
      code(String(capabilities.untrustedWorkspaces?.supported ?? 'unset')),
    ],
    ['`enabledApiProposals`', codeList(manifest.enabledApiProposals ?? []) || 'none'],
    ['`activationEvents`', codeList(manifest.activationEvents ?? []) || 'none'],
    ['`contributes`', contributionPoints.join(', ')],
  ]
}

function buildTargets() {
  const text = readFileSync(BUILD_SCRIPT, 'utf8')
  const targets = text
    .matchAll(BUILD_TARGET)
    .map(([, name, target]) => [code(name.toLowerCase()), code(target)])
    .toArray()
  if (targets.length === 0) {
    throw new Error(`${BUILD_SCRIPT}: no *_TARGET constant found`)
  }
  return targets
}

function renderRecord({ manifest, apis, adapterFiles, builtins, hostCalls, variables }) {
  const adapterRows = adapterFiles
    .entries()
    .map(([file, count]) => [code(file), String(count)])
    .toArray()
  return [
    '# Host API record',
    '',
    'What Muse Spark Code asks of its host (PLAN.md D60, M60). Generated by',
    '`node scripts/check-host-api.mjs --write`; `npm run check:host-api` fails when it',
    'differs from the source. Do not edit it by hand.',
    '',
    '## Manifest',
    '',
    table(['Field', 'Value'], manifestRows(manifest)),
    '',
    '## Build targets',
    '',
    table(['Bundle', 'esbuild target'], buildTargets()),
    '',
    '## Files that import `vscode`',
    '',
    `The VS Code adapter: ${String(adapterFiles.size)} files. Everything else reaches VS Code only through them.`,
    '',
    table(['File', 'VS Code APIs used'], adapterRows),
    '',
    '## Portable modules',
    '',
    'These never reach `vscode` through their imports, type-only ones included; the gate fails if one does:',
    '',
    ...PORTABLE_ROOTS.map((root) => `- everything under ${code(`${root}/`)}`),
    ...PORTABLE_HOST.map((file) => `- ${code(file)}`),
    '',
    `## VS Code API used at run time (${String(apis.size)})`,
    '',
    'Functions, variables, classes, enums and members declared in `@types/vscode`; the members of a VS Code interface the code implements (a provider, an options object); and the members of a VS Code object handed to code that takes it by shape.',
    '',
    table(
      ['API', 'Files'],
      sortedEntries(apis).map(([name, files]) => [code(name), fileList(files)]),
    ),
    '',
    `## Node built-ins the host imports (${String(builtins.size)})`,
    '',
    table(
      ['Module', 'Files'],
      sortedEntries(builtins).map(([name, files]) => [code(name), String(files.size)]),
    ),
    '',
    "## The webview's host",
    '',
    table(
      ['Call', 'Files'],
      sortedEntries(hostCalls).map(([name, files]) => [code(name), fileList(files)]),
    ),
    '',
    `Theme variables the styles read (${String(variables.size)}), from ${fileList(new Set(variables.values().flatMap((files) => files.values())))}:`,
    '',
    sortedEntries(variables)
      .map(([name]) => code(name))
      .join(', '),
    '',
  ].join('\n')
}

// --- main --------------------------------------------------------------------------

const sourceFiles = listFiles(SOURCE_ROOT, SCRIPT_FILE)
const graph = importGraph(sourceFiles)
const hostFiles = sourceFiles.filter((file) => !file.startsWith(`${WEBVIEW_ROOT}/`))

const problems = []
const portable = [
  ...sourceFiles.filter((file) => PORTABLE_ROOTS.some((root) => file.startsWith(`${root}/`))),
  ...PORTABLE_HOST,
]
for (const file of portable) {
  if (!graph.has(file)) {
    problems.push(`${file}: listed as portable but not found`)
    continue
  }
  const chain = chainToVsCode(graph, file)
  if (chain !== undefined) {
    problems.push(`${file} reaches \`vscode\`: ${[...chain, VSCODE_MODULE].join(' -> ')}`)
  }
}

const program = hostProgram()
const ambientUses = ambientVsCodeNames(program, new Set(portable))
for (const use of ambientUses) {
  problems.push(`${use} is a VS Code type, which portable code does not use`)
}
const apis = vsCodeApiUses(program, hostFiles)
const apisPerFile = new Map()
for (const files of apis.values()) {
  for (const file of files) {
    apisPerFile.set(file, (apisPerFile.get(file) ?? 0) + 1)
  }
}
const adapterFiles = new Map(
  hostFiles
    .filter((file) => graph.get(file)?.external.has(VSCODE_MODULE))
    .map((file) => [file, apisPerFile.get(file) ?? 0]),
)
const builtins = new Map()
for (const file of hostFiles) {
  const specifiers = graph.get(file)?.external ?? []
  for (const specifier of specifiers) {
    const builtin = nodeBuiltin(specifier)
    if (builtin !== undefined) {
      addTo(builtins, builtin, file)
    }
  }
}
const hostCalls = webviewHostCalls(graph)
const variables = themeVariables()
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

const rendered = renderRecord({ manifest, apis, adapterFiles, builtins, hostCalls, variables })
const prettierOptions = { ...(await prettier.resolveConfig(RECORD)), filepath: RECORD }
const record = await prettier.format(rendered, prettierOptions)
const summary = `${String(apis.size)} VS Code APIs, ${String(adapterFiles.size)} files importing vscode, ${String(builtins.size)} Node built-ins, ${String(variables.size)} theme variables`

if (process.argv.includes(WRITE_FLAG)) {
  writeFileSync(RECORD, record)
  console.log(`host-api: wrote ${RECORD} (${summary})`)
} else {
  const current = existsSync(RECORD) ? readFileSync(RECORD, 'utf8') : ''
  if (current !== record) {
    const before = new Set(current.split('\n'))
    const after = new Set(record.split('\n'))
    const removed = [...before.difference(after)]
    const added = [...after.difference(before)]
    problems.push(
      [
        `${RECORD} is not what the source gives; run \`npm run check:host-api -- --write\` and review the diff:`,
        ...removed.map((line) => `  - ${line}`),
        ...added.map((line) => `  + ${line}`),
      ].join('\n'),
    )
  }
}

for (const problem of problems) {
  console.error(`FAIL ${problem}`)
}
console.log(`host-api: ${summary}; ${String(problems.length)} problem(s)`)
if (problems.length > 0) {
  process.exit(1)
}
