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

/**
How many edges a type walk follows from where it starts (M121F round 3,
RVM121F/RVM121F2). Every instantiation of a generic is a new `ts.Type`, so
a recursive generic (`Chain<T>` → `Chain<T[]>` → `Chain<T[][]>` …) never
repeats an instance and an unbounded walk never ends; pruning by
declaration instead hid finite nesting of one generic (`Box<Box<…>>`). A
fixed depth judges every finite nesting up to it and stops every infinite
chain. Each edge is one level: a property, union or intersection member,
base or apparent type, schema output, element or container value.
Measured on `src` (2026-10-10): every flagged money key is found by depth
2 and the whole numeric-hint inventory by depth 7, so twelve keeps five
levels of headroom while a branching recursive generic stays cheap (at
most 2^12 paths for two branches).
*/
export const MAX_TYPE_DEPTH = 12

/**
Every type within `MAX_TYPE_DEPTH` edges of `start`, breadth first. Each
type is first met at its shortest distance, and a type already met is
expanded then with at least as much depth left as any later path would
give it: which types are judged depends on the graph alone, never on the
order siblings are listed in.
*/
function* reachable(
  start: ts.Type,
  next: (type: ts.Type) => Iterable<ts.Type>,
): Generator<ts.Type, void, undefined> {
  const seen = new Set<ts.Type>([start])
  let level: readonly ts.Type[] = [start]
  for (let depth = 0; level.length > 0; depth += 1) {
    yield* level
    if (depth === MAX_TYPE_DEPTH) return
    const following: ts.Type[] = []
    for (const type of level)
      for (const child of next(type)) {
        if (seen.has(child)) continue
        seen.add(child)
        following.push(child)
      }
    level = following
  }
}

/** A callable's members (`length`, `bind`) are not money. */
function isCallable(checker: ts.TypeChecker, type: ts.Type): boolean {
  return (
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
    checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
  )
}

/**
A type's value-holding properties with their types. Encapsulated
`#private` state is not a declared money holding: skipping it keeps exact
`Usd` instances (whose only number is the private places count) unflagged.
*/
function* valueProperties(
  checker: ts.TypeChecker,
  type: ts.Type,
): Generator<readonly [string, ts.Type], void, undefined> {
  for (const property of type.getProperties()) {
    const key = property.getName()
    if (key.startsWith('#')) continue
    const propertyType = checker.getTypeOfSymbol(property)
    if (!isCallable(checker, propertyType)) yield [key, propertyType]
  }
}

/**
A zod schema is judged by its declared output (what `z.infer` gives
callers), never its own object or input side: `~standard.types.input`
accepts versioned-reader numbers the boundary converts exactly, which no
holding ever is. Undefined for a type that is not a schema.
*/
function schemaOutput(checker: ts.TypeChecker, type: ts.Type): ts.Type[] | undefined {
  const zod = type.getProperty('_zod')
  if (zod === undefined) return
  const output = checker.getTypeOfSymbol(zod).getProperty('output')
  return output === undefined ? [] : [checker.getTypeOfSymbol(output)]
}

/** Where a value of this type can sit: the edges `hasNumber` follows. */
function holdings(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] {
  if (type.isUnionOrIntersection()) return type.types
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    // The apparent primitive is boxed: Number hides its numeric holding and
    // String adds an unrelated numeric length. Judge the actual constraint.
    const holding = checker.getBaseConstraintOfType(type) ?? checker.getApparentType(type)
    return holding === type ? [] : [holding]
  }
  const output = schemaOutput(checker, type)
  if (output !== undefined) return output
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return checker.getTypeArguments(type as ts.TypeReference)
  const name = type.getSymbol()?.getName()
  if (name !== undefined && CONTAINERS.has(name) && (type.flags & ts.TypeFlags.Object) !== 0)
    return checker.getTypeArguments(type as ts.TypeReference).slice(-1)
  const values = checker.getIndexInfosOfType(type).map((info) => info.type)
  // Finite-key records and mapped types expose money as named properties,
  // not index signatures: judge each property's type (P3-3).
  if ((type.flags & ts.TypeFlags.Object) !== 0)
    for (const [, propertyType] of valueProperties(checker, type)) values.push(propertyType)
  return values
}

/** Does this type hold a JavaScript number anywhere a value can sit? */
function hasNumber(checker: ts.TypeChecker, type: ts.Type): boolean {
  const held = reachable(type, (holder) => holdings(checker, holder))
  for (const value of held) if ((value.flags & ts.TypeFlags.NumberLike) !== 0) return true
  return false
}

/**
The types an alias walk judges next. Mapped and inherited properties may
have no declaration for the visitor, so resolved apparent types, every
union/intersection constituent and interface base are followed, and an
ordinary wrapper's property types too: `Record<...>` from lib has no
syntax here. A schema is followed to its output only, never into `_zod`.
*/
function structure(checker: ts.TypeChecker, type: ts.Type): ts.Type[] {
  const output = schemaOutput(checker, type)
  if (output !== undefined) return output
  const parts: ts.Type[] = []
  const apparent = checker.getApparentType(type)
  if (apparent !== type) parts.push(apparent)
  if (type.isUnionOrIntersection()) parts.push(...type.types)
  if (type.isClassOrInterface()) parts.push(...checker.getBaseTypes(type))
  for (const [key, propertyType] of valueProperties(checker, type))
    if (key !== '_zod') parts.push(propertyType)
  return parts
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

/**
Judge an alias or interface and every type within `MAX_TYPE_DEPTH` edges
of it (`structure`), so a property need not be common to the whole union
and money beneath an ordinary name is still seen.
*/
function checkAlias(
  checker: ts.TypeChecker,
  node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
  file: string,
  flagged: Set<string>,
  numeric: Set<string>,
): void {
  const target = ts.isTypeAliasDeclaration(node)
    ? checker.getTypeFromTypeNode(node.type)
    : checker.getTypeAtLocation(node)
  const alias = node.name.text
  if (ts.isTypeAliasDeclaration(node) && MONEY_HINT.test(alias) && hasNumber(checker, target)) {
    numeric.add(`${file}:${alias}`)
    if (MONEY_KEY.test(alias)) flagged.add(`${file}:${alias}`)
  }
  const judged = reachable(target, (holder) => structure(checker, holder))
  for (const type of judged) {
    // A schema's own keys are not holdings; the walk goes on to its output.
    if (schemaOutput(checker, type) !== undefined) continue
    for (const [key, propertyType] of valueProperties(checker, type))
      if (MONEY_HINT.test(key) && hasNumber(checker, propertyType)) {
        numeric.add(`${file}:${key}`)
        if (MONEY_KEY.test(key)) flagged.add(`${file}:${key}`)
      }
  }
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
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
        checkAlias(checker, node, file, flagged, numeric)
      if (
        ts.isMappedTypeNode(node) &&
        node.type !== undefined &&
        node.typeParameter.constraint !== undefined &&
        hasNumber(checker, checker.getTypeFromTypeNode(node.type))
      ) {
        // Mapped keys have no property declaration, including beneath an
        // ordinary name or inside an array/Promise. A generic key may expose
        // no resolved properties yet: judge its possible literal keys.
        const seen = new Set<ts.Type>()
        const checkKey = (type: ts.Type): void => {
          if (seen.has(type)) return
          seen.add(type)
          if (type.isUnionOrIntersection()) {
            for (const member of type.types) checkKey(member)
          } else if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
            const constraint = checker.getBaseConstraintOfType(type)
            if (constraint !== undefined) checkKey(constraint)
          } else if (type.isStringLiteral() && MONEY_HINT.test(type.value)) {
            numeric.add(`${file}:${type.value}`)
            if (MONEY_KEY.test(type.value)) flagged.add(`${file}:${type.value}`)
          } else {
            // A remapped name (`as `${P}Usd``) is a template-literal type,
            // not a string literal: judge its resolved base constraint.
            const base = checker.getBaseConstraintOfType(type)
            if (base !== undefined && base !== type) checkKey(base)
          }
        }
        checkKey(checker.getTypeFromTypeNode(node.nameType ?? node.typeParameter.constraint))
      }
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
        if (hasNumber(checker, type)) {
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
In-memory fixtures for the regression probes: each fixture is a virtual
module beside the real tree (so `zod/mini` resolves from node_modules), and
only fixture files are judged.
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
