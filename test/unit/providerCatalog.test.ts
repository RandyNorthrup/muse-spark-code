import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import type * as fs from 'node:fs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDownloadChecksum,
  assertSnapshotSize,
  CATALOG_PRESETS,
  CATALOG_SOURCE,
  CATALOG_UPSTREAM,
  copyCatalogToDist,
  download,
  FETCH_TIMEOUT_MS,
  filterCatalog,
  MAX_DOWNLOAD_BYTES,
  MAX_SNAPSHOT_BYTES,
  parseCatalogApi,
  parseCatalogSnapshot,
  run,
  snapshotDocument,
  snapshotText,
  syncCatalog,
  verifyVendorFiles,
  writeVendorManifest,
} from '../../scripts/sync-provider-catalog.mjs'

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof fs>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})
const actualFs = await vi.importActual<typeof fs>('node:fs')

const ROOT = path.resolve(import.meta.dirname, '../..')
const VENDOR_ROOT = path.join(ROOT, 'vendor/models-dev')
const TEST_ROOT = path.join(ROOT, 'temp')
const DATE = '2026-10-04'
const dirs: string[] = []

afterEach(() => {
  vi.mocked(readFileSync).mockImplementation(actualFs.readFileSync)
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(`${TEST_ROOT}${path.sep}`)) throw new Error('Test cleanup outside worktree')
    rmSync(dir, { recursive: true, force: true })
  }
})

function newDir(): string {
  mkdirSync(TEST_ROOT, { recursive: true })
  const dir = mkdtempSync(path.join(TEST_ROOT, 'provider-catalog-'))
  dirs.push(dir)
  return dir
}

function digest(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// Synthetic models.dev data, with the same fields as the research capture.
// All required providers must be present so a partial response cannot pass.
function downloadFixture(): Record<string, unknown> {
  const providers: Record<string, unknown> = {}
  for (const { catalog } of CATALOG_PRESETS) {
    providers[catalog] = {
      id: catalog,
      name: catalog,
      models: { [`${catalog}-chat`]: { id: `${catalog}-chat`, tool_call: true } },
    }
  }
  providers['openai'] = {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    doc: 'https://platform.openai.com/docs',
    env: ['OPENAI_API_KEY'],
    npm: '@ai-sdk/openai',
    models: {
      'gpt-test': {
        id: 'gpt-test',
        name: 'GPT test',
        tool_call: true,
        reasoning: true,
        attachment: true,
        modalities: ['text', 'image'],
        release_date: '2026-09-01',
        temperature: true,
        cost: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 2, reasoning: 3 },
        limit: { context: 400_000, output: 128_000, input: 272_000 },
      },
      'chat-only': { id: 'chat-only', tool_call: false },
      unpriced: { id: 'unpriced', tool_call: true },
    },
  }
  providers['not-a-preset'] = {
    id: 'not-a-preset',
    models: { other: { id: 'other', tool_call: true } },
  }
  return providers
}

function fixtureText(): string {
  return snapshotText(snapshotDocument(filterCatalog(downloadFixture()), DATE))
}

function vendorDir(): string {
  const dir = newDir()
  writeFileSync(path.join(dir, 'LICENSE'), readFileSync(path.join(VENDOR_ROOT, 'LICENSE')))
  writeFileSync(path.join(dir, 'snapshot.json'), fixtureText())
  writeVendorManifest(dir, {
    downloadSha256: digest(JSON.stringify(downloadFixture())),
    fetchedAt: DATE,
    providers: CATALOG_PRESETS.map(({ catalog }) => catalog),
  })
  return dir
}

function changeManifest(dir: string, change: (manifest: Record<string, unknown>) => void): void {
  const file = path.join(dir, 'VENDOR.json')
  const manifest: Record<string, unknown> = JSON.parse(readFileSync(file, 'utf8'))
  change(manifest)
  writeFileSync(file, JSON.stringify(manifest))
}

describe('vendored catalogue', () => {
  it('ships a sealed, dated, nonempty snapshot under the data cap', () => {
    expect(verifyVendorFiles(VENDOR_ROOT).files).toBe(2)
    const snapshot = parseCatalogSnapshot(
      readFileSync(path.join(VENDOR_ROOT, 'snapshot.json'), 'utf8'),
    )
    expect(snapshot.source).toBe(CATALOG_SOURCE)
    expect(snapshot.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Object.keys(snapshot.providers).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      CATALOG_PRESETS.map(({ preset }) => preset).toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(verifyVendorFiles(VENDOR_ROOT).bytes).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES)
  })

  it('covers the thirteen cloud presets and reserves Meta', () => {
    expect(CATALOG_PRESETS.map(({ catalog, preset }) => `${catalog}:${preset}`)).toEqual([
      'openai:openai',
      'azure:azure',
      'xai:xai',
      'openrouter:openrouter',
      'groq:groq',
      'deepseek:deepseek',
      'mistral:mistral',
      'togetherai:together',
      'fireworks-ai:fireworks',
      'huggingface:huggingface',
      'zai:zai',
      'anthropic:anthropic',
      'google:gemini',
    ])
    for (const { preset } of CATALOG_PRESETS) {
      expect(preset).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
      expect(preset).not.toBe('meta')
    }
    expect(CATALOG_UPSTREAM).toBe('https://github.com/anomalyco/models.dev')
  })
})

describe('download checksum guard', () => {
  const bytes = new TextEncoder().encode('abc')
  const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  it('accepts the known SHA-256 vector including uppercase pins', () => {
    expect(assertDownloadChecksum(bytes, expected.toUpperCase())).toBe(expected)
  })
  it('refuses a mismatching download', () => {
    expect(() => assertDownloadChecksum(bytes, '0'.repeat(64))).toThrow('SHA-256 mismatch')
  })
  it.each(['', 'xyz', '0'.repeat(63), '0'.repeat(65), null])(
    'refuses a malformed pin: %s',
    (pin) => {
      expect(() => assertDownloadChecksum(bytes, pin)).toThrow('64-character hex')
    },
  )
})

describe('download integrity', () => {
  it.each(['', '{', '{"openai":', '[1, 2', '"openai"', 'null', '[]', '{}'])(
    'refuses truncated or empty JSON: %s',
    (text) => {
      expect(() => parseCatalogApi(text)).toThrow(/not valid JSON|empty or not an object/)
    },
  )
  it.each(['{"openai":null}', '{"openai":{"models":null}}', '{"openai":[]}'])(
    'refuses a malformed provider: %s',
    (text) => {
      expect(() => parseCatalogApi(text)).toThrow('no models')
    },
  )
  it('refuses a missing required provider', () => {
    const fixture = downloadFixture()
    delete fixture['anthropic']
    expect(() => filterCatalog(fixture)).toThrow("missing 'anthropic'")
  })
  it('refuses a provider with no tool-capable models', () => {
    const fixture = downloadFixture()
    fixture['groq'] = { models: { plain: { id: 'plain', tool_call: false } } }
    expect(() => filterCatalog(fixture)).toThrow("no tool-capable models for 'groq'")
  })
  it.each([-1, NaN, Infinity, 'free'])(
    'refuses invalid prices rather than silently erasing them: %s',
    (value) => {
      const fixture = downloadFixture()
      fixture['groq'] = { models: { bad: { id: 'bad', tool_call: true, cost: { input: value } } } }
      expect(() => filterCatalog(fixture)).toThrow()
    },
  )
  it('refuses malformed model data', () => {
    const fixture = downloadFixture()
    fixture['groq'] = { models: { bad: { tool_call: true } } }
    expect(() => filterCatalog(fixture)).toThrow()
  })

  it('accepts captured zero limits only on models the tool filter excludes', () => {
    const fixture = downloadFixture()
    fixture['groq'] = {
      models: {
        chat: { id: 'chat', tool_call: true, limit: { context: 32_000, output: 4096 } },
        image: { id: 'image', tool_call: false, limit: { context: 0, input: 0, output: 0 } },
      },
    }
    const providers = filterCatalog(parseCatalogApi(JSON.stringify(fixture)))
    expect(Object.keys(providers['groq']?.models ?? {})).toEqual(['chat'])
  })

  it.each([0, -1, 0.5, Infinity])(
    'refuses unusable limits on a retained tool model: %s',
    (value) => {
      const fixture = downloadFixture()
      fixture['groq'] = {
        models: { bad: { id: 'bad', tool_call: true, limit: { context: value } } },
      }
      expect(() => filterCatalog(fixture)).toThrow()
    },
  )
})

describe('catalogue filter', () => {
  it('keeps only required providers and tool-capable models', () => {
    const providers = filterCatalog(downloadFixture())
    expect(Object.keys(providers).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      CATALOG_PRESETS.map(({ preset }) => preset).toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(providers['openai']?.catalog).toBe('openai')
    expect(providers['openai']?.api).toBe('https://api.openai.com/v1')
    expect(providers['openai']?.models['chat-only']).toBeUndefined()
    expect(providers['not-a-preset']).toBeUndefined()
    expect(providers['openai']?.models['unpriced']).not.toHaveProperty('cost')
  })
  it('preserves prices, input and output limits and capability fields', () => {
    const openai = filterCatalog(downloadFixture())['openai']
    expect(openai?.models['gpt-test']).toEqual({
      id: 'gpt-test',
      name: 'GPT test',
      tool_call: true,
      reasoning: true,
      attachment: true,
      modalities: ['text', 'image'],
      release_date: '2026-09-01',
      cost: { input: 1.25, output: 10, cache_read: 0.125, cache_write: 2, reasoning: 3 },
      limit: { context: 400_000, input: 272_000, output: 128_000 },
    })
    expect(openai).not.toHaveProperty('env')
    expect(openai).not.toHaveProperty('npm')
  })

  it('preserves structured modality metadata without assuming an array', () => {
    const fixture = downloadFixture()
    const metadata = { input: ['text', 'image'], output: ['text'] }
    fixture['groq'] = {
      models: { structured: { id: 'structured', tool_call: true, modalities: metadata } },
    }
    expect(filterCatalog(fixture)['groq']?.models['structured']?.modalities).toEqual(metadata)
  })

  it('preserves additional price metadata for the runtime reader', () => {
    const fixture = downloadFixture()
    const prices = { input: 1, output: 2, additional: { input: 3, output: 4 } }
    fixture['groq'] = { models: { tiered: { id: 'tiered', tool_call: true, cost: prices } } }
    expect(filterCatalog(fixture)['groq']?.models['tiered']?.cost).toEqual(prices)
  })

  it('preserves long-context tiers and 1-hour cache-write prices (M101 BYO 6)', () => {
    const fixture = downloadFixture()
    const prices = {
      input: 1.25,
      output: 10,
      cache_read: 0.125,
      cache_write: 2,
      cache_write_1h: 4,
      tiers: [{ up_to: 272_000, input: 1.25, output: 10, cache_read: 0.125, cache_write: 4 }],
    }
    fixture['openrouter'] = {
      models: { tiered: { id: 'tiered', tool_call: true, cost: prices } },
    }
    const filtered = filterCatalog(fixture)
    expect(filtered['openrouter']?.models['tiered']?.cost).toEqual(prices)
    // The sealed snapshot carries them to the runtime price reader unchanged.
    const snapshot: { providers: Record<string, { models: Record<string, unknown> }> } =
      parseCatalogSnapshot(snapshotText(snapshotDocument(filtered, DATE)))
    expect(snapshot.providers['openrouter']?.models['tiered']).toMatchObject({ cost: prices })
  })
})

describe('snapshot validation and cap', () => {
  it('accepts exactly the cap and refuses one byte past it', () => {
    expect(assertSnapshotSize(MAX_SNAPSHOT_BYTES)).toBe(MAX_SNAPSHOT_BYTES)
    expect(() => assertSnapshotSize(MAX_SNAPSHOT_BYTES + 1)).toThrow('the cap is')
  })
  it.each([-1, 0.5, NaN])('refuses a non-byte size: %s', (size) => {
    expect(() => assertSnapshotSize(size)).toThrow('counted in bytes')
  })
  it('refuses an oversized UTF-8 snapshot when rendered', () => {
    const document = snapshotDocument(filterCatalog(downloadFixture()), DATE)
    document.source = 'é'.repeat(MAX_SNAPSHOT_BYTES / 2)
    expect(() => snapshotText(document)).toThrow('the cap is')
  })
  it('refuses an empty skeleton', () => {
    expect(() =>
      parseCatalogSnapshot(
        '{"version":1,"source":"https://models.dev/api.json","fetchedAt":null,"providers":{}}',
      ),
    ).toThrow('date')
  })
  it.each(['2026-02-30', 'tomorrow', '2026-13-01'])('refuses an invalid date: %s', (date) => {
    expect(() => snapshotDocument(filterCatalog(downloadFixture()), date)).toThrow()
  })
  it.each(['version', 'source', 'fetchedAt', 'providers'])(
    'refuses snapshot metadata drift: %s',
    (field) => {
      const document: Record<string, unknown> = JSON.parse(fixtureText())
      document[field] = field === 'version' ? 2 : 'wrong'
      expect(() => parseCatalogSnapshot(JSON.stringify(document))).toThrow()
    },
  )
  it('refuses partial provider data even with correct top-level metadata', () => {
    const providers = filterCatalog(downloadFixture())
    delete providers['anthropic']
    expect(() => parseCatalogSnapshot(snapshotText(snapshotDocument(providers, DATE)))).toThrow(
      'presets',
    )
  })

  it('refuses a provider mapped to another catalogue source', () => {
    const providers = filterCatalog(downloadFixture())
    const openai = providers['openai']
    if (openai === undefined) throw new Error('Missing fixture provider')
    openai.catalog = 'anthropic'
    expect(() => parseCatalogSnapshot(snapshotText(snapshotDocument(providers, DATE)))).toThrow(
      'does not match',
    )
  })

  it('refuses an extra provider outside the preset filter', () => {
    const providers = filterCatalog(downloadFixture())
    const openai = providers['openai']
    if (openai === undefined) throw new Error('Missing fixture provider')
    providers['extra'] = openai
    expect(() => parseCatalogSnapshot(snapshotText(snapshotDocument(providers, DATE)))).toThrow(
      'presets',
    )
  })
  it('refuses a model without tools or with a mismatching id', () => {
    for (const model of [
      { id: 'wrong', tool_call: true },
      { id: 'only', tool_call: false },
    ]) {
      const providers: Record<string, unknown> = filterCatalog(downloadFixture())
      providers['groq'] = { catalog: 'groq', models: { only: model } }
      expect(() =>
        parseCatalogSnapshot(
          JSON.stringify({ version: 1, source: CATALOG_SOURCE, fetchedAt: DATE, providers }),
        ),
      ).toThrow('matching id')
    }
  })
})

describe('manifest and build copy', () => {
  it('copies the bytes it hashed even if the source changes during verification', () => {
    const dir = vendorDir()
    const snapshot = path.join(dir, 'snapshot.json')
    const original = readFileSync(snapshot)
    const target = path.join(newDir(), 'providerCatalog.json')
    let hasChanged = false
    vi.mocked(readFileSync).mockImplementation((file, options) => {
      const bytes = actualFs.readFileSync(file, options)
      if (file === snapshot && !hasChanged) {
        hasChanged = true
        writeFileSync(snapshot, `${fixtureText()} `)
      }
      return bytes
    })
    copyCatalogToDist(dir, target)
    expect(readFileSync(target)).toEqual(original)
  })

  it('copies verified bytes exactly, including the final newline', () => {
    const dir = vendorDir()
    const target = path.join(dir, 'dist/providerCatalog.json')
    expect(copyCatalogToDist(dir, target)).toBe(Buffer.byteLength(fixtureText()))
    expect(readFileSync(target)).toEqual(readFileSync(path.join(dir, 'snapshot.json')))
  })
  it('refuses a missing snapshot or manifest before creating output', () => {
    const dir = newDir()
    const target = path.join(dir, 'dist/providerCatalog.json')
    expect(() => copyCatalogToDist(dir, target)).toThrow('--sync')
    writeFileSync(path.join(dir, 'snapshot.json'), fixtureText())
    expect(() => copyCatalogToDist(dir, target)).toThrow('manifest')
    expect(existsSync(target)).toBe(false)
  })
  it('refuses tampered snapshot bytes before replacing a build copy', () => {
    const dir = vendorDir()
    const target = path.join(newDir(), 'providerCatalog.json')
    writeFileSync(target, 'last good copy')
    writeFileSync(path.join(dir, 'snapshot.json'), `${fixtureText()} `)
    expect(() => copyCatalogToDist(dir, target)).toThrow('SHA-256 mismatch')
    expect(readFileSync(target, 'utf8')).toBe('last good copy')
  })
  it('refuses tampered license bytes', () => {
    const dir = vendorDir()
    writeFileSync(path.join(dir, 'LICENSE'), 'altered license')
    expect(() => verifyVendorFiles(dir)).toThrow('SHA-256 mismatch')
  })
  it('refuses unlisted and missing files', () => {
    const dir = vendorDir()
    writeFileSync(path.join(dir, 'stray.txt'), 'stray')
    expect(() => verifyVendorFiles(dir)).toThrow('not in the manifest')
    rmSync(path.join(dir, 'stray.txt'))
    rmSync(path.join(dir, 'LICENSE'))
    expect(() => verifyVendorFiles(dir)).toThrow('not vendored')
  })
  it('refuses date and provider agreement drift', () => {
    const dir = vendorDir()
    changeManifest(dir, (manifest) => {
      manifest['fetchedAt'] = '2026-10-03'
    })
    expect(() => verifyVendorFiles(dir)).toThrow('date does not match')
    changeManifest(dir, (manifest) => {
      manifest['fetchedAt'] = DATE
      manifest['providers'] = ['openai']
    })
    expect(() => verifyVendorFiles(dir)).toThrow('providers do not match')
  })
  it('refuses duplicate, traversal and extra manifest paths', () => {
    const dir = vendorDir()
    for (const paths of [
      ['LICENSE', 'LICENSE', 'snapshot.json'],
      ['../outside', 'snapshot.json'],
      ['LICENSE'],
    ]) {
      changeManifest(dir, (manifest) => {
        manifest['files'] = paths.map((file) => ({ path: file, sha256: '0'.repeat(64) }))
      })
      expect(() => verifyVendorFiles(dir)).toThrow('exactly LICENSE and snapshot.json')
    }
  })
  it('refuses oversized sealed bytes on the build path', () => {
    const dir = vendorDir()
    writeFileSync(path.join(dir, 'snapshot.json'), 'x'.repeat(MAX_SNAPSHOT_BYTES + 1))
    writeVendorManifest(dir, {
      downloadSha256: '0'.repeat(64),
      fetchedAt: DATE,
      providers: CATALOG_PRESETS.map(({ catalog }) => catalog),
    })
    expect(() => copyCatalogToDist(dir, path.join(dir, 'out.json'))).toThrow('the cap is')
  })
})

describe('bounded download', () => {
  it('uses the fixed URL, refuses redirects and bounds the request lifetime', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('abc'))
    const bytes = await download(fetcher)
    expect(bytes.toString()).toBe('abc')
    expect(fetcher).toHaveBeenCalledWith(CATALOG_SOURCE, {
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(FETCH_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
  })
  it('refuses an oversized announced response before reading it', async () => {
    const response = new Response('abc', {
      headers: { 'content-length': String(MAX_DOWNLOAD_BYTES + 1) },
    })
    await expect(download(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow(
      'announces',
    )
    expect(response.bodyUsed).toBe(false)
  })
  it('refuses a chunked response past the cap and cancels it', async () => {
    const cancel = vi.fn()
    let hasSent = false
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (hasSent) {
            controller.close()
            return
          }
          hasSent = true
          controller.enqueue(new Uint8Array(MAX_DOWNLOAD_BYTES + 1))
        },
        cancel,
      },
      { highWaterMark: 0 },
    )
    const attempt = (async () => {
      const bytes = await download(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)))
      return bytes.byteLength
    })()
    await expect(attempt).rejects.toThrow('exceeds')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('refuses an incomplete announced response', async () => {
    const response = new Response('abc', { headers: { 'content-length': '4' } })
    await expect(download(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow(
      'truncated',
    )
  })
  it('counts decoded bytes independently of a compressed content length', async () => {
    const response = new Response('decoded', {
      headers: { 'content-length': '3', 'content-encoding': 'gzip' },
    })
    const bytes = await download(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(bytes.toString()).toBe('decoded')
  })
  it('refuses HTTP failures and missing bodies', async () => {
    await expect(
      download(vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { status: 503 }))),
    ).rejects.toThrow('HTTP 503')
    await expect(
      download(vi.fn<typeof fetch>().mockResolvedValue(new Response(null))),
    ).rejects.toThrow('no body')
  })
})

describe('sync validation before writes', () => {
  it('refuses incomplete offline flags before reading or fetching', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Network forbidden'))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(run(['--sync', '--from', 'missing.json', '--date', DATE])).rejects.toThrow(
        'Usage:',
      )
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses a bad offline pin without changing either reviewed file', async () => {
    const dir = vendorDir()
    const before = ['snapshot.json', 'VENDOR.json'].map((file) =>
      readFileSync(path.join(dir, file)),
    )
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Network forbidden'))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(
        run(
          [
            '--sync',
            '--from',
            path.join(ROOT, 'docs/certification/m95-c/api.json.raw'),
            '--date',
            DATE,
            '--sha256',
            '0'.repeat(64),
          ],
          dir,
        ),
      ).rejects.toThrow('SHA-256 mismatch')
      expect(fetcher).not.toHaveBeenCalled()
      expect(
        ['snapshot.json', 'VENDOR.json'].map((file) => readFileSync(path.join(dir, file))),
      ).toEqual(before)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reproduces the sealed snapshot offline from the saved HTTP capture', async () => {
    const dir = vendorDir()
    const manifest: { downloadSha256: string; fetchedAt: string } = JSON.parse(
      readFileSync(path.join(VENDOR_ROOT, 'VENDOR.json'), 'utf8'),
    )
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Network forbidden'))
    vi.stubGlobal('fetch', fetcher)
    try {
      // Repeated offline syncs must stay byte-identical and fit the normal deadline.
      for (let replay = 0; replay < 3; replay += 1) {
        await run(
          [
            '--sync',
            '--from',
            path.join(ROOT, 'docs/certification/m95-c/api.json.raw'),
            '--date',
            manifest.fetchedAt,
            '--sha256',
            manifest.downloadSha256,
          ],
          dir,
        )
        expect(fetcher).not.toHaveBeenCalled()
        for (const file of ['snapshot.json', 'VENDOR.json', 'LICENSE']) {
          const actual = readFileSync(path.join(dir, file))
          const expected = readFileSync(path.join(VENDOR_ROOT, file))
          expect(actual.length).toBe(expected.length)
          expect(digest(actual)).toBe(digest(expected))
        }
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('seals valid filtered data with the original download digest', () => {
    const dir = vendorDir()
    const bytes = Buffer.from(JSON.stringify(downloadFixture()))
    expect(syncCatalog(bytes, digest(bytes), '2026-10-05', dir).files).toBe(2)
    const snapshot = parseCatalogSnapshot(readFileSync(path.join(dir, 'snapshot.json'), 'utf8'))
    expect(snapshot.fetchedAt).toBe('2026-10-05')
    expect(readFileSync(path.join(dir, 'VENDOR.json'), 'utf8')).toContain(digest(bytes))
  })

  it.each(['checksum', 'truncated', 'missing provider', 'date', 'missing license'])(
    'leaves both reviewed files unchanged on a bad %s',
    (kind) => {
      const dir = vendorDir()
      const beforeSnapshot = readFileSync(path.join(dir, 'snapshot.json'))
      const beforeManifest = readFileSync(path.join(dir, 'VENDOR.json'))
      const fixture = downloadFixture()
      if (kind === 'missing provider') delete fixture['anthropic']
      const bytes = Buffer.from(kind === 'truncated' ? '{' : JSON.stringify(fixture))
      if (kind === 'missing license') rmSync(path.join(dir, 'LICENSE'))
      expect(() =>
        syncCatalog(
          bytes,
          kind === 'checksum' ? '0'.repeat(64) : digest(bytes),
          kind === 'date' ? '2026-02-30' : DATE,
          dir,
        ),
      ).toThrow()
      expect(readFileSync(path.join(dir, 'snapshot.json'))).toEqual(beforeSnapshot)
      expect(readFileSync(path.join(dir, 'VENDOR.json'))).toEqual(beforeManifest)
    },
  )
})
