import { mkdtempSync } from 'node:fs'
import { type FileHandle, open, rename, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { acpMediaIo } from './helpers/acpMediaIo'
import { canonicalPath } from '../../src/host/canonicalPath'
import {
  BYTES_PER_MIB,
  MAX_IMAGE_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  UI_TEXT,
} from '../../src/shared/constants'
import { AcpMedia } from '../../src/acp/media'
import { mediaModel } from './helpers/media/replay'
import { pdfFixture } from './helpers/pdfFixture'
import { videoFixture, wavFixture, mp3Fixture, ebmlFixture } from './helpers/media/fixtures'
import { removeFolder } from './helpers/temporaryFolders'
import * as mediaLimits from '../../src/core/media/limits'

const root = mkdtempSync(path.join(tmpdir(), 'm105-e2-media-'))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<{ open: typeof open; stat: typeof stat }>()
  return { ...actual, open: vi.fn(actual.open) }
})
afterAll(async () => {
  await removeFolder(root)
})
const io = acpMediaIo()
const maximum = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB

async function read(name: string, bytes: Uint8Array) {
  const target = path.join(root, name)
  await writeFile(target, bytes)
  const canonical = await canonicalPath(target)
  const file = await io.readMedia?.(target, maximum, canonical)
  if (file === undefined || 'kind' in file) throw new Error('media missing')
  return { file, target, canonical }
}

async function streamed(source: { open(signal: AbortSignal): AsyncIterable<Uint8Array> }) {
  const chunks: Uint8Array[] = await Array.fromAsync(source.open(new AbortController().signal))
  return Buffer.concat(chunks)
}

/** Test-only stale timestamps isolate the independent digest/identity guards. */
function freezeTimes(held: FileHandle, original: { mtimeMs: number; ctimeMs: number }) {
  const nativeStat = held.stat.bind(held)
  vi.spyOn(held, 'stat').mockImplementation(async (options) => {
    const current = await nativeStat(options)
    if (typeof current.mtimeMs === 'number' && typeof current.ctimeMs === 'number') {
      current.mtimeMs = original.mtimeMs
      current.ctimeMs = original.ctimeMs
    }
    return current
  })
  vi.mocked(open).mockResolvedValueOnce(held)
}

describe('checked media reads', () => {
  it('recognizes a renamed PDF larger than the image cap before reading its bytes', async () => {
    const target = path.join(root, 'renamed.bin')
    const header = Buffer.from(pdfFixture(2))
    await writeFile(
      target,
      Buffer.concat([header, Buffer.alloc(MAX_IMAGE_BYTES + 1 - header.length, 0x20)]),
    )
    const prepare = vi.fn(() =>
      Promise.resolve({ type: 'text' as const, text: 'registered-document' }),
    )
    const media = new AcpMedia({
      cwd: root,
      sessionId: 'session',
      backend: 'modelApi',
      platform: process.platform,
      interactive: true,
      modelId: () => 'muse-spark-1.3',
      model: mediaModel,
      io,
      assertReadable: () => Promise.resolve(),
      prepare,
    })
    expect(await media.attach('renamed.bin', new AbortController().signal)).toMatchObject({
      info: { kind: 'document', sizeBytes: MAX_IMAGE_BYTES + 1 },
    })
    expect(prepare).toHaveBeenCalledOnce()
  })
  it('refuses changing handle metadata during the sniff/hash read', async () => {
    const target = path.join(root, 'unstable.mp4')
    await writeFile(target, videoFixture())
    const held = await open(target, 'r')
    const nativeStat = held.stat.bind(held)
    let regularStats = 0
    vi.spyOn(held, 'stat').mockImplementation(async (options) => {
      const current = await nativeStat(options)
      if (typeof current.mtimeMs === 'number') {
        regularStats++
        if (regularStats === 2) current.mtimeMs++
      }
      return current
    })
    vi.mocked(open).mockResolvedValueOnce(held)
    await expect(io.readMedia?.(target, maximum, await canonicalPath(target))).rejects.toThrow(
      'changed since upload',
    )
  })
  it('sniffs mp4, mp3 and wav and uploads through fresh bounded streams', async () => {
    for (const [name, bytes, kind] of [
      ['clip.mp4', videoFixture(), 'video'],
      ['voice.mp3', mp3Fixture(), 'audio'],
      ['voice.wav', wavFixture(), 'audio'],
    ] as const) {
      const { file } = await read(name, bytes)
      expect(file.info).toMatchObject({ kind, sizeBytes: bytes.length })
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(await streamed(file.source)).toEqual(Buffer.from(bytes))
      expect(await streamed(file.source)).toEqual(Buffer.from(bytes))
      expect(JSON.stringify({ info: file.info, sha256: file.sha256 })).not.toContain(
        Buffer.from(bytes).toString('base64'),
      )
    }
  })

  it('refuses size limits and cancellation while leaving format policy to the selected model', async () => {
    const { target, canonical } = await read('limits.mp4', videoFixture())
    const sniff = vi.spyOn(mediaLimits, 'sniffMedia')
    await expect(io.readMedia?.(target, 1, canonical)).rejects.toThrow()
    expect(sniff).not.toHaveBeenCalled()
    sniff.mockRestore()
    await writeFile(target, ebmlFixture())
    await expect(io.readMedia?.(target, maximum, canonical)).resolves.toMatchObject({
      info: { kind: 'video', mediaType: 'video/webm' },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(io.readMedia?.(target, maximum, canonical, controller.signal)).rejects.toThrow()
  })

  it('names an empty file empty instead of over the limit', async () => {
    const target = path.join(root, 'empty.mp4')
    await writeFile(target, new Uint8Array())
    await expect(io.readMedia?.(target, maximum, await canonicalPath(target))).rejects.toThrow(
      UI_TEXT.execFileEmpty,
    )
  })

  it('refuses a changed same-size source digest before a stream can finish', async () => {
    const { file, target } = await read('digest.mp4', videoFixture())
    const original = await stat(target)
    const changed = videoFixture()
    changed[changed.length - 1] = 1
    await writeFile(target, changed)
    freezeTimes(await open(target, 'r'), original)
    await expect(streamed(file.source)).rejects.toThrow('changed since upload')
  })

  it('refuses source growth and replacement identity when reopening', async () => {
    const { file, target } = await read('growth.mp4', videoFixture())
    await writeFile(target, Buffer.concat([videoFixture(), Buffer.from('extra')]))
    await expect(
      file.source.open(new AbortController().signal)[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('changed since upload')
    await expect(streamed(file.source)).rejects.toThrow('changed since upload')
    const second = await read('replacement.mp4', videoFixture())
    const original = await stat(second.target)
    await rename(second.target, `${second.target}.old`)
    await writeFile(second.target, videoFixture())
    freezeTimes(await open(second.target, 'r'), original)
    await expect(streamed(second.file.source)).rejects.toThrow('changed since upload')
  })

  it('refuses a path retargeted after canonical approval', async () => {
    const first = await read('approved.mp4', videoFixture())
    const other = await read('other.mp4', videoFixture({ durationSeconds: 2 }))
    const link = path.join(root, 'linked.mp4')
    // POSIX rigs support symlinks; Windows junction/retarget coverage stays with the lead.
    if (process.platform === 'win32') {
      await expect(io.readMedia?.(other.target, maximum, first.canonical)).rejects.toThrow()
    } else {
      await symlink(other.target, link)
      await expect(io.readMedia?.(link, maximum, first.canonical)).rejects.toThrow()
    }
  })
})
