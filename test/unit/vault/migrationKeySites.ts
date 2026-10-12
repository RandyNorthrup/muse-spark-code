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
 * on an `AccountStore` is found by type, not by how the receiver is
 * spelled: the checker resolves every `.remove(` call and keeps the ones
 * whose method belongs to `AccountStore` or a subclass, so `store.remove(`
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

/** Whether a resolved method declaration is `AccountStore.remove` or a subclass override. */
function isAccountStoreRemove(declaration: ts.Declaration | undefined): boolean {
  if (declaration === undefined || !ts.isMethodDeclaration(declaration)) return false
  const owner = nearestClass(declaration.parent)
  return (
    owner?.name !== undefined &&
    (owner.name.text === 'AccountStore' ||
      (owner.heritageClauses ?? []).some(
        (clause) =>
          clause.token === ts.SyntaxKind.ExtendsKeyword &&
          clause.types.some((entry) => entry.expression.getText() === 'AccountStore'),
      ))
  )
}

/**
 * Every `.remove(` call in `src/` whose resolved method belongs to
 * `AccountStore`, found by the checker rather than by receiver spelling.
 * Files without the text cannot hold such a call and skip the walk.
 */
function collectAccountStoreRemovals(files: readonly string[]): string[] {
  const roots = files.filter((file) => readFileSync(file, 'utf8').includes('.remove'))
  const program = ts.createProgram(roots, {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: ['node'],
  })
  const checker = program.getTypeChecker()
  const sites: string[] = []
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !source.fileName.startsWith(`${SRC}${path.sep}`)) continue
    const relative = path.relative(ROOT, source.fileName).replaceAll(path.sep, '/')
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'remove'
      ) {
        const signature = checker.getResolvedSignature(node)
        if (isAccountStoreRemove(signature?.declaration))
          sites.push(`${relative} :: ${ACCOUNT_STORE_REMOVE}`)
      }
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
