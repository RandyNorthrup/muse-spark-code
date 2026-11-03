// M111 lane AR: the pointer themes are real, loadable cursor files. Parses
// every committed Xcursor file and .hlc with independent readers written
// from libXcursor's and hyprcursor-util's own sources, proves the pixels
// match a fresh resvg render, and proves the freshness check fires on a
// planted stale file (on a fixture, never the repo).
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import {
  CURSOR_POINTER,
  CURSOR_SOURCES,
  CURSOR_SPEC,
  CURSOR_THEMES,
  crc32Bytes,
  cursorPalette,
  loadSpec,
  renderCursors,
  renderMeta,
  shapeFrames,
  staleCursors,
  themeSvg,
  writeCursors,
  writeXcursor,
  writeZip,
} from '../../../scripts/build-cursors.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readRoot = (name) => readFile(path.join(root, name))
const rawSpec = JSON.parse(await readFile(path.join(root, CURSOR_SPEC), 'utf8'))
const spec = loadSpec(rawSpec)
const pointer = JSON.parse(await readFile(path.join(root, CURSOR_POINTER), 'utf8'))
const themeDirs = CURSOR_THEMES.map((theme) => `design/art/cursors/${theme.dir}`)

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})

// The Xcursor reader, from libXcursor's file.c: magic, LE u32s, TOC, image
// chunks. Independent of the builder: it never imports its writer.
function readXcursor(bytes) {
  const u32 = (at) => bytes.readUInt32LE(at)
  if (u32(0) !== 0x72_75_63_58) throw new Error('not an Xcursor file')
  if (u32(8) !== 0x00_01_00_00) throw new Error('not Xcursor file version 1.0')
  const ntoc = u32(12)
  // Like libXcursor's own files: the field holds 16, the TOC follows.
  if (u32(4) !== 16) throw new Error('the header length is not 16')
  return Array.from({ length: ntoc }, (_, index) => {
    const base = 16 + index * 12
    const [type, subtype, position] = [u32(base), u32(base + 4), u32(base + 8)]
    if (type !== 0xff_fd_00_02) throw new Error('not an image chunk')
    const head = Array.from({ length: 9 }, (_, word) => u32(position + word * 4))
    const [header, chunkType, chunkSubtype, version, width, height, xhot, yhot, delay] = head
    if (header !== 36 || chunkType !== type || chunkSubtype !== subtype || version !== 1) {
      throw new Error('a chunk header disagrees with its TOC entry')
    }
    return {
      size: subtype,
      width,
      height,
      xhot,
      yhot,
      delay,
      pixels: bytes.subarray(position + 36, position + 36 + width * height * 4),
    }
  })
}

// Bitwise CRC32 (no table): a different road to the same IEEE value the
// builder's table version must equal, entry by entry.
function crcBitwise(data) {
  let crc = 0xff_ff_ff_ff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xed_b8_83_20 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0
}

// The smallest ZIP reader a .hlc needs: central directory entries, each
// with its stored bytes, UTF-8 flag and CRC.
function readZip(bytes) {
  const u16 = (at) => bytes.readUInt16LE(at)
  const u32 = (at) => bytes.readUInt32LE(at)
  const end = bytes.length - 22
  if (u32(end) !== 0x06_05_4b_50) throw new Error('no end-of-central-directory')
  const count = u16(end + 8)
  const directoryAt = u32(end + 16)
  const entries = []
  let at = directoryAt
  for (let index = 0; index < count; index += 1) {
    if (u32(at) !== 0x02_01_4b_50) throw new Error('a central entry is no entry')
    const method = u16(at + 10)
    const flags = u16(at + 8)
    const crc = u32(at + 16)
    const size = u32(at + 20)
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    const commentLength = u16(at + 32)
    const localAt = u32(at + 42)
    if (u32(localAt) !== 0x04_03_4b_50) throw new Error('a local header is no header')
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataAt = localAt + 30 + u16(localAt + 26) + u16(localAt + 28)
    const data = bytes.subarray(dataAt, dataAt + size)
    if (data.length !== size) throw new Error('an entry is cut short')
    entries.push({ name, method, flags, crc, data })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function rgbaAt(pixels, width, x, y) {
  const at = (y * width + x) * 4
  return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
}

const META_READERS = {
  hotspot_x: (meta, value) => {
    meta.x = Number(value)
  },
  hotspot_y: (meta, value) => {
    meta.y = Number(value)
  },
  define_override: (meta, value) => {
    meta.overrides.push(value)
  },
  define_size: (meta, value) => {
    meta.sizes.push(value)
  },
  resize_algorithm: (meta, value) => {
    meta.resize = value
  },
}

function parseMeta(text) {
  const meta = { overrides: [], sizes: [] }
  for (const line of text.trim().split('\n')) {
    const [key, value] = line.split('=', 2).map((part) => part.trim())
    const read = META_READERS[key]
    if (read === undefined) throw new Error(`unknown meta key ${key}`)
    read(meta, value)
  }
  return meta
}

function compareStrings(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

// Two real shapes through the real builder, the only fixture: fast enough
// for the suite, while `npm run check:art` proves the full tree.
async function miniOutputs() {
  const mini = loadSpec({
    version: 1,
    shapes: ['default', 'wait'],
    hotspots: { default: spec.hotspots.default, wait: spec.hotspots.wait },
    aliases: { left_ptr: 'default' },
    sizes: [32],
    rotors: { wait: spec.rotors.wait },
    animation: spec.animation,
  })
  const sources = new Map()
  for (const shape of mini.shapes) {
    sources.set(shape, await readFile(path.join(root, CURSOR_SOURCES, `${shape}.svg`), 'utf8'))
  }
  return renderCursors({ sources, spec: mini, pointer })
}

describe('cursor sources', () => {
  it('list every shape once, with a hotspot, and resolve every alias', () => {
    expect(spec.shapes).toHaveLength(34)
    expect(Object.keys(spec.aliases)).toHaveLength(28)
    expect(spec.sizes).toEqual([24, 32, 48, 64, 96])
    for (const shape of spec.shapes) {
      expect(spec.hotspots[shape]).toHaveLength(2)
    }
  })

  it('carry placeholders and no literal colour', async () => {
    for (const shape of spec.shapes) {
      const source = await readFile(path.join(root, CURSOR_SOURCES, `${shape}.svg`), 'utf8')
      expect(source).toContain('%%')
      expect(source).not.toMatch(/#[0-9a-f]{6}/i)
    }
  })

  it('refuses a bad spec instead of building from it', () => {
    expect(() => loadSpec({ ...rawSpec, version: 2 })).toThrowError(/version 1/)
    expect(() =>
      loadSpec({ ...rawSpec, hotspots: { ...rawSpec.hotspots, default: [99, 3] } }),
    ).toThrowError(/hotspot/)
    expect(() => loadSpec({ ...rawSpec, aliases: { xterm: 'nope' } })).toThrowError(/no shape/)
    expect(() => loadSpec({ ...rawSpec, sizes: [] })).toThrowError(/sizes/)
  })

  it('refuses a source with an unknown placeholder or a missing rotor', () => {
    const palette = cursorPalette(pointer, 'dark')
    expect(() => themeSvg('<svg>%%NOPE%%</svg>', 'x', palette, 1)).toThrowError(/placeholder/)
    expect(() => themeSvg('<svg fill="%%FILL%%"/>', 'x', palette, 1)).not.toThrowError()
    expect(() => shapeFrames('<svg/>', 'wait', spec.rotors, 8)).toThrowError(/rotor/)
  })

  it('reads the palette from TH, never invents one', () => {
    expect(cursorPalette(pointer, 'dark')).toEqual({
      fill: pointer.modes.dark.fill.value,
      outline: pointer.modes.dark.outline.value,
      accent: pointer.modes.dark.accent.value,
    })
    expect(() => cursorPalette(pointer, 'nope')).toThrowError(/no mode/)
  })

  it('scales strokes per theme and rotates rotors per frame', () => {
    const palette = cursorPalette(pointer, 'dark')
    const themed = themeSvg(
      '<svg><path fill="%%FILL%%" stroke-width="2"/></svg>',
      'x',
      palette,
      1.5,
    )
    expect(themed).toContain('stroke-width="3"')
    const rotor = '<svg><g id="rotor"><circle/></g></svg>'
    const frames = shapeFrames(rotor, 'wait', spec.rotors, 8)
    expect(frames).toHaveLength(8)
    expect(frames[0].svg).toContain('<g id="rotor">')
    expect(frames[1].svg).toContain('rotate(45 16 16)')
    expect(frames[4].svg).toContain('rotate(180 16 16)')
    expect(shapeFrames('<svg/>', 'default', spec.rotors, 8)).toHaveLength(1)
  })

  it('matches the IEEE CRC check value', () => {
    expect(crc32Bytes(Buffer.from('123456789', 'utf8'))).toBe(0xcb_f4_39_26)
  })
})

describe('cursor freshness', () => {
  it('writes every theme file, aliases as copies of their targets', async () => {
    const outputs = await miniOutputs()
    for (const theme of CURSOR_THEMES) {
      const base = `design/art/cursors/${theme.dir}`
      expect(outputs.has(`${base}/manifest.hl`)).toBe(true)
      expect(outputs.has(`${base}/index.theme`)).toBe(true)
      expect(outputs.has(`${base}/hyprcursors/default.hlc`)).toBe(true)
      expect(outputs.has(`${base}/hyprcursors/wait.hlc`)).toBe(true)
      expect(
        outputs.get(`${base}/cursors/left_ptr`).equals(outputs.get(`${base}/cursors/default`)),
      ).toBe(true)
    }
  })

  it('finds a planted stale file and only that file', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'cursors-'))
    fixtures.push(folder)
    const outputs = await miniOutputs()
    await writeCursors(folder, outputs)
    expect(await staleCursors(folder, outputs)).toEqual([])
    const victim = `design/art/cursors/Muse/cursors/default`
    await writeFile(path.join(folder, victim), Buffer.from('stale'))
    expect(await staleCursors(folder, outputs)).toEqual([victim])
  })
})

describe('committed Xcursor files', () => {
  it('parse as Xcursor 1.0 with five sizes, honest hotspots and delays', async () => {
    const names = [...spec.shapes, ...Object.keys(spec.aliases)]
    expect(names).toHaveLength(62)
    for (const dir of themeDirs) {
      for (const name of names) {
        const images = readXcursor(await readRoot(`${dir}/cursors/${name}`))
        const canonical = spec.aliases[name] ?? name
        const isAnimated = spec.rotors[canonical] !== undefined
        expect(images).toHaveLength(isAnimated ? 40 : 5)
        for (const image of images) {
          expect(spec.sizes).toContain(image.size)
          expect([image.width, image.height]).toEqual([image.size, image.size])
          expect(image.xhot).toBeLessThanOrEqual(image.size)
          expect(image.yhot).toBeLessThanOrEqual(image.size)
          expect(image.delay).toBe(isAnimated ? spec.animation.frameDelayMs : 0)
          expect(image.pixels.length).toBe(image.size * image.size * 4)
        }
        const [hotX, hotY] = spec.hotspots[canonical]
        const at32 = images.find((image) => image.size === 32)
        expect([at32.xhot, at32.yhot]).toEqual([
          Math.round((hotX / 32) * 32),
          Math.round((hotY / 32) * 32),
        ])
      }
    }
  })

  it('paint the hotspot pixel: art and hotspot agree', async () => {
    // A hotspot on a transparent pixel is a cursor that clicks beside itself.
    for (const [name, at] of [
      ['default', [7, 3]],
      ['pointer', [16, 3]],
      ['text', [16, 16]],
      ['crosshair', [16, 16]],
    ]) {
      const images = readXcursor(await readRoot(`design/art/cursors/Muse/cursors/${name}`))
      const at32 = images.find((image) => image.size === 32)
      const alpha = rgbaAt(at32.pixels, 32, at[0], at[1])[3]
      expect(alpha).toBeGreaterThan(127)
    }
  })

  it('carry the pixels a fresh render draws', async () => {
    // The writer's premultiply inverts within one step; anything further is
    // a wrong pixel, not rounding.
    const palette = cursorPalette(pointer, 'dark')
    for (const [name, shape] of [
      ['default', 'default'],
      ['wait', 'wait'],
    ]) {
      const source = await readFile(path.join(root, CURSOR_SOURCES, `${shape}.svg`), 'utf8')
      const fresh = new Resvg(themeSvg(source, shape, palette, 1), {
        font: { loadSystemFonts: false },
        fitTo: { mode: 'width', value: 32 },
      })
        .render()
        .asPng()
      const expectRgba = PNG.sync.read(Buffer.from(fresh)).data
      const images = readXcursor(await readRoot(`design/art/cursors/Muse/cursors/${name}`))
      const first = images.find((image) => image.size === 32).pixels
      let worst = 0
      for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
        const alpha = first[pixel * 4 + 3]
        // Stored bytes are B,G,R,A (an ARGB word, little-endian); the fresh
        // render is R,G,B,A.
        for (const channel of [0, 1, 2]) {
          const stored = first[pixel * 4 + (2 - channel)]
          const want = expectRgba[pixel * 4 + channel]
          const unpremultiplied = alpha === 0 ? 0 : Math.round((stored * 255) / alpha)
          worst = Math.max(worst, Math.abs(unpremultiplied - want))
        }
        expect(Math.abs(first[pixel * 4 + 3] - expectRgba[pixel * 4 + 3])).toBe(0)
      }
      expect(worst).toBeLessThanOrEqual(1)
    }
  })
})

describe('committed hyprcursor files', () => {
  it('unzip to a meta plus the frames, CRC-clean, UTF-8 named', async () => {
    for (const dir of themeDirs) {
      for (const shape of spec.shapes) {
        const entries = readZip(await readRoot(`${dir}/hyprcursors/${shape}.hlc`))
        const isAnimated = spec.rotors[shape] !== undefined
        expect(entries.map((entry) => entry.name)).toEqual([
          'meta.hl',
          ...(isAnimated
            ? Array.from({ length: 8 }, (_, frame) => `${shape}-${frame}.svg`)
            : [`${shape}.svg`]),
        ])
        for (const entry of entries) {
          expect(entry.method).toBe(0)
          expect(entry.flags & 0x08_00).toBe(0x08_00)
          expect(crcBitwise(entry.data)).toBe(entry.crc)
        }
        const meta = parseMeta(entries[0].data.toString('utf8'))
        const [hotX, hotY] = spec.hotspots[shape]
        expect([meta.x, meta.y]).toEqual([hotX / 32, hotY / 32])
        expect(meta.resize).toBe('bilinear')
        expect(meta.overrides.toSorted(compareStrings)).toEqual(
          Object.entries(spec.aliases)
            .filter(([, target]) => target === shape)
            .map(([alias]) => alias)
            .toSorted(compareStrings),
        )
        expect(meta.sizes).toHaveLength(isAnimated ? 8 : 1)
        for (const size of meta.sizes) {
          expect(size.startsWith('32, ')).toBe(true)
          expect(size.includes(', 80')).toBe(isAnimated)
        }
      }
    }
  })

  it('names the theme, its directory and every file the meta lists', async () => {
    for (const theme of CURSOR_THEMES) {
      const dir = `design/art/cursors/${theme.dir}`
      const manifest = await readRoot(`${dir}/manifest.hl`)
      expect(manifest.toString('utf8')).toContain(`name = ${theme.name}\n`)
      expect(manifest.toString('utf8')).toContain('cursors_directory = hyprcursors\n')
      for (const shape of spec.shapes) {
        const entries = readZip(await readRoot(`${dir}/hyprcursors/${shape}.hlc`))
        const meta = parseMeta(entries[0].data.toString('utf8'))
        const files = new Set(entries.map((entry) => entry.name))
        for (const size of meta.sizes) {
          expect(files.has(size.split(',', 3)[1].trim())).toBe(true)
        }
      }
    }
  })
})

describe('cursor encoders', () => {
  it('round-trips one Xcursor image through writer and reader', () => {
    const rgba = Buffer.alloc(4 * 4 * 4)
    rgba[3] = 255
    rgba[4] = 255
    rgba[7] = 255
    const file = writeXcursor([{ size: 4, width: 4, height: 4, xhot: 1, yhot: 2, delay: 80, rgba }])
    const [image] = readXcursor(file)
    expect([image.size, image.width, image.xhot, image.yhot, image.delay]).toEqual([4, 4, 1, 2, 80])
    // Stored bytes are B,G,R,A: pixel 0's alpha, pixel 1's red and alpha.
    expect([image.pixels[3], image.pixels[6], image.pixels[7]]).toEqual([255, 255, 255])
  })

  it('round-trips one zip entry through writer and reader', () => {
    const entries = readZip(writeZip([{ name: 'meta.hl', data: Buffer.from('x = 1\n', 'utf8') }]))
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('meta.hl')
    expect(entries[0].data.toString('utf8')).toBe('x = 1\n')
    expect(crcBitwise(entries[0].data)).toBe(entries[0].crc)
  })

  it('renders one meta exactly as hyprcursor documents it', () => {
    expect(renderMeta([7, 3], ['arrow', 'left_ptr'], ['default'], 80)).toBe(
      [
        'resize_algorithm = bilinear',
        'hotspot_x = 0.21875',
        'hotspot_y = 0.09375',
        'define_override = arrow',
        'define_override = left_ptr',
        'define_size = 32, default.svg',
        '',
      ].join('\n'),
    )
  })
})
