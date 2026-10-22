// `providers refresh` (RLTESTDRIVE item 5): the filed list freezes at
// `providers add`; refresh stores every live id the file lacks, reports
// filed ids the list lacks without removing them, and leaves the file
// untouched when the list cannot be read. Only real modules run here:
// the command, the probe, the file IO over a temp providers file, and
// the memory secret store. The network is the probe's own fetch seam,
// answered with the `{data: [{id}]}` shape the probe suite proves the
// parser reads; the command dials the checked address everywhere else.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  harnessEntry,
  paidTokenRefusal,
  providersCommandHarness,
  withDownStore,
  withHarnessKey,
  writeHarnessFile,
} from './helpers/providersCommandHarness'
import { readProvidersFile } from '../../src/core/providers/providersFile'
import { azureOrigin } from '../../src/core/providers/presets'
import { providersRefresh } from '../../src/runtime/providersCommands'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, plural, setUiText } from '../../src/shared/l10n/text'

const PROVIDER = 'testprovider'
const ORIGIN = 'https://api.openai.com'

const setup = providersCommandHarness()

// The probe reads through the lazily loaded backend bundles. Their
// first evaluation dwarfs one test's 5 s budget on a loaded rig, so it
// is shared here once instead of landing inside the first refresh test.
beforeAll(async () => {
  await import('../../src/host/backend/modelApiEntry')
  await import('../../src/host/backend/configuredProvidersEntry')
})

afterEach(async () => {
  setUiText(EN, BASE_LOCALE)
  await setup.cleanup()
})

async function filedModels(filePath: string): Promise<readonly string[]> {
  const read = await readProvidersFile(filePath)
  if (!read.ok) throw new Error(read.detail)
  const found = read.file.providers.find((candidate) => candidate.id === PROVIDER)
  if (found === undefined) throw new Error('entry is missing after the command')
  return found.models
}

function listBody(ids: readonly string[]): Response {
  return Response.json({ data: ids.map((id) => ({ id })) }, { status: 200 })
}

function failingList(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed'))
}

function listAnswer(ids: readonly string[]): typeof fetch {
  return () => Promise.resolve(listBody(ids))
}

function failingFetch(): typeof fetch {
  return failingList
}

describe('providers refresh', () => {
  it('stores live ids the file lacks, and names them', async () => {
    const f = withHarnessKey(await setup.make('providers-refresh-'), PROVIDER, ORIGIN)
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersRefresh(f.deps, PROVIDER, listAnswer(['gpt-x', 'gpt-y']))
    expect(exit).toBe(0)
    expect(await filedModels(f.filePath)).toEqual(['gpt-x', 'gpt-y'])
    expect(f.printed).toContain(
      plural(EN.providerRefreshAdded, 1, { provider: PROVIDER, models: 'gpt-y' }),
    )
    expect(f.errors).toEqual([])
  })

  it('reports filed ids the list lacks, and keeps them', async () => {
    const f = withHarnessKey(await setup.make('providers-refresh-'), PROVIDER, ORIGIN)
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gone'])])
    const exit = await providersRefresh(f.deps, PROVIDER, listAnswer(['gpt-y']))
    expect(exit).toBe(0)
    expect(await filedModels(f.filePath)).toEqual(['gone', 'gpt-y'])
    expect(f.printed).toContain(
      fill(EN.providerRefreshMissing, { provider: PROVIDER, models: 'gone' }),
    )
  })

  it('reads current when the file already carries every live id', async () => {
    const f = withHarnessKey(await setup.make('providers-refresh-'), PROVIDER, ORIGIN)
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x', 'gpt-y'])])
    const exit = await providersRefresh(f.deps, PROVIDER, listAnswer(['gpt-y', 'gpt-x']))
    expect(exit).toBe(0)
    expect(await filedModels(f.filePath)).toEqual(['gpt-x', 'gpt-y'])
    expect(f.printed).toContain(plural(EN.providerRefreshCurrent, 2, { provider: PROVIDER }))
  })

  it('refuses an unknown provider without touching the file', async () => {
    const f = await setup.make('providers-refresh-')
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersRefresh(f.deps, 'nope', listAnswer(['gpt-x']))
    expect(exit).toBe(1)
    expect(f.errors).toContain(fill(EN.providerUnknown, { provider: 'nope' }))
    expect(await filedModels(f.filePath)).toEqual(['gpt-x'])
  })

  it('refuses without a stored key, before any list read', async () => {
    const f = await setup.make('providers-refresh-')
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersRefresh(f.deps, PROVIDER, () =>
      Promise.reject(new Error('list must not be read')),
    )
    expect(exit).toBe(1)
    expect(f.errors).toContain(fill(EN.providerKeyAbsent, { provider: PROVIDER }))
    expect(await filedModels(f.filePath)).toEqual(['gpt-x'])
  })

  it('names a down credential store instead of crashing on it', async () => {
    const f = withDownStore(await setup.make('providers-refresh-'))
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersRefresh(f.deps, PROVIDER, () =>
      Promise.reject(new Error('list must not be read')),
    )
    expect(exit).toBe(1)
    expect(f.errors).toEqual([EN.acpStoreDown])
  })

  it('refuses a paid-token key test with the same sentence as providers test', async () => {
    const origin = azureOrigin('myresource')
    if (origin === undefined) throw new Error('bad azure resource name')
    const f = withHarnessKey(await setup.make('providers-refresh-'), 'azure-eu', origin)
    await writeHarnessFile(f.filePath, [
      harnessEntry('azure-eu', [], { preset: 'azure', address: 'myresource' }),
    ])
    const exit = await providersRefresh(f.deps, 'azure-eu', () =>
      Promise.reject(new Error('list must not be read')),
    )
    expect(exit).toBe(1)
    expect(f.printed).toEqual([])
    expect(f.errors).toEqual(paidTokenRefusal())
  })

  it('fails with the probe reason when the list cannot be read, leaving the file untouched', async () => {
    const f = withHarnessKey(await setup.make('providers-refresh-'), PROVIDER, ORIGIN)
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersRefresh(f.deps, PROVIDER, failingFetch())
    expect(exit).toBe(1)
    expect(f.errors).toEqual([fill(EN.providerTestFailed, { detail: EN.providerProbeUnreachable })])
    expect(await filedModels(f.filePath)).toEqual(['gpt-x'])
  })
})
