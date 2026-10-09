// M121 type-checker money guard (replaces the PORTS017D runtime walk and text
// scan, PLAN.md M121 "Additions from RVPORTS017D"). The TypeScript compiler
// API reads every declaration under `src` and asks the checker for its type,
// so aliases, imported schemas, transforms, `_default`, literals, enums,
// maps, sets, records and module-local schemas behind exported parsers all
// resolve to what the code actually holds. A zod schema is judged by its
// declared OUTPUT type (`_zod.output`), the type `z.infer` gives callers.
import path from 'node:path'
import ts from 'typescript'

// `usd` is lowercase on purpose: the legacy journal row named its total `usd`.
export const MONEY_KEY = /Usd|usd|Cost|Price|^spend|Budget\w*Usd|Cap\w*Usd/
// Wider net for the non-money inventory (token budgets, worker caps).
const MONEY_HINT = /Usd|usd|Cost|Price|spend|Budget|Cap/

// Containers judged by the values they hold (a map's keys are not money).
const CONTAINERS = new Set(['Map', 'ReadonlyMap', 'Set', 'ReadonlySet', 'Promise'])

interface MoneyTypeFindings {
  /** `file:key` for every money-named declaration holding a number. */
  readonly flagged: ReadonlySet<string>
  /** `file:key` for every numeric declaration whose name has a money hint. */
  readonly numeric: ReadonlySet<string>
  /** How many source files the checker read (a vacuous program is a failure). */
  readonly files: number
}

/** Does this type hold a JavaScript number anywhere a value can sit? */
function hasNumber(checker: ts.TypeChecker, type: ts.Type, seen: Set<ts.Type>): boolean {
  if (seen.has(type)) return false
  seen.add(type)
  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return true
  if (type.isUnionOrIntersection())
    return type.types.some((member) => hasNumber(checker, member, seen))
  const zod = type.getProperty('_zod')
  if (zod !== undefined) {
    // A schema: judge what it parses to, never the schema object itself.
    const output = checker.getTypeOfSymbol(zod).getProperty('output')
    return output !== undefined && hasNumber(checker, checker.getTypeOfSymbol(output), seen)
  }
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return checker
      .getTypeArguments(type as ts.TypeReference)
      .some((member) => hasNumber(checker, member, seen))
  const name = type.getSymbol()?.getName()
  if (name !== undefined && CONTAINERS.has(name) && (type.flags & ts.TypeFlags.Object) !== 0) {
    const value = checker.getTypeArguments(type as ts.TypeReference).at(-1)
    return value !== undefined && hasNumber(checker, value, seen)
  }
  return checker.getIndexInfosOfType(type).some((info) => hasNumber(checker, info.type, seen))
}

function keyOf(checker: ts.TypeChecker, name: ts.Node): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const type = checker.getTypeAtLocation(name.expression)
    return type.isStringLiteral() ? type.value : undefined
  }
  return
}

function isSchema(checker: ts.TypeChecker, node: ts.Node): boolean {
  return checker.getTypeAtLocation(node).getProperty('_zod') !== undefined
}

// Properties of every kind (interfaces, classes, object literals, schema
// shapes, getters), plus the variables the PLAN names: a schema's output
// (`const fooUsd = z.number()`, exported or module-local) and a numeric
// literal constant (`const feeUsd = 0.5`). Ordinary locals and parameters
// hold intermediate values; the properties they reach are judged instead.
function declarationName(checker: ts.TypeChecker, node: ts.Node): ts.Node | undefined {
  if (
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isGetAccessorDeclaration(node)
  )
    return node.name
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer !== undefined &&
    (ts.isNumericLiteral(node.initializer) ||
      (ts.isPrefixUnaryExpression(node.initializer) &&
        ts.isNumericLiteral(node.initializer.operand)) ||
      isSchema(checker, node))
  )
    return node.name
  return
}

/** Walk every declaration of the given source files. */
function analyzeProgram(
  program: ts.Program,
  isTarget: (fileName: string) => boolean,
  label: (fileName: string) => string,
): MoneyTypeFindings {
  const checker = program.getTypeChecker()
  const flagged = new Set<string>()
  const numeric = new Set<string>()
  let files = 0
  for (const source of program.getSourceFiles()) {
    if (!isTarget(source.fileName)) continue
    files += 1
    const file = label(source.fileName)
    const visit = (node: ts.Node): void => {
      const name = declarationName(checker, node)
      const key = name === undefined ? undefined : keyOf(checker, name)
      if (name !== undefined && key !== undefined && MONEY_HINT.test(key)) {
        const signature = ts.isGetAccessorDeclaration(node)
          ? checker.getSignatureFromDeclaration(node)
          : undefined
        const type =
          signature === undefined
            ? checker.getTypeAtLocation(ts.isShorthandPropertyAssignment(node) ? node.name : node)
            : checker.getReturnTypeOfSignature(signature)
        if (hasNumber(checker, type, new Set())) {
          numeric.add(`${file}:${key}`)
          if (MONEY_KEY.test(key)) flagged.add(`${file}:${key}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { flagged, numeric, files }
}

/** The unit project's options (Node + DOM), so host, core and webview share one program. */
function unitCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, 'test', 'unit', 'tsconfig.json')
  const config = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  return { ...parsed.options, noEmit: true }
}

/** Every `.ts`/`.tsx` under `src`, judged in one program. */
export function analyzeSource(root: string, fileNames: readonly string[]): MoneyTypeFindings {
  const program = ts.createProgram({ rootNames: fileNames, options: unitCompilerOptions(root) })
  const srcRoot = `${path.join(root, 'src').replaceAll('\\', '/')}/`
  return analyzeProgram(
    program,
    (fileName) => fileName.replaceAll('\\', '/').startsWith(srcRoot),
    (fileName) => fileName.replaceAll('\\', '/').slice(srcRoot.length),
  )
}

/**
 * In-memory fixtures for the regression probes: each fixture is a virtual
 * module beside the real tree (so `zod/mini` resolves from node_modules), and
 * only fixture files are judged.
 */
export function analyzeFixtures(
  root: string,
  fixtures: Readonly<Record<string, string>>,
): MoneyTypeFindings {
  const options = unitCompilerOptions(root)
  const folder = path.join(root, 'test', 'unit', '__moneyGuardFixtures__')
  const entries = Object.entries(fixtures).map(
    ([name, text]) => [path.join(folder, name).replaceAll('\\', '/'), text] as const,
  )
  const virtual = new Map(entries)
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (file) => virtual.get(file.replaceAll('\\', '/')) ?? readFile(file)
  host.fileExists = (file) => virtual.has(file.replaceAll('\\', '/')) || fileExists(file)
  // The fixture folder exists only in memory; module resolution between
  // fixtures asks for it first.
  const fixtureFolder = folder.replaceAll('\\', '/')
  const directoryExists = host.directoryExists?.bind(host)
  host.directoryExists = (directory) =>
    directory.replaceAll('\\', '/') === fixtureFolder || (directoryExists?.(directory) ?? true)
  host.getSourceFile = (file, language, onError, shouldCreate) => {
    const text = virtual.get(file.replaceAll('\\', '/'))
    return text === undefined
      ? getSourceFile(file, language, onError, shouldCreate)
      : ts.createSourceFile(file, text, language)
  }
  const program = ts.createProgram({ rootNames: entries.map(([file]) => file), options, host })
  return analyzeProgram(
    program,
    (fileName) => virtual.has(fileName.replaceAll('\\', '/')),
    (fileName) => path.basename(fileName),
  )
}
