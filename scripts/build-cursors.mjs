// M111 lane AR (D91.11): the pointer themes, built from the SVG sources in
// design/art/cursors/src/ and TH's pointer palette
// (desktop/shell/theme/pointer.json). Three themes, each in hyprcursor and
// Xcursor form: Muse (dark accent), Muse-Large (strokes x1.5, same geometry
// and hotspots) and Muse-HighContrast (pure black/white, strokes x2).
// Every element is an outline+fill pair, so one theme reads on light and
// dark alike. Xcursor carries 24/32/48/64/96 px per shape; hyprcursor is
// SVG with compiled .hlc zips (fixed timestamps, stored, UTF-8 names, meta
// + images at the root, mirroring hyprcursor-util 0.1.13's --create).
// `wait` and `progress` animate (8 frames, 80 ms).
//
//   node scripts/build-cursors.mjs          regenerate every theme file
//   node scripts/build-cursors.mjs --check  exit 1 naming stale files
//
// Design record: docs/certification/rlf-m111ar.md.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import { PNG } from 'pngjs'
import { Resvg } from '@resvg/resvg-js'
import { isEntryPoint } from './lib/entryPoint.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const CURSOR_SPEC = 'design/art/cursors/cursors.json'
export const CURSOR_SOURCES = 'design/art/cursors/src'
export const CURSOR_POINTER = 'desktop/shell/theme/pointer.json'
export const CURSOR_THEMES = [
  {
    dir: 'Muse',
    name: 'Muse',
    pointerMode: 'dark',
    strokeScale: 1,
    comment: 'Muse Desktop: the default pointer theme (D91.11).',
  },
  {
    dir: 'Muse-Large',
    name: 'Muse-Large',
    pointerMode: 'dark',
    strokeScale: 1.5,
    comment: 'Muse Desktop: thicker strokes at the same sizes (D91.11).',
  },
  {
    dir: 'Muse-HighContrast',
    name: 'Muse-HighContrast',
    pointerMode: 'hc-dark',
    strokeScale: 2,
    comment: 'Muse Desktop: pure black and white, doubled strokes (D91.11).',
  },
]
export const CURSOR_GRID = 32
const HEX = /^#[0-9a-f]{6}$/
const STROKE_WIDTH = /stroke-width="(\d+(?:\.\d+)?)"/g
// A rotor group (`<g id="rotor">...</g>`) is frame 0; the build rotates
// copies of its whole body for the other frames. Non-greedy to the first
// closing tag: sources keep exactly one rotor group each.
const ROTOR_GROUP = /<g id="rotor">([\s\S]*?)<\/g>/

function fail(message) {
  throw new Error(`build-cursors: ${message}`)
}

function hex(value, what) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(`${what} is not a #rrggbb colour`)
  return value
}

/** The theme palette from TH's pointer.json, validated; no colour is invented here. */
export function cursorPalette(pointer, mode) {
  const entry = pointer?.modes?.[mode]
  if (entry === undefined) fail(`pointer.json has no mode ${mode}`)
  return {
    fill: hex(entry.fill?.value, `pointer ${mode} fill`),
    outline: hex(entry.outline?.value, `pointer ${mode} outline`),
    accent: hex(entry.accent?.value, `pointer ${mode} accent`),
  }
}

export function loadSpec(spec) {
  if (spec?.version !== 1) fail('cursors.json: expected version 1')
  const { shapes, hotspots, aliases, sizes, rotors, animation } = spec
  if (!Array.isArray(shapes) || shapes.length === 0) fail('cursors.json: no shapes')
  if (new Set(shapes).size !== shapes.length) fail('cursors.json: a shape is listed twice')
  for (const shape of shapes) {
    const hotspot = hotspots?.[shape]
    if (
      !Array.isArray(hotspot) ||
      hotspot.length !== 2 ||
      hotspot.some((n) => typeof n !== 'number' || n < 0 || n > CURSOR_GRID)
    ) {
      fail(`cursors.json: hotspot of ${shape} is not two 0-32 numbers`)
    }
  }
  const aliasEntries = Object.entries(aliases ?? {})
  for (const [alias, target] of aliasEntries) {
    if (!shapes.includes(target)) fail(`cursors.json: alias ${alias} names no shape`)
    if (shapes.includes(alias)) fail(`cursors.json: alias ${alias} collides with a shape`)
  }
  if (
    !Array.isArray(sizes) ||
    sizes.length === 0 ||
    sizes.some((n) => !Number.isSafeInteger(n) || n <= 0)
  ) {
    fail('cursors.json: sizes are not positive integers')
  }
  const { frames, frameDelayMs } = animation ?? {}
  if (!Number.isSafeInteger(frames) || frames < 2)
    fail('cursors.json: animation.frames is no count')
  if (!Number.isSafeInteger(frameDelayMs) || frameDelayMs <= 0) {
    fail('cursors.json: animation.frameDelayMs is no positive delay')
  }
  const rotorEntries = Object.entries(rotors ?? {})
  for (const [shape, rotor] of rotorEntries) {
    if (!shapes.includes(shape)) fail(`cursors.json: rotor ${shape} is no shape`)
    const [x, y] = rotor?.center ?? []
    if ([x, y].some((n) => typeof n !== 'number' || n < 0 || n > CURSOR_GRID)) {
      fail(`cursors.json: rotor centre of ${shape} is not two 0-32 numbers`)
    }
  }
  return { shapes, hotspots, aliases: aliases ?? {}, sizes, rotors: rotors ?? {}, animation }
}

/**
A source SVG themed for one output: placeholders become the palette, every
stroke-width scales. Sources carry no hex colour and no other sizing, so a
leftover placeholder or an unscaled width fails loudly instead of shipping.
*/
export function themeSvg(source, shape, palette, strokeScale) {
  if (!source.includes('%%')) fail(`${shape}.svg: expected at least one palette placeholder`)
  if (/#[0-9a-f]{6}/i.test(source)) fail(`${shape}.svg: a literal colour slipped into a source`)
  const themed = source
    .replaceAll('%%FILL%%', () => palette.fill)
    .replaceAll('%%OUTLINE%%', () => palette.outline)
    .replaceAll('%%ACCENT%%', () => palette.accent)
    .replaceAll(STROKE_WIDTH, (_, width) => {
      const scaled = Number(width) * strokeScale
      return `stroke-width="${String(Math.round(scaled * 100) / 100)}"`
    })
  if (themed.includes('%%')) fail(`${shape}.svg: an unknown placeholder survived theming`)
  return themed
}

/**
One themed SVG per animation frame: frame 0 keeps the rotor group as drawn,
later frames rotate its body about the rotor centre. Static shapes keep a
single frame under their own name.
*/
export function shapeFrames(svg, shape, rotors, frames) {
  const rotor = rotors[shape]
  if (rotor === undefined) return [{ name: shape, svg }]
  const match = ROTOR_GROUP.exec(svg)
  if (match === null) fail(`${shape}.svg: the spec names a rotor it does not draw`)
  const [x, y] = rotor.center
  return Array.from({ length: frames }, (_, frame) => {
    if (frame === 0) return { name: `${shape}-0`, svg }
    const angle = (frame * 360) / frames
    const rotated = `<g><g transform="rotate(${String(angle)} ${String(x)} ${String(y)})">${match[1]}</g></g>`
    return { name: `${shape}-${frame}`, svg: svg.replace(match[0], () => rotated) }
  })
}

/** Render one themed SVG to RGBA pixels at one size (resvg, pinned). */
export function renderCursor(svg, size) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  const decoded = PNG.sync.read(Buffer.from(png))
  if (decoded.width !== size || decoded.height !== size) {
    fail(`resvg rendered ${String(decoded.width)}x${String(decoded.height)}, not ${String(size)}`)
  }
  return decoded.data
}

// The Xcursor file format, after libXcursor's xcursor.h.in and file.c:
// little-endian u32s, magic + header + TOC, then one image chunk per entry
// (type 0xfffd0002, subtype = nominal size, width/height/hotspot/delay +
// premultiplied ARGB pixels, premultiplied exactly as xcursorgen does).
const XCURSOR_MAGIC = 0x72_75_63_58
const XCURSOR_VERSION = 0x00_01_00_00
const XCURSOR_IMAGE_TYPE = 0xff_fd_00_02
const XCURSOR_IMAGE_VERSION = 1
const U32 = 4

function div255(value) {
  return ((value + 0x80 + ((value + 0x80) >> 8)) >> 8) & 0xff
}

/** One Xcursor file: `images` in file order, each {size, width, height, xhot, yhot, delay, rgba}. */
export function writeXcursor(images) {
  // The header-length field is always 16: libXcursor's own writer sets
  // XCURSOR_FILE_HEADER_LEN, and its reader skips header - 16 before the
  // TOC. Chunks start after the TOC.
  const headerLength = U32 * 4
  const chunksAt = headerLength + images.length * U32 * 3
  const chunks = []
  let position = chunksAt
  for (const image of images) {
    const pixels = image.width * image.height
    if (image.rgba.length !== pixels * 4) fail('an Xcursor image has the wrong byte count')
    const chunk = Buffer.alloc(U32 * 9 + pixels * U32)
    chunk.writeUInt32LE(U32 * 9, 0)
    chunk.writeUInt32LE(XCURSOR_IMAGE_TYPE, U32)
    chunk.writeUInt32LE(image.size, U32 * 2)
    chunk.writeUInt32LE(XCURSOR_IMAGE_VERSION, U32 * 3)
    chunk.writeUInt32LE(image.width, U32 * 4)
    chunk.writeUInt32LE(image.height, U32 * 5)
    chunk.writeUInt32LE(image.xhot, U32 * 6)
    chunk.writeUInt32LE(image.yhot, U32 * 7)
    chunk.writeUInt32LE(image.delay, U32 * 8)
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const alpha = image.rgba[pixel * 4 + 3]
      const word =
        (alpha << 24) |
        (div255(image.rgba[pixel * 4] * alpha) << 16) |
        (div255(image.rgba[pixel * 4 + 1] * alpha) << 8) |
        div255(image.rgba[pixel * 4 + 2] * alpha)
      chunk.writeUInt32LE(word >>> 0, U32 * 9 + pixel * U32)
    }
    chunks.push({ position, chunk })
    position += chunk.length
  }
  const file = Buffer.alloc(position)
  file.writeUInt32LE(XCURSOR_MAGIC, 0)
  file.writeUInt32LE(headerLength, U32)
  file.writeUInt32LE(XCURSOR_VERSION, U32 * 2)
  file.writeUInt32LE(images.length, U32 * 3)
  for (const [index, entry] of chunks.entries()) {
    const base = U32 * 4 + index * U32 * 3
    file.writeUInt32LE(XCURSOR_IMAGE_TYPE, base)
    file.writeUInt32LE(images[index].size, base + U32)
    file.writeUInt32LE(entry.position, base + U32 * 2)
  }
  for (const { position: at, chunk } of chunks) chunk.copy(file, at)
  return file
}

// The smallest deterministic ZIP writer a .hlc needs: stored (uncompressed)
// entries, one fixed DOS timestamp, UTF-8 names, table CRC32.
// Stored on purpose: no deflate stream whose bytes could vary by version.
const ZIP_FIXED_DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1
const ZIP_UTF8_FLAG = 0x08_00

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let byte = 0; byte < 256; byte += 1) {
    let crc = byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xed_b8_83_20 ^ (crc >>> 1) : crc >>> 1
    table[byte] = crc >>> 0
  }
  return table
})()

export function crc32Bytes(data) {
  let crc = 0xff_ff_ff_ff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xff_ff_ff_ff) >>> 0
}

/** `entries` in order, each {name, data}; returns the archive bytes. */
export function writeZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const { name, data } of entries) {
    const filename = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04_03_4b_50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(ZIP_FIXED_DOS_DATE & 0xff_ff, 12)
    header.writeUInt32LE(crc32Bytes(data), 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const entry = Buffer.concat([header, filename, data])
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02_01_4b_50, 0)
    record.writeUInt16LE(0x03_1e, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    record.writeUInt16LE(0, 10)
    record.writeUInt16LE(0, 12)
    record.writeUInt16LE(ZIP_FIXED_DOS_DATE & 0xff_ff, 14)
    record.writeUInt32LE(crc32Bytes(data), 16)
    record.writeUInt32LE(data.length, 20)
    record.writeUInt32LE(data.length, 24)
    record.writeUInt16LE(filename.length, 28)
    record.writeUInt32LE(offset, 42)
    locals.push(entry)
    central.push(Buffer.concat([record, filename]))
    offset += entry.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06_05_4b_50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function fraction(designPx) {
  return Math.round((designPx / CURSOR_GRID) * 1e6) / 1e6
}

/** One shape's hyprcursor meta.hl: hotspot fractions, overrides, sizes. */
export function renderMeta(hotspot, overrides, frames, delayMs) {
  const lines = [
    'resize_algorithm = bilinear',
    `hotspot_x = ${String(fraction(hotspot[0]))}`,
    `hotspot_y = ${String(fraction(hotspot[1]))}`,
  ]
  for (const override of overrides) lines.push(`define_override = ${override}`)
  for (const frame of frames) {
    lines.push(
      frames.length === 1
        ? `define_size = ${String(CURSOR_GRID)}, ${frame}.svg`
        : `define_size = ${String(CURSOR_GRID)}, ${frame}.svg, ${String(delayMs)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export function renderManifest(theme) {
  return [
    `name = ${theme.name}`,
    `description = ${theme.comment}`,
    'version = 1.0',
    'cursors_directory = hyprcursors',
    '',
  ].join('\n')
}

export function renderIndexTheme(theme) {
  return [
    '[Icon Theme]',
    `Name=${theme.name}`,
    `Comment=${theme.comment}`,
    'Inherits=hicolor',
    '',
  ].join('\n')
}

/**
Every theme file in memory: `sources` maps shape to its raw SVG, `spec` is
loadSpec's return, `pointer` the parsed pointer.json. Keys are repo-relative
posix paths, values Buffers (binaries, .hlc, Xcursor) or strings (text).
*/
export function renderCursors({ sources, spec, pointer }) {
  const outputs = new Map()
  for (const theme of CURSOR_THEMES) {
    const palette = cursorPalette(pointer, theme.pointerMode)
    const base = `design/art/cursors/${theme.dir}`
    outputs.set(`${base}/manifest.hl`, renderManifest(theme))
    outputs.set(`${base}/index.theme`, renderIndexTheme(theme))
    const overridesByShape = new Map(spec.shapes.map((shape) => [shape, []]))
    for (const [alias, target] of Object.entries(spec.aliases)) {
      overridesByShape.get(target).push(alias)
    }
    const xcursorFiles = new Map()
    for (const shape of spec.shapes) {
      const source = sources.get(shape)
      if (source === undefined) fail(`no source for shape ${shape}`)
      const themed = themeSvg(source, shape, palette, theme.strokeScale)
      const frames = shapeFrames(themed, shape, spec.rotors, spec.animation.frames)
      const frameNames = frames.map((frame) => frame.name)
      const meta = renderMeta(
        spec.hotspots[shape],
        overridesByShape.get(shape).toSorted(compareStrings),
        frameNames,
        spec.animation.frameDelayMs,
      )
      outputs.set(
        `${base}/hyprcursors/${shape}.hlc`,
        writeZip([
          { name: 'meta.hl', data: Buffer.from(meta, 'utf8') },
          ...frames.map((frame) => ({
            name: `${frame.name}.svg`,
            data: Buffer.from(frame.svg, 'utf8'),
          })),
        ]),
      )
      const [hotX, hotY] = spec.hotspots[shape]
      const images = []
      for (const size of spec.sizes) {
        for (const frame of frames) {
          images.push({
            size,
            width: size,
            height: size,
            xhot: Math.round((hotX / CURSOR_GRID) * size),
            yhot: Math.round((hotY / CURSOR_GRID) * size),
            delay: frames.length === 1 ? 0 : spec.animation.frameDelayMs,
            rgba: renderCursor(frame.svg, size),
          })
        }
      }
      // Built size-major already: one size's frames stay together in the file.
      xcursorFiles.set(shape, writeXcursor(images))
    }
    for (const [alias, target] of Object.entries(spec.aliases)) {
      xcursorFiles.set(alias, xcursorFiles.get(target))
    }
    for (const [name, file] of xcursorFiles) outputs.set(`${base}/cursors/${name}`, file)
  }
  return outputs
}

async function readInputs(root) {
  const spec = loadSpec(JSON.parse(await readFile(path.join(root, CURSOR_SPEC), 'utf8')))
  const pointer = JSON.parse(await readFile(path.join(root, CURSOR_POINTER), 'utf8'))
  const sources = new Map()
  for (const shape of spec.shapes) {
    sources.set(shape, await readFile(path.join(root, CURSOR_SOURCES, `${shape}.svg`), 'utf8'))
  }
  return { sources, spec, pointer }
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function toPosix(relative) {
  return relative.split(path.sep).join(path.posix.sep)
}

export async function writeCursors(root, outputs) {
  for (const [name, data] of outputs) {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, data)
  }
}

/** Repo-relative posix paths whose committed bytes differ from a fresh render. */
export async function staleCursors(root, outputs) {
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
    const fresh = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    if (!committed.equals(fresh)) stale.push(name)
  }
  return stale.toSorted(compareStrings).map((name) => toPosix(name))
}

async function main() {
  const check = process.argv.includes('--check')
  const inputs = await readInputs(REPO_ROOT)
  const outputs = renderCursors(inputs)
  if (!check) {
    await writeCursors(REPO_ROOT, outputs)
    process.stdout.write(`cursors: wrote ${String(outputs.size)} files\n`)
    return
  }
  const stale = await staleCursors(REPO_ROOT, outputs)
  if (stale.length > 0) {
    process.stdout.write(`cursors: stale output:\n${stale.map((name) => `  ${name}\n`).join('')}`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`cursors: ${String(outputs.size)} outputs fresh\n`)
}

if (isEntryPoint(import.meta.url)) {
  await main()
}
