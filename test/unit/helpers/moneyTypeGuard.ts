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

/** A callable's members (`length`, `bind`) are not money. */
function isCallable(checker: ts.TypeChecker, type: ts.Type): boolean {
  return (
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
    checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
  )
}

/** Does this type hold a JavaScript number anywhere a value can sit? */
function hasNumber(checker: ts.TypeChecker, type: ts.Type, seen: Set<ts.Type>): boolean {
  if (seen.has(type)) return false
  seen.add(type)
  if ((type.flags & ts.TypeFlags.NumberLike) !== 0) return true
  if (type.isUnionOrIntersection())
    return type.types.some((member) => hasNumber(checker, member, seen))
  if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) {
    // The apparent primitive is boxed: Number hides its numeric holding and
    // String adds an unrelated numeric length. Judge the actual constraint.
    const holding = checker.getBaseConstraintOfType(type) ?? checker.getApparentType(type)
    return holding !== type && hasNumber(checker, holding, seen)
  }
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
  if (checker.getIndexInfosOfType(type).some((info) => hasNumber(checker, info.type, seen)))
    return true
  // Finite-key records and mapped types expose money as named properties,
  // not index signatures: judge each property's type (P3-3). Encapsulated
  // `#private` state is not a declared money holding: skipping it keeps exact
  // `Usd` instances (whose only number is the private places count) unflagged.
  if ((type.flags & ts.TypeFlags.Object) !== 0) {
    for (const property of type.getProperties()) {
      if (property.getName().startsWith('#')) continue
      const propertyType = checker.getTypeOfSymbol(property)
      if (!isCallable(checker, propertyType) && hasNumber(checker, propertyType, seen)) return true
    }
  }
  return false
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
 * The generic declaration an instantiated type comes from (RVM121F): a type
 * alias reference carries its `aliasSymbol`, an interface or class reference
 * its object-type `target`, and an anonymous object type its own symbol. Two
 * instantiations of one declaration share this key even though every
 * instantiation is a new `ts.Type`. A target shared by the whole program is
 * no declaration: the checker's homomorphic identity
 * (`{ [K in keyof T]: T[K] }`) anchors every apparent generic
 * instantiation, and those wrappers forward `getSymbol` to its one shared
 * `__type` symbol — keying by either once hid
 * `schedule.ts:accountUsdPerHour`. So only a non-generic anonymous object,
 * which carries no target at all, keys by its own symbol. Mapped generics
 * the user declares still key by their alias symbol above; interfaces and
 * classes key by their named target.
 */
function declarationOf(type: ts.Type): object | undefined {
  if (type.aliasSymbol !== undefined) return type.aliasSymbol
  const target =
    (type.flags & ts.TypeFlags.Object) === 0 ? undefined : (type as ts.TypeReference).target
  if (target === undefined) return type.getSymbol()
  return target.getSymbol()?.getName() === '__type' ? undefined : target
}

/**
 * Mapped and inherited properties may have no declaration for the visitor.
 * Judge resolved apparent types, every union/intersection constituent and
 * interface base, so a property need not be common to the whole union.
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
  if (
    ts.isTypeAliasDeclaration(node) &&
    MONEY_HINT.test(alias) &&
    hasNumber(checker, target, new Set())
  ) {
    numeric.add(`${file}:${alias}`)
    if (MONEY_KEY.test(alias)) flagged.add(`${file}:${alias}`)
  }
  const seen = new Set<ts.Type>()
  // Every instantiation of a generic declaration is a new `ts.Type`
  // (`Chain<T>` unfolds to `Chain<T[]>`, `Chain<T[][]>`, ...), so the
  // per-instance set above never repeats on a recursive generic and the
  // walk overflows the stack. The declarations on the current descent path
  // are tracked too: a second instantiation of a declaration already being
  // walked is not expanded again. The money check on the first
  // instantiation still runs, because it happens in the property loop
  // before the descent below. Everything else keeps the per-instance set.
  const activeDecls = new Set<object>()
  const visit = (type: ts.Type): void => {
    if (seen.has(type)) return
    seen.add(type)
    const decl = declarationOf(type)
    if (decl !== undefined) {
      if (activeDecls.has(decl)) return
      activeDecls.add(decl)
    }
    try {
      // A schema is judged by its declared output, never its input side:
      // `~standard.types.input` accepts versioned-reader numbers the boundary
      // converts exactly, which no holding ever is.
      const zod = type.getProperty('_zod')
      if (zod !== undefined) {
        const output = checker.getTypeOfSymbol(zod).getProperty('output')
        if (output !== undefined) visit(checker.getTypeOfSymbol(output))
        return
      }
      const apparent = checker.getApparentType(type)
      if (apparent !== type) visit(apparent)
      if (type.isUnionOrIntersection()) for (const member of type.types) visit(member)
      if (type.isClassOrInterface()) for (const base of checker.getBaseTypes(type)) visit(base)
      for (const property of type.getProperties()) {
        const key = property.getName()
        if (key.startsWith('#')) continue
        const propertyType = checker.getTypeOfSymbol(property)
        if (isCallable(checker, propertyType)) continue
        if (MONEY_HINT.test(key) && hasNumber(checker, propertyType, new Set())) {
          numeric.add(`${file}:${key}`)
          if (MONEY_KEY.test(key)) flagged.add(`${file}:${key}`)
        }
        // An ordinary wrapper hides lib-declared mapped money (`Record<...>`
        // has no syntax here): judge the property type's own properties too.
        // The visited set keeps recursive types terminating. A schema's
        // internals are never descended into: it is judged by its declared
        // output, and `_zod.input` accepts versioned-reader numbers the
        // boundary converts exactly, which no holding ever is.
        if (key === '_zod') continue
        visit(propertyType)
      }
    } finally {
      if (decl !== undefined) activeDecls.delete(decl)
    }
  }
  visit(target)
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
        hasNumber(checker, checker.getTypeFromTypeNode(node.type), new Set())
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
