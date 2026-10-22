// `providers test` without a network: the shared command preamble the
// refresh lane extracted (RLTESTDRIVE item 5) refuses unknown providers,
// missing keys and paid-token key tests before any list read. Only real
// modules run here: the command, the file IO over a temp providers file
// and the memory secret store. A fetch that ever answers fails the test.
import { afterEach, describe, expect, it } from 'vitest'
import {
  harnessEntry,
  paidTokenRefusal,
  providersCommandHarness,
  withDownStore,
  withHarnessKey,
  writeHarnessFile,
} from './helpers/providersCommandHarness'
import { azureOrigin } from '../../src/core/providers/presets'
import { providersTest } from '../../src/runtime/providersCommands'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'

const PROVIDER = 'testprovider'

const setup = providersCommandHarness()

afterEach(async () => {
  setUiText(EN, BASE_LOCALE)
  await setup.cleanup()
})

describe('providers test preamble', () => {
  it('refuses an unknown provider', async () => {
    const f = await setup.make('providers-test-')
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersTest(f.deps, 'nope')
    expect(exit).toBe(1)
    expect(f.errors).toEqual([fill(EN.providerUnknown, { provider: 'nope' })])
  })

  it('refuses without a stored key, before any list read', async () => {
    const f = await setup.make('providers-test-')
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersTest(f.deps, PROVIDER)
    expect(exit).toBe(1)
    expect(f.errors).toEqual([fill(EN.providerKeyAbsent, { provider: PROVIDER })])
  })

  it('names a down credential store instead of crashing on it', async () => {
    const f = withDownStore(await setup.make('providers-test-'))
    await writeHarnessFile(f.filePath, [harnessEntry(PROVIDER, ['gpt-x'])])
    const exit = await providersTest(f.deps, PROVIDER)
    expect(exit).toBe(1)
    expect(f.errors).toEqual([EN.acpStoreDown])
  })

  it('words a paid-token key test as the flags to check', async () => {
    const origin = azureOrigin('myresource')
    if (origin === undefined) throw new Error('bad azure resource name')
    const f = withHarnessKey(await setup.make('providers-test-'), 'azure-eu', origin)
    await writeHarnessFile(f.filePath, [
      harnessEntry('azure-eu', ['gpt-x'], { preset: 'azure', address: 'myresource' }),
    ])
    const exit = await providersTest(f.deps, 'azure-eu')
    expect(exit).toBe(1)
    expect(f.printed).toEqual([])
    expect(f.errors).toEqual(paidTokenRefusal())
  })
})
