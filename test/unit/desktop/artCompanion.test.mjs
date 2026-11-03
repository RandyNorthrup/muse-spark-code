// M111 AR companion art: variants.json covers the manifest's twelve
// animations with files that exist at the right sizes; the 2x set doubles
// the strips and round-trips the paint; the HC set keeps every source pixel
// and adds only pure black and white rings; the stills are their recorded
// frames; the flash numbers match a fresh measurement and every animation
// is compliant; and the freshness check fires on a planted stale file (on
// a fixture, never the repo).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import {
  COMPANION_2X,
  COMPANION_ANIM,
  COMPANION_DISPLAY_SCALES,
  COMPANION_HC,
  COMPANION_MANIFEST,
  COMPANION_STILL,
  COMPANION_STILL_2X,
  COMPANION_VARIANTS,
  companionEntry,
  cropFrame,
  flashMeasurement,
  frameOpaqueCounts,
  outlineStrip,
  selectStillFrame,
  staleCompanionArt,
  upscaleStrip2x,
  writeCompanionArt,
} from '../../../scripts/build-companion-art.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readRoot = (name) => readFile(path.join(root, name))
const manifest = JSON.parse(await readFile(path.join(root, COMPANION_MANIFEST), 'utf8'))
const variants = JSON.parse(await readFile(path.join(root, COMPANION_VARIANTS), 'utf8'))
const names = Object.keys(manifest).toSorted(compareStrings)
const strips = new Map()
for (const name of names) {
  strips.set(name, PNG.sync.read(await readRoot(`${COMPANION_ANIM}/${name}.png`)))
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})

// PNG dimensions from the IHDR alone: the 8-byte signature, a 13-byte IHDR,
// then big-endian width and height. Full decodes stay where pixels matter.
function pngSize(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  expect(buffer.subarray(0, 8).equals(signature)).toBe(true)
  expect(buffer.readUInt32BE(8)).toBe(13)
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

function opaqueCount(png) {
  let opaque = 0
  for (let at = 3; at < png.data.length; at += 4) {
    if (png.data[at] > 0) opaque += 1
  }
  return opaque
}

describe('companion variants', () => {
  it('covers the manifest twelve with files at the right sizes', async () => {
    expect(names).toHaveLength(12)
    expect(variants.version).toBe(1)
    expect(Object.keys(variants.animations).toSorted(compareStrings)).toEqual(names)
    for (const name of names) {
      const entry = manifest[name]
      const variant = variants.animations[name]
      expect(variant.displayScale).toBe(COMPANION_DISPLAY_SCALES[name])
      expect(variant.stillFrame).toBeLessThan(entry.frames)
      expect(variant.stillRule).toBe(
        entry.loop ? 'median-area frame of the loop' : 'peak-area frame of the one-shot',
      )
      const files = [
        [variant.strip2x, entry.frames * entry.w * 2, entry.h * 2],
        [variant.hc, entry.frames * entry.w, entry.h],
        [variant.hc2x, entry.frames * entry.w * 2, entry.h * 2],
        [variant.still, entry.w, entry.h],
        [variant.still2x, entry.w * 2, entry.h * 2],
      ]
      for (const [file, width, height] of files) {
        expect(pngSize(await readRoot(file))).toEqual([width, height])
      }
    }
  })

  it('doubles the strips and round-trips the paint', async () => {
    for (const name of ['walk', 'beam']) {
      const one = strips.get(name)
      const two = PNG.sync.read(await readRoot(`${COMPANION_2X}/${name}.png`))
      expect([two.width, two.height]).toEqual([one.width * 2, one.height * 2])
      let absolute = 0
      let samples = 0
      for (let y = 0; y < one.height; y += 4) {
        for (let x = 0; x < one.width; x += 4) {
          for (let band = 0; band < 4; band += 1) {
            const mean =
              (two.data[(2 * y * two.width + 2 * x) * 4 + band] +
                two.data[(2 * y * two.width + 2 * x + 1) * 4 + band] +
                two.data[((2 * y + 1) * two.width + 2 * x) * 4 + band] +
                two.data[((2 * y + 1) * two.width + 2 * x + 1) * 4 + band]) /
              4
            absolute += Math.abs(mean - one.data[(y * one.width + x) * 4 + band])
            samples += 1
          }
        }
      }
      expect(absolute / samples).toBeLessThan(2)
    }
  })

  it('upscales one strip exactly as committed', async () => {
    const one = strips.get('think')
    const fresh = upscaleStrip2x({
      width: one.width,
      height: one.height,
      data: Buffer.from(one.data),
    })
    const committed = PNG.sync.read(await readRoot(`${COMPANION_2X}/think.png`))
    expect([fresh.width, fresh.height]).toEqual([committed.width, committed.height])
    expect(fresh.data.equals(Buffer.from(committed.data))).toBe(true)
  })

  it('keeps the paint and adds only black and white rings', async () => {
    for (const name of names) {
      const one = strips.get(name)
      const hc = PNG.sync.read(await readRoot(`${COMPANION_HC}/${name}.png`))
      expect([hc.width, hc.height]).toEqual([one.width, one.height])
      expect(opaqueCount(hc)).toBeGreaterThan(opaqueCount(one))
      for (let at = 0; at < one.data.length; at += 4) {
        const isSame =
          hc.data[at] === one.data[at] &&
          hc.data[at + 1] === one.data[at + 1] &&
          hc.data[at + 2] === one.data[at + 2] &&
          hc.data[at + 3] === one.data[at + 3]
        if (isSame) continue
        const isWhite =
          hc.data[at] === 255 &&
          hc.data[at + 1] === 255 &&
          hc.data[at + 2] === 255 &&
          hc.data[at + 3] === 255
        const isBlack =
          hc.data[at] === 0 &&
          hc.data[at + 1] === 0 &&
          hc.data[at + 2] === 0 &&
          hc.data[at + 3] === 255
        expect(isWhite || isBlack, `${name} paints only rings`).toBe(true)
      }
    }
  })

  it('outlines one strip exactly as committed', async () => {
    const one = strips.get('think')
    const fresh = outlineStrip(
      { width: one.width, height: one.height, data: Buffer.from(one.data) },
      2,
      2,
    )
    const committed = PNG.sync.read(await readRoot(`${COMPANION_HC}/think.png`))
    expect(fresh.data.equals(Buffer.from(committed.data))).toBe(true)
    let white = 0
    let black = 0
    for (let at = 0; at < one.data.length; at += 4) {
      if (fresh.data[at + 3] === one.data[at + 3] && fresh.data[at] === one.data[at]) continue
      if (fresh.data[at] === 255 && fresh.data[at + 3] === 255) white += 1
      else if (fresh.data[at] === 0 && fresh.data[at + 3] === 255) black += 1
    }
    expect(white).toBeGreaterThan(0)
    expect(black).toBeGreaterThan(0)
  })

  it('stills are their recorded frames at both scales', async () => {
    for (const name of names) {
      const entry = manifest[name]
      const frame = variants.animations[name].stillFrame
      const one = strips.get(name)
      const still = PNG.sync.read(await readRoot(`${COMPANION_STILL}/${name}.png`))
      const expected = cropFrame(
        { width: one.width, height: one.height, data: Buffer.from(one.data) },
        frame,
        entry.w,
        entry.h,
      )
      expect(Buffer.from(still.data).equals(expected.data)).toBe(true)
      const two = PNG.sync.read(await readRoot(`${COMPANION_2X}/${name}.png`))
      const still2x = PNG.sync.read(await readRoot(`${COMPANION_STILL_2X}/${name}.png`))
      const expected2x = cropFrame(
        { width: two.width, height: two.height, data: Buffer.from(two.data) },
        frame,
        entry.w * 2,
        entry.h * 2,
      )
      expect(Buffer.from(still2x.data).equals(expected2x.data)).toBe(true)
    }
  })

  it('records the median loop frame and the peak one-shot frame', () => {
    for (const name of names) {
      const entry = manifest[name]
      const one = strips.get(name)
      const counts = frameOpaqueCounts(
        { width: one.width, height: one.height, data: Buffer.from(one.data) },
        entry.frames,
        entry.w,
        entry.h,
      )
      expect(selectStillFrame(counts, entry.loop)).toBe(variants.animations[name].stillFrame)
    }
  })

  it('flash numbers match a fresh measurement, first half', () => {
    for (const name of names.slice(0, 6)) {
      const entry = companionEntry(manifest, name, strips.get(name))
      const one = strips.get(name)
      expect(
        flashMeasurement(
          { width: one.width, height: one.height, data: Buffer.from(one.data) },
          entry,
        ),
      ).toEqual(variants.animations[name].flash)
    }
  })

  it('flash numbers match a fresh measurement, second half', () => {
    for (const name of names.slice(6)) {
      const entry = companionEntry(manifest, name, strips.get(name))
      const one = strips.get(name)
      expect(
        flashMeasurement(
          { width: one.width, height: one.height, data: Buffer.from(one.data) },
          entry,
        ),
      ).toEqual(variants.animations[name].flash)
    }
  })

  it('every animation is flash-compliant', () => {
    for (const name of names) {
      const flash = variants.animations[name].flash
      expect(flash.flashesPerSecond).toBeLessThanOrEqual(3)
      expect(flash.compliant).toBe(true)
    }
  })

  it('rejects a bad manifest', () => {
    const one = strips.get('walk')
    const strip = { width: one.width, height: one.height, data: Buffer.from(one.data) }
    expect(() => companionEntry(manifest, 'swim', strip)).toThrow('no swim animation')
    expect(() => companionEntry({ walk: { ...manifest.walk, w: 1 } }, 'walk', strip)).toThrow(
      'not 8x240',
    )
  })

  it('finds a planted stale file and only that file', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'companion-art-'))
    fixtures.push(folder)
    const one = strips.get('walk')
    const entry = manifest.walk
    const still = cropFrame(
      { width: one.width, height: one.height, data: Buffer.from(one.data) },
      0,
      entry.w,
      entry.h,
    )
    const png = new PNG({ width: still.width, height: still.height })
    png.data = Buffer.from(still.data)
    const outputs = new Map([[`${COMPANION_STILL}/walk.png`, PNG.sync.write(png)]])
    await writeCompanionArt(folder, outputs)
    expect(await staleCompanionArt(folder, outputs)).toEqual([])
    const [victim] = outputs.keys()
    await writeFile(path.join(folder, victim), Buffer.from('stale'))
    expect(await staleCompanionArt(folder, outputs)).toEqual([victim])
  })
})
