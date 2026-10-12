// C-M109-4 R3 (RVCM1094B P3): the scanner behind migrationKeyInventory.test.
// Finds every reader, writer and deleter of the three migrated key families
// (`museSpark.modelApiKey`, `museSpark.provider.<id>`,
// `museSpark.provider.<id>.account.<id>`) by scanning `src/`.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SRC = path.join(ROOT, 'src')

/**
 * Fragments that prove a statement touches one of the three key families:
 * the key itself, its builder, its record helpers, the store methods that
 * move it, or the account store's own write and delete entry points and
 * their callers. Writers and deleters that go through `AccountStore` or the
 * `AccountCredentialVault` port carry none of the key fragments, so the
 * entry-point method names (`setCredential`, `rebindOrigin`,
 * `useCredential`, `useCredential<`, `readForRemoval`), the store's own
 * `remove` definition (`remove(provider: string, account: string`), the
 * port reads (`credentials.read(binding)`, `vault.read(binding)`) and the
 * port calls (`write(binding`, `remove(binding`) and the route types
 * (`AccountCredentialVault`, `AccountSecrets`) are matched too. A removal
 * on an `AccountStore` is found by the declaration the call resolves to,
 * not by how the receiver is spelled: the checker keeps every call whose
 * target is `AccountStore.remove` or an override in a subclass at any
 * depth — a direct call, an element access, a destructured or bound
 * reference, or a structural port the store satisfies — so `store.remove(`
 * or `services.store.remove(` breaks the comparison while a different
 * store's `remove` (confirmations, vault ports) does not. Hook-index
 * annotations (`AccountSecretsDeps[`) are not key accesses. One list entry
 * per occurrence, so a new call breaks the comparison even in an
 * already-listed file.
 */
const FRAGMENTS = [
  'SECRET_KEYS.modelApiKey',
  'PROVIDER_SECRET_PREFIX',
  'museSpark.provider.${',
  '.account.${account}',
  'accountSecretKey(',
  'secretStorageAccountVault(',
  'providerSecretKey(',
  'providerSecretAccount(',
  'saveProviderCredential(',
  'readProviderCredential(',
  'deleteProviderCredential(',
  'getProviderCredential(',
  'setProviderCredential(',
  'clearProviderCredential(',
  'formatStoredProviderSecret(',
  'parseStoredProviderSecret(',
  '.getApiKey(',
  '.setApiKey(',
  '.clearApiKey(',
  'setCredential(',
  'rebindOrigin(',
  'useCredential(',
  'useCredential<',
  'readForRemoval(',
  'remove(provider: string, account: string',
  'credentials.read(binding)',
  'vault.read(binding)',
  'remove(binding',
  'write(binding',
  'AccountCredentialVault',
  'AccountSecrets',
] as const

/** `AccountSecrets` also matches its hook-deps annotations; only the indexed
 * hook form (`AccountSecretsDeps[`) is not a key access. */
const HOOK_INDEX = 'AccountSecretsDeps[' as const

/** A `.remove(` call whose resolved method belongs to `AccountStore`. */
const ACCOUNT_STORE_REMOVE = 'AccountStore.remove' as const

/** Secret-store calls on a bare `account` variable the runtime proved is a
 * provider slot via `providerSecretAccount` (matched on whitespace-collapsed
 * text, so a call split across lines still counts). */
const BARE_ACCOUNT_CALLS = ['store', 'delete', 'get'] as const

export function compareStrings(left: string, right: string): number {
  return left === right ? 0 : Number(left > right) * 2 - 1
}

function sourceFiles(): string[] {
  const found: string[] = []
  function walk(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !full.includes(`${path.sep}test${path.sep}`)
      ) {
        found.push(full)
      }
    }
  }
  walk(SRC)
  return found.toSorted(compareStrings)
}

/** The nearest enclosing class, if the node sits inside one. */
function nearestClass(node: ts.Node | undefined): ts.ClassDeclaration | undefined {
  let current = node
  while (current !== undefined && !ts.isClassDeclaration(current)) current = current.parent
  return current
}

/**
 * The class behind a symbol, following import aliases to the declaration.
 */
function classOfSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.ClassDeclaration | undefined {
  if (symbol === undefined) return undefined
  const target =
    (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  return target.declarations?.find((declaration): declaration is ts.ClassDeclaration =>
    ts.isClassDeclaration(declaration),
  )
}

/**
 * Whether a class declaration belongs to the `AccountStore` hierarchy: the
 * store itself or a subclass at any depth. The heritage chain is walked with
 * the checker, so a subclass of a subclass counts even when it redeclares
 * `remove`, and a same-named class elsewhere does not.
 */
function isInAccountStoreHierarchy(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration | undefined,
  seen: Set<ts.Node>,
): boolean {
  if (declaration?.name === undefined || seen.has(declaration)) return false
  seen.add(declaration)
  if (declaration.name.text === 'AccountStore') return true
  const heritage = declaration.heritageClauses ?? []
  for (const clause of heritage) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
    const parents = clause.types
    for (const entry of parents) {
      if (
        isInAccountStoreHierarchy(
          checker,
          classOfSymbol(checker, checker.getSymbolAtLocation(entry.expression)),
          seen,
        )
      )
        return true
    }
  }
  return false
}

/** Whether a resolved declaration is `AccountStore.remove` or an override in a subclass. */
function isHierarchyRemove(
  checker: ts.TypeChecker,
  declaration: ts.Declaration | undefined,
): boolean {
  return (
    declaration !== undefined &&
    ts.isMethodDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === 'remove' &&
    isInAccountStoreHierarchy(checker, nearestClass(declaration.parent), new Set())
  )
}

/** A symbol and its alias target's declarations, when there is a target. */
function removeDeclarations(checker: ts.TypeChecker, symbol: ts.Symbol): readonly ts.Declaration[] {
  const target =
    (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  return target.declarations ?? []
}

/**
 * Whether an expression denotes `AccountStore.remove` (or an override): a
 * direct or element access to the method, a destructured or otherwise bound
 * reference to it, or a bound copy of it. The check follows the resolved
 * declaration, never the receiver spelling.
 */
function isStoreRemoveReference(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen: readonly ts.Node[],
): boolean {
  if (seen.length > 8) return false
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    const name = accessName(expression)
    if (name !== 'remove') return false
    const symbol = accessedSymbol(checker, expression)
    return (
      symbol !== undefined &&
      removeDeclarations(checker, symbol).some((declaration) =>
        isHierarchyRemove(checker, declaration),
      )
    )
  }
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression)
    if (symbol === undefined) return false
    const declarations = removeDeclarations(checker, symbol)
    if (declarations.some((declaration) => isHierarchyRemove(checker, declaration))) return true
    // A local alias: follow one binding (a destructured method, a `const`
    // copy, a bound copy) back to the denoted method.
    const binding = declarations.find(
      (declaration): declaration is ts.VariableDeclaration | ts.BindingElement =>
        ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration),
    )
    if (binding === undefined || seen.includes(binding)) return false
    if (ts.isBindingElement(binding)) {
      const property = binding.propertyName ?? binding.name
      if (!ts.isIdentifier(property) || property.text !== 'remove') return false
      const owner = binding.parent.parent
      if (!ts.isVariableDeclaration(owner) || owner.initializer === undefined) return false
      const provided = checker.getTypeAtLocation(owner.initializer).getProperty('remove')
      return (
        provided !== undefined &&
        removeDeclarations(checker, provided).some((declaration) =>
          isHierarchyRemove(checker, declaration),
        )
      )
    }
    return (
      binding.initializer !== undefined &&
      isStoreRemoveReference(checker, binding.initializer, [...seen, binding])
    )
  }
  // A bound copy invoked later: `store.remove.bind(store)`.
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'bind' &&
    isStoreRemoveReference(checker, expression.expression.expression, [...seen, expression])
  )
}

/** The accessed member name of a property or element access, when it is static text. */
function accessName(
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  const argument = expression.argumentExpression
  return ts.isStringLiteralLike(argument) ? argument.text : null
}

/** The symbol a property or element access resolves to, with a type fallback for index forms. */
function accessedSymbol(
  checker: ts.TypeChecker,
  expression: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): ts.Symbol | undefined {
  if (ts.isPropertyAccessExpression(expression)) return checker.getSymbolAtLocation(expression.name)
  const argument = expression.argumentExpression
  if (!ts.isStringLiteralLike(argument)) return undefined
  const fromLiteral = checker.getSymbolAtLocation(argument)
  return fromLiteral ?? checker.getTypeAtLocation(expression.expression).getProperty(argument.text)
}

/** The instance type of the `AccountStore` class declared in the program, when found. */
function accountStoreInstanceType(
  checker: ts.TypeChecker,
  program: ts.Program,
): ts.Type | undefined {
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue
    let found: ts.Type | undefined
    const visit = (node: ts.Node): void => {
      if (
        found === undefined &&
        ts.isClassDeclaration(node) &&
        node.name?.text === 'AccountStore'
      ) {
        const symbol = checker.getSymbolAtLocation(node.name)
        if (symbol !== undefined) found = checker.getDeclaredTypeOfSymbol(symbol)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Whether a `.remove(` call resolves to a structural port the store
 * satisfies: the declaration is an interface or type member, and an
 * `AccountStore` is assignable to the receiver's type, so the checker
 * connects the port to the store's own `remove`.
 */
function isStoreSatisfiedPort(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
  receiver: ts.Expression,
  storeType: ts.Type | undefined,
): boolean {
  if (storeType === undefined) return false
  const declaration = checker.getResolvedSignature(node)?.declaration
  if (
    declaration === undefined ||
    (!ts.isMethodSignature(declaration) &&
      !ts.isPropertySignature(declaration) &&
      !ts.isMethodDeclaration(declaration))
  )
    return false
  try {
    return checker.isTypeAssignableTo(storeType, checker.getTypeAtLocation(receiver))
  } catch {
    return false
  }
}

/** Whether a call expression invokes `AccountStore.remove` in any of its forms. */
function isStoreRemoveCall(
  checker: ts.TypeChecker,
  node: ts.CallExpression,
  storeType: ts.Type | undefined,
): boolean {
  const callee = node.expression
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    const name = accessName(callee)
    if (name === 'remove')
      return (
        isStoreRemoveReference(checker, callee, []) ||
        isStoreSatisfiedPort(checker, node, callee.expression, storeType)
      )
    // Invoking a denoted reference: `drop.call(store, ...)`.
    return (
      (name === 'call' || name === 'apply') &&
      isStoreRemoveReference(checker, callee.expression, [])
    )
  }
  // A destructured or bound reference called on its own: `drop(...)`.
  if (ts.isIdentifier(callee)) return isStoreRemoveReference(checker, callee, [])
  // An immediately invoked bound copy: `store.remove.bind(store)(...)`.
  return ts.isCallExpression(callee) && isStoreRemoveReference(checker, callee, [])
}

/** Files that can invoke `AccountStore.remove` in any counted form. */
function canInvokeStoreRemove(content: string): boolean {
  return (
    content.includes('.remove') ||
    content.includes('["remove"]') ||
    content.includes("['remove']") ||
    /\bremove\s*\.\s*(call|apply|bind)\b/u.test(content) ||
    /\{\s*remove\b/u.test(content) ||
    /\bremove\s*\(/u.test(content)
  )
}

/**
 * Every call in the given roots that invokes `AccountStore.remove`,
 * labelled `file :: AccountStore.remove`, one entry per call. The removal
 * is found by the declaration the call resolves to — a direct call, an
 * element access, a destructured or bound reference, an override in a
 * subclass at any depth, or a structural port the checker resolves to the
 * store — never by how the receiver is spelled. Files that cannot hold such
 * a call skip the walk.
 */
export function collectAccountStoreRemovals(files: readonly string[]): string[] {
  const roots = files.filter((file) => canInvokeStoreRemove(readFileSync(file, 'utf8')))
  const program = ts.createProgram(roots, {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  })
  const checker = program.getTypeChecker()
  const storeType = accountStoreInstanceType(checker, program)
  const sites: string[] = []
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !roots.includes(source.fileName)) continue
    const relative = path.relative(ROOT, source.fileName).replaceAll(path.sep, '/')
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isStoreRemoveCall(checker, node, storeType))
        sites.push(`${relative} :: ${ACCOUNT_STORE_REMOVE}`)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return sites
}

/** Every `file :: fragment` occurrence of the three key families in `src/`. */
export function collectKeyFamilySites(): string[] {
  const sites: string[] = []
  const files = sourceFiles()
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll(path.sep, '/')
    // Import statements are not accesses, even when they span lines and name
    // a key builder on their own line.
    const code: string[] = []
    let isInImport = false
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      const isImportLine = /^import[\s('"]/u.test(trimmed)
      if (isInImport) {
        isInImport = !(trimmed.includes(' from ') || trimmed.endsWith(';'))
      } else if (isImportLine) {
        isInImport = !trimmed.includes(' from ') && (trimmed.includes('{') || trimmed.endsWith(','))
      } else if (
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('/*')
      ) {
        code.push(line)
      }
    }
    const kept = code.join('\n')
    for (const fragment of FRAGMENTS) {
      let occurrences = kept.split(fragment).length - 1
      if (fragment === 'AccountSecrets') occurrences -= kept.split(HOOK_INDEX).length - 1
      for (let at = 0; at < occurrences; at += 1) sites.push(`${relative} :: ${fragment}`)
    }
    const collapsed = kept.replaceAll(/\s+/gu, '')
    for (const call of BARE_ACCOUNT_CALLS) {
      const matches = collapsed.match(new RegExp(String.raw`secrets\.${call}\(account[,)]`, 'gu'))
      for (let at = 0; at < (matches?.length ?? 0); at += 1)
        sites.push(`${relative} :: secrets.${call}(account)`)
    }
  }
  for (const site of collectAccountStoreRemovals(files)) sites.push(site)
  return sites.toSorted(compareStrings)
}
