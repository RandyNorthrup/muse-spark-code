import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fsPromises from 'node:fs/promises'
import { fontsBundle } from '../../src/runtime/fonts/bundle'
import { installFontPack } from '../../src/runtime/fonts/install'
import { runFontInstall } from '../../src/runtime/fonts/nodeInstall'
import { fontPackSchema } from '../../src/runtime/fonts/manifest'
import { parseCommandLine } from '../../src/runtime/cliArgs'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

function fixture() {
  const data = Buffer.alloc(48)
  data.write('wOF2')
  data.writeUInt32BE(data.length, 8)
  const notice = Buffer.from('SIL OPEN FONT LICENSE Version 1.1')
  const assets = new Map<string, Uint8Array>()
  const asset = (file: string, bytes: Uint8Array) => {
    assets.set(file, bytes)
    return {
      file,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: `https://raw.githubusercontent.com/example/fonts/${'a'.repeat(40)}/${file}`,
    }
  }
  const manifest = {
    version: 1,
    id: 'test-pack',
    fonts: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Inter'].map((family, i) => ({
      family,
      cssFamily: family,
      licence: 'OFL-1.1',
      source: 'https://example.org/fonts',
      sourceVersion: 'test-only',
      weight: '400',
      unicodeRange: 'U+0020-007E',
      font: asset(`font-${String(i)}.woff2`, data),
      notice: asset(`licence-${String(i)}.txt`, notice),
    })),
  }
  return { manifest, assets }
}

function tampered(kind: string, bytes: Buffer): Buffer {
  switch (kind) {
    case 'length': {
      return bytes
    }
    case 'digest': {
      bytes[bytes.length - 1] = 1
      return bytes
    }
    case 'licence': {
      return Buffer.from('MIT')
    }
    case 'woff-length': {
      bytes.writeUInt32BE(0, 8)
      return bytes
    }
    default: {
      bytes[0] = 0
      return bytes
    }
  }
}

const directories: string[] = []
async function temp() {
  const dir = await mkdtemp(path.join(tmpdir(), 'm114-fonts-'))
  directories.push(dir)
  return dir
}
async function localSeed() {
  const data = fixture()
  const root = await temp()
  const seed = path.join(root, 'seed')
  await mkdir(seed)
  for (const [file, bytes] of data.assets) await writeFile(path.join(seed, file), bytes)
  return { ...data, root, seed }
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('D94 explicit font installation', () => {
  it('accepts only an explicit install, with an optional local seed', () => {
    expect(parseCommandLine(['fonts', 'install'])).toEqual({
      command: 'fontsInstall',
      sourceDirectory: undefined,
    })
    expect(parseCommandLine(['fonts', 'install', '--from', String.raw`C:\font-pack`])).toEqual({
      command: 'fontsInstall',
      sourceDirectory: String.raw`C:\font-pack`,
    })
    for (const args of [
      ['fonts'],
      ['fonts', 'remove'],
      ['fonts', 'install', 'extra'],
      ['fonts', 'install', '--from', ''],
      ['fonts', 'install', '--backend', 'modelApi'],
    ])
      expect(parseCommandLine(args).command).toBe('invalid')
    expect(parseCommandLine(['--fonts']).command).toBe('invalid')
  })

  it('rejects duplicate families, traversal, unpinned URLs and wrong asset kinds before any read', async () => {
    const { manifest } = fixture()
    for (const change of [
      (m: typeof manifest) => {
        m.fonts[0]!.font.file = '../escape.woff2'
      },
      (m: typeof manifest) => {
        m.fonts[0]!.font.file = String.raw`C:\escape.woff2`
      },
      (m: typeof manifest) => {
        m.fonts[0]!.font.url = 'https://cdn.example/font.woff2'
      },
      (m: typeof manifest) => {
        m.fonts[0]!.font.file = 'font.txt'
      },
      (m: typeof manifest) => {
        m.fonts[1]!.family = m.fonts[0]!.family
      },
      (m: typeof manifest) => {
        m.fonts[0]!.font.bytes = 2 * 1024 * 1024
      },
      (m: typeof manifest) => {
        m.fonts[0]!.notice.file = m.fonts[1]!.notice.file
      },
      (m: typeof manifest) => {
        m.fonts[0]!.cssFamily = 'Font";src:url(https://evil)'
      },
    ]) {
      const mutated = structuredClone(manifest)
      change(mutated)
      const read = vi.fn()
      await expect(
        installFontPack(mutated, { read, publish: vi.fn() }, new AbortController().signal),
      ).rejects.toThrow()
      expect(read).not.toHaveBeenCalled()
    }
  })

  it('verifies every font and OFL text before publishing the CSS and manifest', async () => {
    const { manifest, assets } = fixture()
    const publish = vi.fn((_id, files: ReadonlyMap<string, Uint8Array>) => {
      expect(files.size).toBe(10)
      expect(Buffer.from(files.get('fonts.css')!).toString()).toContain('font-display:swap')
      expect(Buffer.from(files.get('fonts.css')!).toString()).not.toContain('https:')
      expect(Buffer.from(files.get('manifest.json')!).toString()).toContain('OFL-1.1')
      return Promise.resolve('/installed')
    })
    await expect(
      installFontPack(
        manifest,
        { read: (asset) => Promise.resolve(assets.get(asset.file)!), publish },
        new AbortController().signal,
      ),
    ).resolves.toBe('/installed')
    expect(publish).toHaveBeenCalledOnce()
  })

  it('rejects digest, length, WOFF2 header and OFL tampering without publication', async () => {
    for (const kind of ['digest', 'length', 'header', 'woff-length', 'licence']) {
      const { manifest, assets } = fixture()
      const entry = kind === 'licence' ? manifest.fonts[0]!.notice : manifest.fonts[0]!.font
      const bytes = tampered(kind, Buffer.from(assets.get(entry.file)!))
      if (kind === 'length') entry.bytes -= 1
      assets.set(entry.file, bytes)
      if (['header', 'woff-length', 'licence'].includes(kind)) {
        entry.bytes = bytes.length
        entry.sha256 = createHash('sha256').update(bytes).digest('hex')
      }
      const publish = vi.fn()
      await expect(
        installFontPack(
          manifest,
          { read: (a) => Promise.resolve(assets.get(a.file)!), publish },
          new AbortController().signal,
        ),
      ).rejects.toThrow('verification')
      expect(publish).not.toHaveBeenCalled()
    }
  })

  it('aborts before publication and never reads after cancellation', async () => {
    const { manifest } = fixture()
    const controller = new AbortController()
    controller.abort()
    const read = vi.fn()
    const publish = vi.fn()
    await expect(installFontPack(manifest, { read, publish }, controller.signal)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('installs from local seeds offline, is repeatable, and refuses corrupt existing packs', async () => {
    const { manifest, root, seed } = await localSeed()
    const fetcher = vi.fn<typeof fetch>()
    const input = {
      manifest,
      directory: path.join(root, 'installed'),
      sourceDirectory: seed,
      fetch: fetcher,
    }
    const destination = await runFontInstall(input)
    const installedFiles = await readdir(destination)
    expect(installedFiles.length).toBe(10)
    expect(await runFontInstall(input)).toBe(destination)
    expect(fetcher).not.toHaveBeenCalled()
    await writeFile(path.join(destination, 'fonts.css'), 'corrupted')
    await expect(runFontInstall(input)).rejects.toThrow()
    expect(await readdir(input.directory)).toEqual([path.basename(destination)])
  })

  it('refuses symlink destinations and local seed files', async () => {
    const { manifest, root, seed } = await localSeed()
    const real = path.join(root, 'real')
    await mkdir(real)
    const directory = path.join(root, 'linked')
    await symlink(real, directory, 'junction')
    const input = { manifest, directory, sourceDirectory: seed, fetch: vi.fn<typeof fetch>() }
    await expect(runFontInstall(input)).rejects.toThrow()
    expect(await readdir(real)).toEqual([])
    await rm(directory)
    const file = manifest.fonts[0]!.font.file
    await rm(path.join(seed, file))
    await symlink(seed, path.join(seed, file), 'junction')
    await expect(runFontInstall(input)).rejects.toThrow()
  })

  it('rejects a local source symlink before opening its target on every platform', async () => {
    const { manifest, root, seed } = await localSeed()
    const ordinary = await fsPromises.lstat(path.join(seed, manifest.fonts[0]!.font.file))
    const stat = vi
      .mocked(fsPromises.lstat)
      .mockResolvedValueOnce(Object.assign(ordinary, { isFile: () => false }))
    try {
      await expect(
        runFontInstall({
          manifest,
          directory: path.join(root, 'installed'),
          sourceDirectory: seed,
          fetch: vi.fn<typeof fetch>(),
        }),
      ).rejects.toThrow()
    } finally {
      stat.mockReset()
    }
  })

  it('refuses an invalid lazy module and retries after it is repaired', async () => {
    const root = await temp()
    const module = path.join(root, 'fonts.cjs')
    await writeFile(module, 'module.exports = {installFonts: 1}')
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const load = fontsBundle(module, log)
    expect(load).toThrow('could not be installed')
    await writeFile(module, 'module.exports = {installFonts: () => Promise.resolve("installed")}')
    expect(typeof load().installFonts).toBe('function')
  })

  it('uses pinned URLs with redirects and credentials disabled and bounds streaming bytes', async () => {
    const { manifest, assets } = fixture()
    const root = await temp()
    const fetcher = vi.fn<typeof fetch>((url) => {
      const name = new URL(url instanceof Request ? url.url : url).pathname.split('/').at(-1)
      const bytes = name === undefined ? undefined : assets.get(name)
      if (bytes === undefined) throw new Error('Missing fake asset')
      return Promise.resolve(new Response(new Uint8Array(bytes)))
    })
    await runFontInstall({ manifest, directory: root, fetch: fetcher })
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    })
    const pulls = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (pulls.mock.calls.length === 1) controller.enqueue(new Uint8Array(100))
      else controller.error(new Error('Read after the byte bound'))
    })
    const tooLarge = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ReadableStream({ pull: pulls }, { highWaterMark: 0 }))),
    )
    await expect(runFontInstall({ manifest, directory: root, fetch: tooLarge })).rejects.toThrow()
    expect(pulls).toHaveBeenCalledOnce()
    const denied = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 404 })))
    await expect(runFontInstall({ manifest, directory: root, fetch: denied })).rejects.toThrow()
  })

  it('validates the manifest as a strict local contract', () => {
    const { manifest } = fixture()
    expect(fontPackSchema.safeParse({ ...manifest, extra: true }).success).toBe(false)
    expect(
      fontPackSchema.safeParse({
        ...manifest,
        fonts: manifest.fonts.map((font) => ({ ...font, extra: true })),
      }).success,
    ).toBe(false)
    expect(
      fontPackSchema.safeParse({
        ...manifest,
        fonts: manifest.fonts.map((font) => ({ ...font, font: { ...font.font, extra: true } })),
      }).success,
    ).toBe(false)
    expect(fontPackSchema.parse(manifest).fonts.length).toBe(4)
  })
})
