// C-M109-4 R3 (RVCM1094B P3): every reader, writer and deleter of the three
// migrated key families (`museSpark.modelApiKey`, `museSpark.provider.<id>`,
// `museSpark.provider.<id>.account.<id>`) in the host and in the runtime
// (CLI and ACP), checked in so a new writer of these keys cannot appear
// without the vault join knowing. Style follows test/unit/m95Strings.test.ts:
// a checked-in list compared against what the sources really contain. After
// a slot is `active`, a write or delete must go through the vault, and the
// legacy copy must not be written on its own; each entry's row in
// docs/certification/m109-m-migration-and-import.md says what the join owes
// there. Occurrence counts are exact: a second call of an already-listed
// helper in an already-listed file still breaks this test.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectAccountStoreRemovals,
  collectKeyFamilySites,
  compareStrings,
} from './migrationKeySites'

// The checked-in call sites, `file :: fragment`, one entry per occurrence
// (158 on 2026-10-11; R5 finds an `AccountStore` removal by resolved type
// instead of receiver spelling, holds the store's own `remove` definition,
// the generic `useCredential<` entry and the two vault-port reads, and
// drops the three hook-index annotations; recount per family in the
// certification). A new reader, writer or deleter of these keys changes
// this list, and the vault join's owed rows with it.
const EXPECTED_SITES: readonly string[] = [
  'src/core/providers/accountCredentialRecord.ts :: .account.${account}',
  'src/core/providers/accountCredentialRecord.ts :: AccountCredentialVault',
  'src/core/providers/accountCredentialRecord.ts :: SECRET_KEYS.modelApiKey',
  'src/core/providers/accountCredentialRecord.ts :: accountSecretKey(',
  'src/core/providers/accountCredentialRecord.ts :: museSpark.provider.${',
  'src/core/providers/accountCredentialRecord.ts :: readForRemoval(',
  'src/core/providers/accountCredentialRecord.ts :: remove(binding',
  'src/core/providers/accountCredentialRecord.ts :: write(binding',
  'src/core/providers/accounts.ts :: AccountCredentialVault',
  'src/core/providers/accounts.ts :: accountSecretKey(',
  'src/core/providers/accounts.ts :: accountSecretKey(',
  'src/core/providers/accounts.ts :: accountSecretKey(',
  'src/core/providers/accounts.ts :: accountSecretKey(',
  'src/core/providers/accounts.ts :: credentials.read(binding)',
  'src/core/providers/accounts.ts :: readForRemoval(',
  'src/core/providers/accounts.ts :: remove(provider: string, account: string',
  'src/core/providers/accounts.ts :: rebindOrigin(',
  'src/core/providers/accounts.ts :: remove(binding',
  'src/core/providers/accounts.ts :: setCredential(',
  'src/core/providers/accounts.ts :: useCredential(',
  'src/core/providers/accounts.ts :: useCredential(',
  'src/core/providers/accounts.ts :: useCredential<',
  'src/core/providers/accounts.ts :: write(binding',
  'src/core/providers/accounts.ts :: write(binding',
  'src/core/providers/configured.ts :: PROVIDER_SECRET_PREFIX',
  'src/core/providers/configured.ts :: PROVIDER_SECRET_PREFIX',
  'src/core/vault/migrate/accountSecrets.ts :: accountSecretKey(',
  'src/core/vault/migrate/modelApi.ts :: SECRET_KEYS.modelApiKey',
  'src/core/vault/migrate/modelApi.ts :: SECRET_KEYS.modelApiKey',
  'src/core/vault/migrate/providerCredentials.ts :: PROVIDER_SECRET_PREFIX',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: .getApiKey(',
  'src/extension.ts :: PROVIDER_SECRET_PREFIX',
  'src/extension.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/auth/authService.ts :: .clearApiKey(',
  'src/host/auth/authService.ts :: .getApiKey(',
  'src/host/auth/authService.ts :: .setApiKey(',
  'src/host/auth/credentialStore.ts :: .getApiKey(',
  'src/host/auth/credentialStore.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/auth/credentialStore.ts :: SECRET_KEYS.modelApiKey',
  'src/host/auth/credentialStore.ts :: SECRET_KEYS.modelApiKey',
  'src/host/auth/credentialStore.ts :: SECRET_KEYS.modelApiKey',
  'src/host/auth/metaAccountKey.ts :: setCredential(',
  'src/host/backend/modelApiBackendManager.ts :: .getApiKey(',
  'src/host/backend/modelApiBackendManager.ts :: .getApiKey(',
  'src/host/models/accountsHandler.ts :: AccountStore.remove',
  'src/host/models/accountsHandler.ts :: AccountStore.remove',
  'src/host/prompts/promptEntry.ts :: .getApiKey(',
  'src/host/providers/accountSecrets.ts :: AccountCredentialVault',
  'src/host/providers/accountSecrets.ts :: AccountCredentialVault',
  'src/host/providers/accountSecrets.ts :: AccountCredentialVault',
  'src/host/providers/accountSecrets.ts :: AccountSecrets',
  'src/host/providers/accountSecrets.ts :: AccountSecrets',
  'src/host/providers/accountSecrets.ts :: AccountSecrets',
  'src/host/providers/accountSecrets.ts :: accountSecretKey(',
  'src/host/providers/accountSecrets.ts :: accountSecretKey(',
  'src/host/providers/accountSecrets.ts :: accountSecretKey(',
  'src/host/providers/accountSecrets.ts :: readForRemoval(',
  'src/host/providers/accountSecrets.ts :: readForRemoval(',
  'src/host/providers/accountSecrets.ts :: readForRemoval(',
  'src/host/providers/accountSecrets.ts :: vault.read(binding)',
  'src/host/providers/accountSecrets.ts :: remove(binding',
  'src/host/providers/accountSecrets.ts :: remove(binding',
  'src/host/providers/accountSecrets.ts :: remove(binding',
  'src/host/providers/accountSecrets.ts :: secretStorageAccountVault(',
  'src/host/providers/accountSecrets.ts :: write(binding',
  'src/host/providers/accountSecrets.ts :: write(binding',
  'src/host/providers/accountSecrets.ts :: write(binding',
  'src/host/providers/chatgptSignIn.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/credentialRecords.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/credentialRecords.ts :: clearProviderCredential(',
  'src/host/providers/credentialRecords.ts :: deleteProviderCredential(',
  'src/host/providers/credentialRecords.ts :: deleteProviderCredential(',
  'src/host/providers/credentialRecords.ts :: getProviderCredential(',
  'src/host/providers/credentialRecords.ts :: providerSecretKey(',
  'src/host/providers/credentialRecords.ts :: providerSecretKey(',
  'src/host/providers/credentialRecords.ts :: providerSecretKey(',
  'src/host/providers/credentialRecords.ts :: providerSecretKey(',
  'src/host/providers/credentialRecords.ts :: readProviderCredential(',
  'src/host/providers/credentialRecords.ts :: readProviderCredential(',
  'src/host/providers/credentialRecords.ts :: saveProviderCredential(',
  'src/host/providers/credentialRecords.ts :: saveProviderCredential(',
  'src/host/providers/credentialRecords.ts :: setProviderCredential(',
  'src/host/providers/importExport.ts :: clearProviderCredential(',
  'src/host/providers/providerRemoval.ts :: deleteProviderCredential(',
  'src/host/providers/providersHost.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/providersHost.ts :: getProviderCredential(',
  'src/host/providers/providersHost.ts :: getProviderCredential(',
  'src/host/providers/subscriptionFeatures.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/subscriptionFeatures.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/subscriptionFeatures.ts :: PROVIDER_SECRET_PREFIX',
  'src/host/providers/subscriptionFeatures.ts :: SECRET_KEYS.modelApiKey',
  'src/host/providers/subscriptionFeatures.ts :: SECRET_KEYS.modelApiKey',
  'src/host/providers/wizardSave.ts :: clearProviderCredential(',
  'src/host/providers/wizardSave.ts :: getProviderCredential(',
  'src/host/providers/wizardSave.ts :: setProviderCredential(',
  'src/host/providers/wizardSave.ts :: setProviderCredential(',
  'src/runtime/authCommands.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/authCommands.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/authCommands.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/authCommands.ts :: formatStoredProviderSecret(',
  'src/runtime/authCommands.ts :: parseStoredProviderSecret(',
  'src/runtime/authCommands.ts :: providerSecretAccount(',
  'src/runtime/authCommands.ts :: secrets.delete(account)',
  'src/runtime/authCommands.ts :: secrets.get(account)',
  'src/runtime/authCommands.ts :: secrets.store(account)',
  'src/runtime/backends.ts :: .getApiKey(',
  'src/runtime/backends.ts :: PROVIDER_SECRET_PREFIX',
  'src/runtime/backends.ts :: PROVIDER_SECRET_PREFIX',
  'src/runtime/backends.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/backends.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/chatGptHost.ts :: PROVIDER_SECRET_PREFIX',
  'src/runtime/chatGptProviderCommands.ts :: PROVIDER_SECRET_PREFIX',
  'src/runtime/chatGptProviderCommands.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/chatGptProviderCommands.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/exec/keyInput.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/exec/providerExec.ts :: formatStoredProviderSecret(',
  'src/runtime/exec/providerExec.ts :: formatStoredProviderSecret(',
  'src/runtime/exec/providerExec.ts :: parseStoredProviderSecret(',
  'src/runtime/exec/providerExec.ts :: providerSecretAccount(',
  'src/runtime/exec/providerExec.ts :: providerSecretAccount(',
  'src/runtime/exec/providerExec.ts :: secrets.get(account)',
  'src/runtime/exec/runExec.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/keyStore.ts :: formatStoredProviderSecret(',
  'src/runtime/keyStore.ts :: museSpark.provider.${',
  'src/runtime/keyStore.ts :: parseStoredProviderSecret(',
  'src/runtime/keyStore.ts :: providerSecretAccount(',
  'src/runtime/main.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/main.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/providers/accountStore.ts :: AccountCredentialVault',
  'src/runtime/providers/accountStore.ts :: AccountSecrets',
  'src/runtime/providers/accountStore.ts :: secretStorageAccountVault(',
  'src/runtime/providers/accountsCommand.ts :: AccountStore.remove',
  'src/runtime/providers/accountsCommand.ts :: setCredential(',
  'src/runtime/providers/runtimeServices.ts :: AccountSecrets',
  'src/runtime/providers/runtimeServices.ts :: AccountSecrets',
  'src/runtime/providers/runtimeServices.ts :: AccountStore.remove',
  'src/runtime/providers/runtimeServices.ts :: SECRET_KEYS.modelApiKey',
  'src/runtime/providers/runtimeServices.ts :: secretStorageAccountVault(',
  'src/runtime/providers/runtimeServices.ts :: setCredential(',
  'src/runtime/providers/runtimeServices.ts :: setCredential(',
  'src/runtime/providers/runtimeServices.ts :: useCredential(',
  'src/runtime/providersCommands.ts :: formatStoredProviderSecret(',
  'src/runtime/providersCommands.ts :: parseStoredProviderSecret(',
  'src/runtime/providersCommands.ts :: providerSecretAccount(',
  'src/runtime/providersCommands.ts :: providerSecretAccount(',
  'src/runtime/providersCommands.ts :: secrets.delete(account)',
  'src/runtime/providersCommands.ts :: secrets.delete(account)',
  'src/runtime/providersCommands.ts :: secrets.get(account)',
  'src/runtime/providersCommands.ts :: secrets.get(account)',
  'src/runtime/providersCommands.ts :: secrets.store(account)',
  'src/runtime/providersCommands.ts :: secrets.store(account)',
  'src/shared/constants.ts :: PROVIDER_SECRET_PREFIX',
]

describe('C-M109-4 R3 migrated key inventory', () => {
  // Named timeout: resolving every `.remove(` receiver's type over the whole
  // tree takes ~15 s on a loaded rig.
  it(
    'lists every reader, writer and deleter of the three key families',
    { timeout: 120_000 },
    () => {
      const actual = collectKeyFamilySites()
      expect(actual).toEqual([...EXPECTED_SITES].toSorted(compareStrings))
    },
  )
  // Named timeout: a fresh type-resolved program over the form fixtures
  // takes seconds on a loaded rig.
  it(
    'finds an AccountStore removal by its declaration in every call form',
    { timeout: 120_000 },
    () => {
      // RVCM1094E finding 2: the reviewer's nine call forms, each in its own
      // generated file against the real `AccountStore`. The inventory finds
      // a removal by the declaration it resolves to, so every form below —
      // including the five the spelling-based scan missed — is counted.
      const head = `import { AccountStore } from '../../src/core/providers/accounts'\n`
      const bodies = [
        `export function direct(store: AccountStore): Promise<void> {\n  return store.remove('provider', 'account')\n}\n`,
        `export function nested(services: { store: AccountStore }): Promise<void> {\n  return services.store.remove('provider', 'account')\n}\n`,
        `class Direct extends AccountStore {\n  public override async remove(_provider: string, _account: string): Promise<void> {\n    return Promise.resolve()\n  }\n}\nexport function owned(store: Direct): Promise<void> {\n  return store.remove('provider', 'account')\n}\n`,
        `export function aliased(store: AccountStore): Promise<void> {\n  const same = store\n  return same.remove('provider', 'account')\n}\n`,
        `export function destructured(store: AccountStore): Promise<void> {\n  const { remove } = store\n  return remove.call(store, 'provider', 'account')\n}\n`,
        `export function bound(store: AccountStore): Promise<void> {\n  const drop = store.remove.bind(store)\n  return drop('provider', 'account')\n}\n`,
        `export function indexed(store: AccountStore): Promise<void> {\n  return store['remove']('provider', 'account')\n}\n`,
        `class Middle extends AccountStore {}\nclass Leaf extends Middle {\n  public override async remove(_provider: string, _account: string): Promise<void> {\n    return Promise.resolve()\n  }\n}\nexport function deep(store: Leaf): Promise<void> {\n  return store.remove('provider', 'account')\n}\n`,
        `interface Remover {\n  remove(provider: string, account: string): Promise<void>\n}\nexport function throughPort(remover: Remover): Promise<void> {\n  return remover.remove('provider', 'account')\n}\n`,
      ]
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
      const directory = mkdtempSync(path.join(root, 'temp', 'removeForms-'))
      try {
        const files = bodies.map((body, index) => {
          const file = path.join(directory, `form${String(index + 1)}.ts`)
          writeFileSync(file, `${head}${body}`)
          return file
        })
        const actual = collectAccountStoreRemovals(files).toSorted(compareStrings)
        expect(actual).toHaveLength(bodies.length)
        for (const index of bodies.keys()) {
          expect(actual[index]).toBe(
            `${path
              .relative(root, files[index]!)
              .replaceAll(path.sep, '/')} :: AccountStore.remove`,
          )
        }
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )
  it('hand-off symbol anchors resolve at the head and carry no line numbers', () => {
    // RVCM1094E finding 3: the hand-off rows, the wiring list and the join
    // test's comment name symbols, never line numbers. Every `file › symbol`
    // pair must resolve against the head, so a rename or move breaks this
    // test instead of silently staling the hand-off.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const doc = readFileSync(
      path.join(root, 'docs/certification/m109-m-migration-and-import.md'),
      'utf8',
    )
    const start = doc.indexOf('<!-- hand-off anchors start')
    const end = doc.indexOf('<!-- hand-off anchors end -->')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const handOff = doc.slice(start, end)
    expect(handOff).not.toMatch(/`[^`\n]*\.ts:[0-9]/u)
    expect(handOff).not.toMatch(/`:[0-9]/u)
    expect(unresolvedAnchors(root, handOff)).toEqual([])
    expect(countAnchors(handOff)).toBeGreaterThan(40)
    const joinTest = readFileSync(
      path.join(root, 'test/unit/vault/migrationCodecs.test.ts'),
      'utf8',
    )
    expect(joinTest).not.toMatch(/`[^`\n]*\.ts:[0-9]/u)
    expect(joinTest).not.toMatch(/`:[0-9]/u)
    expect(unresolvedAnchors(root, joinTest)).toEqual([])
    expect(countAnchors(joinTest)).toBeGreaterThan(5)
  })
})

const ANCHOR_PATTERN = /`((?:src|test)\/[^`\n]*?\.ts)`((?:(?:\s|\/\/)+›(?:\s|\/\/)+`[^`\n]+?`)+)/gu

/** Every `file › symbol` match in `text`. */
function anchorMatches(text: string): RegExpMatchArray[] {
  const found: RegExpMatchArray[] = []
  const matches = text.matchAll(ANCHOR_PATTERN)
  let step = matches.next()
  while (step.done !== true) {
    found.push(step.value)
    step = matches.next()
  }
  return found
}

/** `file › symbol` pairs in `text` whose symbol the file does not contain. */
function unresolvedAnchors(root: string, text: string): string[] {
  const failures: string[] = []
  for (const match of anchorMatches(text)) {
    const file = match[1]!
    const chain = match[2]!
    const content = readFileSync(path.join(root, file), 'utf8')
    for (const part of chain.split('›')) {
      const symbol = part.replaceAll(/[`/]/gu, '').trim()
      if (!content.includes(symbol)) failures.push(`${file} › ${symbol}`)
    }
  }
  return failures
}

/** How many `file › symbol` pairs `text` carries. */
function countAnchors(text: string): number {
  return anchorMatches(text).length
}
