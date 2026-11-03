// M111 lane AR (D91.30): the companion's derived strips, built from the 1x
// strips in design/companion/anim/ and their manifest.json. The raw
// generation sheets stay outside the repository (design/companion/README.md),
// so the 2x set is a Keys-bicubic upscale of the 1x strips (premultiplied,
// separable, clamp edges; arithmetic only, so it is bit-deterministic on
// every platform — no Math.sin anywhere, whose last ulp varies). The
// high-contrast set keeps the paint and adds a double outline (white inner,
// black outer, 2 px each at 1x and 4 px at 2x) from a 3-4 chamfer distance
// transform of the opaque silhouette, so the character reads on any bar.
// The still set is one frame per animation: the median-area frame of loops,
// the peak-area frame of one-shots. variants.json names every file with
// its still frame and rule, the README's display scale, and the WCAG 2.3.1
// flash measurement at manifest fps (large-change pairs, luminance
// reversals as the flash rate, W3C-style red pairs, display-scaled area
// against the general-flash threshold, and the verdict). Lane PE consumes
// variants.json.
//
// Freshness compares decoded pixels exactly, not bytes: the art math is
// deterministic, but PNG deflate bytes vary with the zlib build, and the
// check must hold on every CI platform.
//
//   node scripts/build-companion-art.mjs          regenerate every file
//   node scripts/build-companion-art.mjs --check  exit 1 naming stale files
//
// Design record: docs/certification/rlf-m111ar.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import { PNG } from 'pngjs'
import { isEntryPoint } from './lib/entryPoint.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const COMPANION_ANIM = 'design/companion/anim'
export const COMPANION_MANIFEST = 'design/companion/anim/manifest.json'
export const COMPANION_2X = 'design/companion/anim-2x'
export const COMPANION_HC = 'design/companion/anim-hc'
export const COMPANION_HC_2X = 'design/companion/anim-hc-2x'
export const COMPANION_STILL = 'design/companion/anim-still'
export const COMPANION_STILL_2X = 'design/companion/anim-still-2x'
export const COMPANION_VARIANTS = 'design/companion/anim/variants.json'
// The per-animation display scales from design/companion/README.md (ear
// tuft span against walk; the rest 1): lane PE bakes or keeps them so the
// character is one size on screen.
export const COMPANION_DISPLAY_SCALES = {
  walk: 1,
  idle: 1,
  peek: 0.46,
  talk: 0.83,
  wave: 0.8,
  think: 0.83,
  hop: 0.93,
  sleep: 0.71,
  charge: 1.17,
  alert: 0.72,
  turn: 1,
  beam: 1,
}
const OUTLINE_INNER_1X = 2
const OUTLINE_OUTER_1X = 2
const OUTLINE_SCALE = 2
const FLASH_LUMA_DELTA = 20
const FLASH_AREA_FRACTION = 0.25
// WCAG 2.3.1's general-flash area threshold, against a 160 px tall display.
const FLASH_DISPLAY_HEIGHT = 160
const FLASH_AREA_THRESHOLD = 341 * 256

function fail(message) {
  throw new Error(`build-companion-art: ${message}`)
}

/** The manifest entry for one animation, validated against its strip. */
export function companionEntry(manifest, name, strip) {
  const entry = manifest?.[name]
  if (entry === undefined || entry === null || typeof entry !== 'object') {
    fail(`manifest has no ${name} animation`)
  }
  for (const key of ['frames', 'w', 'h', 'fps']) {
    if (!Number.isSafeInteger(entry[key]) || entry[key] <= 0) {
      fail(`${name}.${key} is not a positive int`)
    }
  }
  if (typeof entry.loop !== 'boolean') fail(`${name}.loop is not a boolean`)
  if (strip.width !== entry.frames * entry.w || strip.height !== entry.h) {
    fail(`${name}.png is ${strip.width}x${strip.height}, not ${entry.frames * entry.w}x${entry.h}`)
  }
  return { frames: entry.frames, w: entry.w, h: entry.h, fps: entry.fps, loop: entry.loop }
}

// Keys' bicubic with a = -1/2, the resampling kernel. Piecewise cubics in
// |x| only: no transcendentals, bit-deterministic everywhere.
function keysKernel(distance) {
  const x = Math.abs(distance)
  if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1
  return x <= 2 ? -0.5 * (x * x * x - 5 * x * x + 8 * x - 4) : 0
}

/** One premultiplied row resampled 2x with the Keys kernel, clamped edges. */
function resampleRowPremultiplied(values, outWidth) {
  const inWidth = values.length / 4
  const out = new Float64Array(outWidth * 4)
  for (let o = 0; o < outWidth; o += 1) {
    const center = (o + 0.5) / 2 - 0.5
    const first = Math.floor(center) - 1
    for (let tap = 0; tap < 4; tap += 1) {
      const clamped = Math.min(inWidth - 1, Math.max(0, first + tap))
      const weight = keysKernel(center - (first + tap))
      for (let band = 0; band < 4; band += 1) {
        out[o * 4 + band] += values[clamped * 4 + band] * weight
      }
    }
  }
  return out
}

/** A strip resampled to twice its size, premultiplied so keyed edges stay clean. */
export function upscaleStrip2x(strip) {
  const { width, height, data } = strip
  const premultiplied = new Float64Array(data.length)
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3] / 255
    premultiplied[at] = data[at] * alpha
    premultiplied[at + 1] = data[at + 1] * alpha
    premultiplied[at + 2] = data[at + 2] * alpha
    premultiplied[at + 3] = data[at + 3]
  }
  const wide = new Float64Array(width * 2 * height * 4)
  for (let y = 0; y < height; y += 1) {
    const row = resampleRowPremultiplied(
      premultiplied.subarray(y * width * 4, (y + 1) * width * 4),
      width * 2,
    )
    wide.set(row, y * width * 2 * 4)
  }
  const out = Buffer.alloc(width * 2 * height * 2 * 4)
  const column = new Float64Array(height * 4)
  const tall = new Float64Array(height * 2 * 4)
  for (let x = 0; x < width * 2; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let band = 0; band < 4; band += 1) {
        column[y * 4 + band] = wide[(y * width * 2 + x) * 4 + band]
      }
    }
    const stretched = resampleRowPremultiplied(column, height * 2)
    tall.set(stretched)
    for (let y = 0; y < height * 2; y += 1) {
      const alpha = Math.min(255, Math.max(0, Math.round(tall[y * 4 + 3])))
      const at = (y * width * 2 + x) * 4
      out[at + 3] = alpha
      const unscale = alpha === 0 ? 0 : 255 / alpha
      for (let band = 0; band < 3; band += 1) {
        out[at + band] =
          alpha === 0 ? 0 : Math.min(255, Math.max(0, Math.round(tall[y * 4 + band] * unscale)))
      }
    }
  }
  return { width: width * 2, height: height * 2, data: out }
}

// The 3-4 chamfer distance of every pixel from the opaque silhouette, in
// units of 3 per orthogonal step. Integer math, deterministic.
function chamferDistances(strip) {
  const { width, height, data } = strip
  const far = width * height * 8
  const distances = new Int32Array(width * height).fill(far)
  for (let at = 0; at < width * height; at += 1) {
    if (data[at * 4 + 3] > 0) distances[at] = 0
  }
  const relax = (at, neighbour, cost) => {
    const candidate = distances[neighbour] + cost
    if (candidate < distances[at]) distances[at] = candidate
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x
      if (x > 0) relax(at, at - 1, 3)
      if (!(y > 0)) {
        continue
      }

      relax(at, at - width, 3)
      if (x > 0) relax(at, at - width - 1, 4)
      if (x < width - 1) relax(at, at - width + 1, 4)
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const at = y * width + x
      if (x < width - 1) relax(at, at + 1, 3)
      if (!(y < height - 1)) {
        continue
      }

      relax(at, at + width, 3)
      if (x < width - 1) relax(at, at + width + 1, 4)
      if (x > 0) relax(at, at + width - 1, 4)
    }
  }
  return distances
}

/**
The high-contrast variant: the paint untouched, a white ring then a black
ring around the silhouette. Radii are outline pixels at the strip's own
scale (2 and 2 at 1x, 4 and 4 at 2x).
*/
export function outlineStrip(strip, inner, outer) {
  const { width, height, data } = strip
  const distances = chamferDistances(strip)
  const out = Buffer.from(data)
  const innerEdge = 3 * inner
  const outerEdge = 3 * (inner + outer)
  for (let at = 0; at < width * height; at += 1) {
    if (distances[at] === 0 || distances[at] > outerEdge) continue
    const ring = distances[at] <= innerEdge ? 255 : 0
    out[at * 4] = ring
    out[at * 4 + 1] = ring
    out[at * 4 + 2] = ring
    out[at * 4 + 3] = 255
  }
  return { width, height, data: out }
}

/** Opaque-pixel counts per frame, left to right. */
export function frameOpaqueCounts(strip, frames, w, h) {
  const counts = []
  for (let frame = 0; frame < frames; frame += 1) {
    let opaque = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (strip.data[(y * strip.width + frame * w + x) * 4 + 3] > 0) opaque += 1
      }
    }
    counts.push(opaque)
  }
  return counts
}

/**
The still frame: the median-area frame of a loop, the peak-area frame of
a one-shot. Ties keep the earliest frame.
*/
export function selectStillFrame(counts, loop) {
  const ranked = counts
    .map((count, frame) => [count, frame])
    .toSorted((left, right) => left[0] - right[0] || left[1] - right[1])
  return loop ? ranked[Math.floor(ranked.length / 2)][1] : ranked.at(-1)[1]
}

/** One frame cropped out of its strip. */
export function cropFrame(strip, frame, w, h) {
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const from = (y * strip.width + frame * w + x) * 4
      const to = (y * w + x) * 4
      out[to] = strip.data[from]
      out[to + 1] = strip.data[from + 1]
      out[to + 2] = strip.data[from + 2]
      out[to + 3] = strip.data[from + 3]
    }
  }
  return { width: w, height: h, data: out }
}

function relativeLuminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
The WCAG 2.3.1 flash measurement at manifest fps. Consecutive frame pairs
(wrapping for loops) whose union silhouette shifts luminance by 20+ over
a quarter or more of its pixels count as transitions (motion intensity).
A reversal is a transition whose mean-luminance step flips sign against
the previous pair's by 5 or more: the oscillation shape a flash has and
plain motion does not. The flash rate is reversals per play second; a red
pair is a transition where a tenth or more of the changed pixels are
saturated red (R/(R+G+B) >= 0.8) in their brighter state, per the W3C's
red-flash definition. Compliant means the rate is at most three, or the
largest changed area scaled to a 160 px tall display sits under the
general-flash area threshold with no red pairs.
*/
export function flashMeasurement(strip, { frames, w, h, fps, loop }) {
  const pairs = []
  for (let frame = 0; frame < frames - 1; frame += 1) pairs.push([frame, frame + 1])
  if (loop) pairs.push([frames - 1, 0])
  let transitions = 0
  let reversals = 0
  let redPairs = 0
  let maxChanged = 0
  let previousStep = 0
  for (const [first, second] of pairs) {
    let union = 0
    let changed = 0
    let redChanged = 0
    let beforeSum = 0
    let afterSum = 0
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const left = (y * strip.width + first * w + x) * 4
        const right = (y * strip.width + second * w + x) * 4
        if (strip.data[left + 3] === 0 && strip.data[right + 3] === 0) continue
        union += 1
        const before = relativeLuminance(
          strip.data[left],
          strip.data[left + 1],
          strip.data[left + 2],
        )
        const after = relativeLuminance(
          strip.data[right],
          strip.data[right + 1],
          strip.data[right + 2],
        )
        beforeSum += before
        afterSum += after
        if (Math.abs(after - before) < FLASH_LUMA_DELTA) continue
        changed += 1
        const brighter = after >= before ? right : left
        const total = strip.data[brighter] + strip.data[brighter + 1] + strip.data[brighter + 2]
        if (total > 0 && strip.data[brighter] / total >= 0.8) redChanged += 1
      }
    }
    const meanStep = union === 0 ? 0 : (afterSum - beforeSum) / union
    if (union > 0 && changed / union >= FLASH_AREA_FRACTION) {
      transitions += 1
      if (
        Math.sign(meanStep) !== 0 &&
        Math.sign(meanStep) !== Math.sign(previousStep) &&
        Math.abs(meanStep) >= 5 &&
        Math.abs(previousStep) >= 5
      )
        reversals += 1
      if (changed > 0 && redChanged / changed >= 0.1) redPairs += 1
    }
    previousStep = meanStep
    maxChanged = Math.max(maxChanged, changed)
  }
  const scale = FLASH_DISPLAY_HEIGHT / h
  const maxDisplayArea = Math.round(maxChanged * scale * scale)
  const flashesPerSecond = (reversals * fps) / frames
  return {
    transitions,
    reversals,
    flashesPerSecond,
    maxDisplayArea,
    areaThreshold: FLASH_AREA_THRESHOLD,
    redPairs,
    compliant: flashesPerSecond <= 3 || (maxDisplayArea < FLASH_AREA_THRESHOLD && redPairs === 0),
  }
}

function encodePng(strip) {
  const png = new PNG({ width: strip.width, height: strip.height })
  png.data = Buffer.from(strip.data)
  return PNG.sync.write(png)
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: Buffer.from(png.data) }
}

// The PNG signature plus a 13-byte IHDR, checked without decoding.
function isPng(buffer) {
  return (
    buffer.length >= 24 &&
    buffer[0] === 137 &&
    buffer[1] === 80 &&
    buffer[2] === 78 &&
    buffer[3] === 71 &&
    buffer[4] === 13 &&
    buffer[5] === 10 &&
    buffer[6] === 26 &&
    buffer[7] === 10 &&
    buffer.readUInt32BE(8) === 13 &&
    buffer.subarray(12, 16).toString('ascii') === 'IHDR'
  )
}

/** Every derived file: the 2x, HC, HC-2x and still sets plus variants.json. */
export function renderCompanionArt({ manifest, strips }) {
  const outputs = new Map()
  const animations = {}
  const names = Object.keys(manifest).toSorted(compareStrings)
  for (const name of names) {
    const bytes = strips.get(name)
    if (bytes === undefined) fail(`missing strip ${name}.png`)
    const strip = decodePng(bytes)
    const entry = companionEntry(manifest, name, strip)
    const doubled = upscaleStrip2x(strip)
    const counts = frameOpaqueCounts(strip, entry.frames, entry.w, entry.h)
    const stillFrame = selectStillFrame(counts, entry.loop)
    outputs.set(`${COMPANION_2X}/${name}.png`, encodePng(doubled))
    outputs.set(
      `${COMPANION_HC}/${name}.png`,
      encodePng(outlineStrip(strip, OUTLINE_INNER_1X, OUTLINE_OUTER_1X)),
    )
    outputs.set(
      `${COMPANION_HC_2X}/${name}.png`,
      encodePng(
        outlineStrip(doubled, OUTLINE_INNER_1X * OUTLINE_SCALE, OUTLINE_OUTER_1X * OUTLINE_SCALE),
      ),
    )
    outputs.set(
      `${COMPANION_STILL}/${name}.png`,
      encodePng(cropFrame(strip, stillFrame, entry.w, entry.h)),
    )
    outputs.set(
      `${COMPANION_STILL_2X}/${name}.png`,
      encodePng(cropFrame(doubled, stillFrame, entry.w * 2, entry.h * 2)),
    )
    const displayScale = COMPANION_DISPLAY_SCALES[name]
    if (displayScale === undefined) fail(`no display scale for ${name}`)
    animations[name] = {
      strip: `${COMPANION_ANIM}/${name}.png`,
      strip2x: `${COMPANION_2X}/${name}.png`,
      hc: `${COMPANION_HC}/${name}.png`,
      hc2x: `${COMPANION_HC_2X}/${name}.png`,
      still: `${COMPANION_STILL}/${name}.png`,
      still2x: `${COMPANION_STILL_2X}/${name}.png`,
      stillFrame,
      stillRule: entry.loop ? 'median-area frame of the loop' : 'peak-area frame of the one-shot',
      displayScale,
      flash: flashMeasurement(strip, entry),
    }
  }
  outputs.set(
    COMPANION_VARIANTS,
    Buffer.from(
      `${JSON.stringify({ version: 1, generatedBy: 'scripts/build-companion-art.mjs', animations }, null, 2)}\n`,
      'utf8',
    ),
  )
  return outputs
}

async function readInputs(root) {
  const manifest = JSON.parse(await readFile(path.join(root, COMPANION_MANIFEST), 'utf8'))
  const strips = new Map()
  const names = Object.keys(manifest).toSorted(compareStrings)
  for (const name of names) {
    strips.set(name, await readFile(path.join(root, COMPANION_ANIM, `${name}.png`)))
  }
  return { manifest, strips }
}

export async function writeCompanionArt(root, outputs) {
  for (const [name, data] of outputs) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function toPosix(relative) {
  return relative.split(path.sep).join(path.posix.sep)
}

/**
Repo-relative posix paths whose committed content differs from a fresh
render. PNGs compare decoded pixels exactly (deflate bytes vary with the
zlib build); the manifest compares bytes.
*/
export async function staleCompanionArt(root, outputs) {
  const stale = []
  for (const [name, data] of outputs) {
    let committed
    try {
      committed = await readFile(path.join(root, name))
    } catch (error) {
      // NARROW: only a missing output counts as stale; anything else is real.
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
      stale.push(name)
      continue
    }
    if (name.endsWith('.json')) {
      if (!committed.equals(data)) stale.push(name)
      continue
    }
    if (committed.equals(data)) continue
    // Bytes differ: pixel-compare, but only when the committed file is
    // still a PNG. Anything else is stale without decoding; a file with a
    // valid header that fails deeper throws loudly, as a real error should.
    if (!isPng(committed)) {
      stale.push(name)
      continue
    }
    const fresh = decodePng(data)
    const saved = decodePng(committed)
    if (
      fresh.width !== saved.width ||
      fresh.height !== saved.height ||
      !fresh.data.equals(saved.data)
    ) {
      stale.push(name)
    }
  }
  return stale.toSorted(compareStrings).map((name) => toPosix(name))
}

async function main() {
  const check = process.argv.includes('--check')
  const inputs = await readInputs(REPO_ROOT)
  const outputs = renderCompanionArt(inputs)
  if (!check) {
    await writeCompanionArt(REPO_ROOT, outputs)
    process.stdout.write(`companion-art: wrote ${String(outputs.size)} files\n`)
    return
  }
  const stale = await staleCompanionArt(REPO_ROOT, outputs)
  if (stale.length > 0) {
    process.stdout.write(
      `companion-art: stale output:\n${stale.map((name) => `  ${name}\n`).join('')}`,
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(`companion-art: ${String(outputs.size)} outputs fresh\n`)
}

if (isEntryPoint(import.meta.url)) {
  await main()
}
