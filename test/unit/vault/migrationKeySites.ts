// C-M109-4 R3 (RVCM1094B P3): the scanner behind migrationKeyInventory.test.
// Finds every reader, writer and deleter of the three migrated key families
// (`museSpark.modelApiKey`, `museSpark.provider.<id>`,
// `museSpark.provider.<id>.account.<id>`) by scanning `src/`.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SRC = path.join(ROOT, 'src')

/**
 * Fragments that prove a statement touches one of the three key families:
 * the key itself, its builder, its record helpers, the store methods that
 * move it, or the account store's own write and delete entry points and
 * their callers. Writers and deleters that go through `AccountStore` or the
 * `AccountCredentialVault` port carry none of the key fragments, so the
 * entry-point method names (`setCredential`, `rebindOrigin`,
 * `useCredential`, `readForRemoval`), the store delete callers
 * (`accounts.remove(`), the port calls (`write(binding`, `remove(binding`)
 * and the route types (`AccountCredentialVault`, `AccountSecrets`) are
 * matched too. One list entry per occurrence, so a
 * new call breaks the comparison even in an already-listed file.
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
  'readForRemoval(',
  'accounts.remove(',
  'remove(binding',
  'write(binding',
  'AccountCredentialVault',
  'AccountSecrets',
] as const

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

/** Every `file :: fragment` occurrence of the three key families in `src/`. */
export function collectKeyFamilySites(): string[] {
  const sites: string[] = []
  for (const file of sourceFiles()) {
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
      const occurrences = kept.split(fragment).length - 1
      for (let at = 0; at < occurrences; at += 1) sites.push(`${relative} :: ${fragment}`)
    }
    const collapsed = kept.replaceAll(/\s+/gu, '')
    for (const call of BARE_ACCOUNT_CALLS) {
      const matches = collapsed.match(new RegExp(String.raw`secrets\.${call}\(account[,)]`, 'gu'))
      for (let at = 0; at < (matches?.length ?? 0); at += 1)
        sites.push(`${relative} :: secrets.${call}(account)`)
    }
  }
  return sites.toSorted(compareStrings)
}
