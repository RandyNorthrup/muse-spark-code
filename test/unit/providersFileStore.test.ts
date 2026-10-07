import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountStoreError } from '../../src/core/providers/credentialRecord'
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

describe('fileAccountsMetadata', () => {
  it('reads nothing when the file is absent', async () => {
    const metadata = fileAccountsMetadata(dir())
    await expect(metadata.read('meta')).resolves.toBeUndefined()
  })

  it('round-trips accounts and preserves the rest of the envelope', async () => {
    const folder = dir()
    seed(folder, { version: 2, providers: { meta: { ...ENTRY } } })
    const metadata = fileAccountsMetadata(folder)
    await metadata.writeAccounts('meta', [
      { id: 'default', label: 'Default', order: 0, thresholds: {} },
    ])
    await expect(metadata.read('meta')).resolves.toMatchObject({
      id: 'meta',
      accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
    })
    const raw: unknown = JSON.parse(readFileSync(runtimeProvidersFile(folder), 'utf8'))
    expect(raw).toMatchObject({ version: 2 })
  })

  it('refuses an unknown provider instead of creating one', async () => {
    const folder = dir()
    seed(folder, { providers: {} })
    await expectWriteRejected(fileAccountsMetadata(folder))
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
})
