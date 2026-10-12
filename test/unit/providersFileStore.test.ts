import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountStoreError } from '../../src/core/providers/accountCredentialRecord'
import {
  fileAccountsMetadata,
  runtimeProvidersFile,
} from '../../src/runtime/providers/providersFileStore'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function dir(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'm108-providers-'))
  dirs.push(folder)
  return folder
}

const ENTRY = {
  id: 'meta',
  policyProvider: 'meta',
  product: 'model-api',
  auth: 'apiKey',
  origin: 'https://api.meta.ai',
} as const

function seed(folder: string, envelope: unknown): string {
  const file = runtimeProvidersFile(folder)
  writeFileSync(file, typeof envelope === 'string' ? envelope : JSON.stringify(envelope))
  return file
}

async function expectWriteRejected(
  metadata: ReturnType<typeof fileAccountsMetadata>,
): Promise<void> {
  const rows = [{ id: 'default', label: 'D', order: 0, thresholds: {} }] as const
  // writeAccounts throws synchronously; the async boundary turns it into a
  // rejection for the assertion.
  await expect(
    (async () => {
      await metadata.writeAccounts('meta', [...rows])
    })(),
  ).rejects.toBeInstanceOf(AccountStoreError)
}

const DEFAULT_ROW = { id: 'default', label: 'Default', order: 0, thresholds: {} } as const

/** Store the migrated default row for meta in this folder's file. */
async function writeDefaultAccount(
  folder: string,
): Promise<ReturnType<typeof fileAccountsMetadata>> {
  const metadata = fileAccountsMetadata(folder)
  await metadata.writeAccounts('meta', [{ ...DEFAULT_ROW }])
  return metadata
}

describe('fileAccountsMetadata', () => {
  it('serves the built-in meta entry when the file is absent', async () => {
    const metadata = fileAccountsMetadata(dir())
    await expect(metadata.read('meta')).resolves.toMatchObject({
      id: 'meta',
      policyProvider: 'meta',
      product: 'model-api',
      auth: 'apiKey',
      origin: 'https://api.meta.ai',
    })
    // Any other provider still needs its stored row.
    await expect(metadata.read('openai')).resolves.toBeUndefined()
  })

  it('round-trips accounts and preserves the rest of the envelope', async () => {
    const folder = dir()
    seed(folder, { version: 2, providers: { meta: { ...ENTRY } } })
    const metadata = await writeDefaultAccount(folder)
    await expect(metadata.read('meta')).resolves.toMatchObject({
      id: 'meta',
      accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
    })
    const raw: unknown = JSON.parse(readFileSync(runtimeProvidersFile(folder), 'utf8'))
    expect(raw).toMatchObject({ version: 2 })
  })

  it('persists the built-in meta row on the first write', async () => {
    const folder = dir()
    seed(folder, { providers: {} })
    const metadata = await writeDefaultAccount(folder)
    await expect(metadata.read('meta')).resolves.toMatchObject({
      id: 'meta',
      accounts: [{ id: 'default' }],
    })
  })

  it('refuses an unknown provider instead of creating one', async () => {
    const folder = dir()
    seed(folder, { providers: {} })
    const metadata = fileAccountsMetadata(folder)
    const rows = [{ id: 'default', label: 'D', order: 0, thresholds: {} }] as const
    await expect(
      (async () => {
        await metadata.writeAccounts('openai', [...rows])
      })(),
    ).rejects.toBeInstanceOf(AccountStoreError)
    await expect(metadata.read('openai')).resolves.toBeUndefined()
  })

  it('throws on a corrupt file instead of clobbering it', async () => {
    const folder = dir()
    const before = seed(folder, '{oops')
    const metadata = fileAccountsMetadata(folder)
    await expect(
      (async () => {
        await metadata.read('meta')
      })(),
    ).rejects.toBeInstanceOf(AccountStoreError)
    await expectWriteRejected(metadata)
    expect(readFileSync(before, 'utf8')).toBe('{oops')
  })

  it.each([null, {}, { ...ENTRY, auth: 'not-a-method' }])(
    'refuses malformed configured provider metadata: %j',
    async (entry) => {
      const folder = dir()
      seed(folder, { providers: { meta: entry } })
      await expect(
        (async () => await fileAccountsMetadata(folder).read('meta'))(),
      ).rejects.toBeInstanceOf(AccountStoreError)
    },
  )

  it('reads nothing for an invalid provider id', async () => {
    const metadata = fileAccountsMetadata(dir())
    await expect(metadata.read('META!')).resolves.toBeUndefined()
  })

  it.each([
    ['not JSON', '{oops'],
    ['a JSON array envelope', '[1, 2]'],
    ['a null providers field', { providers: null }],
    ['a providers array field', { providers: [] }],
    ['a malformed provider row', { providers: { meta: { ...ENTRY, auth: 'not-a-method' } } }],
    [
      'duplicate account ids',
      {
        providers: {
          meta: { ...ENTRY, accounts: [DEFAULT_ROW, { ...DEFAULT_ROW, label: 'Copy', order: 1 }] },
        },
      },
    ],
    [
      'a provider id that does not match its key',
      { providers: { meta: { ...ENTRY, id: 'other' } } },
    ],
  ])('reports refused file content with its own code: %s', async (_label, envelope) => {
    const folder = dir()
    const file = seed(folder, envelope)
    const before = readFileSync(file, 'utf8')
    const metadata = fileAccountsMetadata(folder)
    // The message carries the code, so this asserts the refusal code rather
    // than the generic unavailable one a missing connection would use.
    await expect((async () => await metadata.read('meta'))()).rejects.toThrow(
      'invalidProvidersFile',
    )
    await expectWriteRejected(metadata)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('reads unconfigured once the user has a file without a meta row', async () => {
    const folder = dir()
    seed(folder, { providers: {} })
    const metadata = fileAccountsMetadata(folder)
    await expect(metadata.read('meta')).resolves.toBeUndefined()
  })

  it('refuses to overwrite a malformed user row and leaves the file untouched', async () => {
    const folder = dir()
    const file = seed(folder, { providers: { meta: { ...ENTRY, auth: 'not-a-method' } } })
    const before = readFileSync(file, 'utf8')
    const metadata = fileAccountsMetadata(folder)
    await expect((async () => await metadata.read('meta'))()).rejects.toBeInstanceOf(
      AccountStoreError,
    )
    await expectWriteRejected(metadata)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('refuses a first write that races a malformed user row', async () => {
    const folder = dir()
    const metadata = fileAccountsMetadata(folder)
    // The addition read an absent row; another process supplies a malformed
    // user row before the write reload.
    await expect(metadata.read('meta')).resolves.toMatchObject({ id: 'meta' })
    const file = seed(folder, { providers: { meta: { ...ENTRY, origin: 42 } } })
    const before = readFileSync(file, 'utf8')
    await expectWriteRejected(metadata)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
