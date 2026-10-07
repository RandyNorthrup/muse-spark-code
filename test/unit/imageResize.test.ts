import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { resizeImage } from '../../src/core/imageResize'
import { readImageInfo } from '../../src/core/imageDimensions'
import {
  IMAGE_RESIZE_MAX_PIXELS,
  IMAGE_RESIZE_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const fixture = { folder: '', worker: '' }
const fixtures = { png: Buffer.alloc(0), jpeg: Buffer.alloc(0) }
beforeAll(async () => {
  fixture.folder = await mkdtemp(path.join(tmpdir(), 'm101-image-'))
  fixture.worker = path.join(fixture.folder, 'worker.cjs')
  await build({
    entryPoints: ['src/core/imageResizeWorker.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: fixture.worker,
  })
  fixtures.png = await readFile('test/fixtures/image-resize/landscape.png')
  fixtures.jpeg = await readFile('test/fixtures/image-resize/landscape.jpg')
})
afterAll(() => removeFolder(fixture.folder))
const limits = { maxWidth: 80, maxHeight: 60 }
const signal = () => new AbortController().signal

describe('real PNG/JPEG downscaling', () => {
  it.each(['png', 'jpeg'] as const)(
    'decodes and re-encodes %s pixels with aspect preserved',
    async (format) => {
      const output = Buffer.from(
        await resizeImage(fixtures[format], limits, signal(), fixture.worker),
      )
      expect(readImageInfo(output)).toEqual({
        mediaType: format === 'png' ? 'image/png' : 'image/jpeg',
        width: 80,
        height: 40,
      })
      const decoded = format === 'png' ? PNG.sync.read(output) : jpeg.decode(output)
      expect(decoded.data.length).toBe(80 * 40 * 4)
      // The original upper-left colour survives decoding, resampling and re-encoding.
      expect(decoded.data[2]).toBeGreaterThan(100)
      expect(decoded.data[3]).toBe(255)
    },
  )
  it('obeys the height bound and never upscales or changes in-limit bytes', async () => {
    const output = await resizeImage(
      fixtures.png,
      { maxWidth: 300, maxHeight: 20 },
      signal(),
      fixture.worker,
    )
    expect(readImageInfo(output)).toMatchObject({ width: 40, height: 20 })
    expect(
      await resizeImage(fixtures.jpeg, { maxWidth: 640, maxHeight: 480 }, signal(), fixture.worker),
    ).toBe(fixtures.jpeg)
  })
  it('refuses invalid limits, oversized input, a forged pixel bomb and corrupt raster', async () => {
    await expect(
      resizeImage(fixtures.png, { maxWidth: 0, maxHeight: 1 }, signal(), fixture.worker),
    ).rejects.toThrow()
    await expect(
      resizeImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), limits, signal(), fixture.worker),
    ).rejects.toThrow('invalid_input')
    const bomb = Buffer.from(fixtures.png)
    bomb.writeUInt32BE(IMAGE_RESIZE_MAX_PIXELS, 16)
    await expect(resizeImage(bomb, limits, signal(), fixture.worker)).rejects.toThrow(
      'image_resize_failed',
    )
    await expect(
      resizeImage(fixtures.png.subarray(0, 40), limits, signal(), fixture.worker),
    ).rejects.toThrow('image_resize_failed')
  })
  it('refuses a valid raster over the pixel bound and an in-limit image over the byte bound', async () => {
    const large = await readFile('test/fixtures/image-resize/pixel-limit.png')
    await expect(resizeImage(large, limits, signal(), fixture.worker)).rejects.toThrow(
      'image_resize_failed',
    )
    const oversized = Buffer.concat([fixtures.png, Buffer.alloc(MAX_IMAGE_BYTES)])
    await expect(
      resizeImage(oversized, { maxWidth: 640, maxHeight: 480 }, signal(), fixture.worker),
    ).rejects.toThrow('invalid_input')
  })
  it('refuses a corrupt PNG checksum', async () => {
    const corrupted = Buffer.from(fixtures.png)
    corrupted[29] = (corrupted[29] ?? 0) ^ 1
    await expect(resizeImage(corrupted, limits, signal(), fixture.worker)).rejects.toThrow(
      'image_resize_failed',
    )
  })
  it('refuses unsupported oversized GIFs instead of sending an unchanged oversize image', async () => {
    const gif = Buffer.alloc(10)
    gif.write('GIF89a')
    gif.writeUInt16LE(320, 6)
    gif.writeUInt16LE(160, 8)
    await expect(resizeImage(gif, limits, signal(), fixture.worker)).rejects.toThrow(
      'image_resize_failed',
    )
  })
  it('terminates an unresponsive worker at the fixed deadline and releases the queue', async () => {
    const held = path.join(fixture.folder, 'held.cjs')
    await writeFile(held, 'setInterval(() => {}, 1000)')
    vi.useFakeTimers()
    try {
      const pending = resizeImage(fixtures.png, limits, signal(), held)
      const rejected = expect(pending).rejects.toThrow('image_resize_failed')
      await vi.advanceTimersByTimeAsync(IMAGE_RESIZE_TIMEOUT_MS)
      await rejected
    } finally {
      vi.useRealTimers()
    }
    expect(
      readImageInfo(await resizeImage(fixtures.png, limits, signal(), fixture.worker)),
    ).toMatchObject({
      width: 80,
    })
  })
  it('stops a running or queued conversion and releases its slot', async () => {
    const held = path.join(fixture.folder, 'abort.cjs')
    await writeFile(held, 'setInterval(() => {}, 1000)')
    const first = new AbortController()
    const second = new AbortController()
    const active = resizeImage(fixtures.png, limits, first.signal, held)
    const queued = resizeImage(fixtures.png, limits, second.signal, fixture.worker)
    const settled = Promise.allSettled([active, queued])
    first.abort()
    second.abort()
    const outcomes = await settled
    expect(outcomes.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(
      readImageInfo(await resizeImage(fixtures.png, limits, signal(), fixture.worker)),
    ).toMatchObject({
      height: 40,
    })
  })
  it('bounds queued conversions and releases aborted slots', async () => {
    const held = path.join(fixture.folder, 'queue.cjs')
    await writeFile(held, 'setInterval(() => {}, 1000)')
    const control = new AbortController()
    const jobs = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, () =>
      resizeImage(fixtures.png, limits, control.signal, held),
    )
    const settled = Promise.allSettled(jobs)
    try {
      await expect(resizeImage(fixtures.png, limits, signal(), held)).rejects.toThrow('queue_full')
    } finally {
      control.abort()
      await settled
    }
  })
  it('rejects malformed worker answers and output that breaks model bounds', async () => {
    for (const answer of [
      '{ok:true,bytes:"bad"}',
      `{ok:true,bytes:require('node:worker_threads').workerData.bytes}`,
    ]) {
      const invalid = path.join(fixture.folder, 'invalid.cjs')
      await writeFile(invalid, `require('node:worker_threads').parentPort.postMessage(${answer})`)
      await expect(resizeImage(fixtures.png, limits, signal(), invalid)).rejects.toThrow(
        'image_resize_failed',
      )
    }
  })
})
