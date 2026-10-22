// Refresh on use (RLTESTDRIVE item 5): a model the filed list misses is
// checked against the provider's live list with the run's key before it
// refuses. Only real modules run here: assembly, the qualified-model
// refresh, the providers file in a temp folder, and the memory secret
// store. The live list is the injected seam, answered with the
// `{data: [{id}]}` shape the probe suite already proves the parser reads.
import { writeFileSync } from 'node:fs'
import { readFile as readTextFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { temporaryTracker } from './helpers/temporaryFolders'
import {
  emptyProvidersFile,
  readProvidersFile,
  writeProvidersFileAtomic,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import { presetById } from '../../src/core/providers/presets'
import { memorySecretStoreFor } from '../../src/runtime/exec/keyInput'
import {
  assembleProviderRun,
  fileLiveModelOnUse,
  refreshQualifiedModelOnUse,
  resolveProvider,
  type ProviderRunInput,
} from '../../src/runtime/exec/providerExec'
import { formatStoredProviderSecret, providerSecretAccount } from '../../src/runtime/keyStore'
import { CREDENTIAL_RECORD_VERSION } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'

const PROVIDER = 'anthropic-s2'
const ORIGIN = 'https://api.anthropic.com'
// Built, not typed: a committed key-like literal trips the secret scanner.
const KEY = `sk-ant-test-${'0'.repeat(20)}`
const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-4-1-20250805'

const tracker = temporaryTracker()

afterEach(async () => {
  setUiText(EN, BASE_LOCALE)
  await tracker.cleanup()
})

function answers(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.216.34'])
}

async function tempFile(models: readonly string[]): Promise<string> {
  const folder = await tracker.make('refresh-on-use-')
  const filePath = path.join(folder, 'providers.json')
  const file: ProvidersFile = {
    ...emptyProvidersFile(),
    providers: [{ id: PROVIDER, preset: 'anthropic', auth: 'apiKey', models: [...models] }],
  }
  const written = await writeProvidersFileAtomic(filePath, file)
  if (!written.ok) throw new Error(written.detail)
  return filePath
}

async function filedModels(filePath: string): Promise<readonly string[]> {
  const read = await readProvidersFile(filePath)
  if (!read.ok) throw new Error(read.detail)
  const entry = read.file.providers.find((candidate) => candidate.id === PROVIDER)
  if (entry === undefined) throw new Error('entry is missing after the run')
  return entry.models
}

const account = providerSecretAccount(PROVIDER) ?? ''
const secrets = () =>
  memorySecretStoreFor({
    [account]: formatStoredProviderSecret(
      { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin: ORIGIN },
      KEY,
    ),
  })

const REQUESTED = `${PROVIDER}/${HAIKU}`

function assemblyInput(
  filePath: string,
  listLiveModels: ProviderRunInput['listLiveModels'],
): ProviderRunInput {
  return {
    filePath,
    readFile: (file: string) => readTextFile(file, 'utf8'),
    secrets: secrets(),
    resolveHost: answers,
    readKey: () => Promise.reject(new Error('stdin key must not be read')),
    providerId: PROVIDER,
    model: REQUESTED,
    keyFromStdin: false,
    listLiveModels,
  }
}

function fileWith(models: readonly string[]): ProvidersFile {
  return {
    ...emptyProvidersFile(),
    providers: [{ id: PROVIDER, preset: 'anthropic', auth: 'apiKey', models: [...models] }],
  }
}

describe('assembleProviderRun refresh on use', () => {
  it('admits a live model the file misses, and files it with the stored note', async () => {
    const filePath = await tempFile([OPUS])
    const assembled = await assembleProviderRun(
      assemblyInput(filePath, () => Promise.resolve([OPUS, HAIKU])),
    )
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.run.modelRef).toBe(REQUESTED)
    expect(assembled.notice).toBe(
      fill(EN.providerModelStoredOnUse, { model: HAIKU, provider: PROVIDER }),
    )
    expect(await filedModels(filePath)).toEqual([OPUS, HAIKU])
  })

  it('refuses a model the live list lacks too, and leaves the file untouched', async () => {
    const filePath = await tempFile([OPUS])
    const assembled = await assembleProviderRun(
      assemblyInput(filePath, () => Promise.resolve([OPUS])),
    )
    expect(assembled.ok).toBe(false)
    if (assembled.ok) throw new Error('assembled unexpectedly')
    expect(assembled.failure).toEqual({
      kind: 'usage',
      reason: fill(EN.execModelNotOnProvider, {
        model: REQUESTED,
        provider: PROVIDER,
        available: `${PROVIDER}/${OPUS}`,
      }),
    })
    expect(await filedModels(filePath)).toEqual([OPUS])
  })

  it.each([
    ['an unreadable live list', () => Promise.resolve(undefined)],
    ['no wired live list', undefined],
  ] as const)(
    'refuses on the filed list alone with %s, leaving the file untouched',
    async (_, seam) => {
      const filePath = await tempFile([OPUS])
      const assembled = await assembleProviderRun(assemblyInput(filePath, seam))
      expect(assembled.ok).toBe(false)
      if (assembled.ok) throw new Error('assembled unexpectedly')
      expect(assembled.failure.kind).toBe('usage')
      expect(await filedModels(filePath)).toEqual([OPUS])
    },
  )

  it('never consults the live list for a filed model', async () => {
    const filePath = await tempFile([HAIKU])
    const assembled = await assembleProviderRun(
      assemblyInput(filePath, () => Promise.reject(new Error('live list must not be read'))),
    )
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) throw new Error('not assembled')
    expect(assembled.run.modelRef).toBe(REQUESTED)
    expect(assembled.notice).toBeUndefined()
  })
})

function qualifiedInput(
  filePath: string,
  file: ProvidersFile,
  listLive: () => Promise<readonly string[] | undefined>,
): Parameters<typeof refreshQualifiedModelOnUse>[0] {
  return {
    filePath,
    readFile: (entry: string) => readTextFile(entry, 'utf8'),
    file,
    providerId: PROVIDER,
    modelId: HAIKU,
    key: KEY,
    presets: presetById,
    resolveHost: answers,
    listLive,
  }
}

describe('refreshQualifiedModelOnUse', () => {
  it('files a live id and proceeds with the stored note', async () => {
    const filePath = await tempFile([OPUS])
    const refreshed = await refreshQualifiedModelOnUse(
      qualifiedInput(filePath, fileWith([OPUS]), () => Promise.resolve([OPUS, HAIKU])),
    )
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) throw new Error('not refreshed')
    expect(refreshed.note).toBe(
      fill(EN.providerModelStoredOnUse, { model: HAIKU, provider: PROVIDER }),
    )
    expect(await filedModels(filePath)).toEqual([OPUS, HAIKU])
  })

  it('refuses a model the live list lacks', async () => {
    const filePath = await tempFile([OPUS])
    const refreshed = await refreshQualifiedModelOnUse(
      qualifiedInput(filePath, fileWith([OPUS]), () => Promise.resolve([OPUS])),
    )
    expect(refreshed).toEqual({ ok: false })
    expect(await filedModels(filePath)).toEqual([OPUS])
  })

  it('refuses when the live list cannot be read', async () => {
    const filePath = await tempFile([OPUS])
    const refreshed = await refreshQualifiedModelOnUse(
      qualifiedInput(filePath, fileWith([OPUS]), () => Promise.resolve(undefined)),
    )
    expect(refreshed).toEqual({ ok: false })
    expect(await filedModels(filePath)).toEqual([OPUS])
  })

  it('refuses a provider the file no longer resolves', async () => {
    const filePath = await tempFile([OPUS])
    const refreshed = await refreshQualifiedModelOnUse(
      qualifiedInput(filePath, { ...emptyProvidersFile(), providers: [] }, () =>
        Promise.reject(new Error('live list must not be read')),
      ),
    )
    expect(refreshed).toEqual({ ok: false })
  })
})

describe('fileLiveModelOnUse', () => {
  it('answers the store-failed note when the file cannot be written', async () => {
    const folder = await tracker.make('refresh-on-use-')
    // The atomic writer creates missing folders, so the write fails
    // against a regular file standing where the folder would go.
    const blocker = path.join(folder, 'blocker')
    writeFileSync(blocker, 'not a folder')
    const file: ProvidersFile = {
      ...emptyProvidersFile(),
      providers: [{ id: PROVIDER, preset: 'anthropic', auth: 'apiKey', models: [OPUS] }],
    }
    const resolved = await resolveProvider(file, PROVIDER, presetById, answers)
    if (!resolved.ok) throw new Error(resolved.error)
    const note = await fileLiveModelOnUse(
      path.join(blocker, 'providers.json'),
      () => Promise.resolve(JSON.stringify(file)),
      resolved.provider,
      HAIKU,
    )
    expect(note).toBe(fill(EN.providerModelStoreFailed, { model: HAIKU, provider: PROVIDER }))
  })
})
