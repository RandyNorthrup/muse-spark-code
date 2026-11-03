// M111 AR art wallpapers: the committed PNGs match a fresh resvg render of
// the template filled from TH's recipe, the recipe (not hardcoded colours)
// decides the pixels, the greeter dims the dark composition, and the
// freshness check fires on a planted stale file (on a fixture, never the
// repo).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import {
  WALLPAPER_MODES,
  WALLPAPER_RECIPE,
  WALLPAPER_SIZES,
  WALLPAPER_TEMPLATE,
  greeterSvg,
  renderWallpaper,
  staleDesktopArt,
  wallpaperPalette,
  wallpaperSvg,
  writeDesktopArt,
} from '../../../scripts/build-desktop-art.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const template = await readFile(path.join(root, WALLPAPER_TEMPLATE), 'utf8')
const recipe = JSON.parse(await readFile(path.join(root, WALLPAPER_RECIPE), 'utf8'))

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})

function wallpaperName(mode, width, height) {
  return `design/art/wallpapers/muse-${mode}-${String(width)}x${String(height)}.png`
}

function channel(png, x, y, band) {
  return png.data[(y * png.width + x) * 4 + band]
}

function expectPixel(png, [x, y], expected) {
  for (const [band, value] of expected.entries()) {
    expect(channel(png, x, y, band)).toBe(value)
  }
}

function repaintedRecipe(base) {
  return {
    ...recipe,
    modes: { ...recipe.modes, dark: { ...recipe.modes.dark, base: { value: base } } },
  }
}

// PNG dimensions from the IHDR alone: the 8-byte signature, a 13-byte IHDR,
// then big-endian width and height. Full decodes stay where pixels matter.
function pngSize(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  expect(buffer.subarray(0, 8).equals(signature)).toBe(true)
  expect(buffer.readUInt32BE(8)).toBe(13)
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

describe('wallpaper composition', () => {
  it('renders the recipe, not hardcoded colours', () => {
    const svg = wallpaperSvg(template, wallpaperPalette(repaintedRecipe('#ff0000'), 'dark'))
    const png = PNG.sync.read(renderWallpaper(svg, 1920, 1080))
    expect(channel(png, 4, 0, 0)).toBeGreaterThanOrEqual(250)
    expect(channel(png, 4, 0, 1)).toBe(0)
    expect(channel(png, 4, 0, 2)).toBe(0)
  })

  it('dims the greeter glow and mark', () => {
    const dark = wallpaperPalette(recipe, 'dark')
    const wall = PNG.sync.read(renderWallpaper(wallpaperSvg(template, dark), 1920, 1080))
    const greeter = PNG.sync.read(renderWallpaper(greeterSvg(template, dark), 1920, 1080))
    // The glow's centre pixel is bluer on the wallpaper than the greeter.
    expect(channel(wall, 960, 454, 2)).toBeGreaterThan(channel(greeter, 960, 454, 2))
    // The greeter halves both glow stops and drops the mark to 0.05.
    expect(greeterSvg(template, dark)).toContain('stop-opacity="0.16"')
    expect(greeterSvg(template, dark)).toContain('stop-opacity="0.06"')
    expect(greeterSvg(template, dark)).toContain('opacity="0.05"')
  })

  it('rejects a bad recipe', () => {
    expect(() => wallpaperPalette(recipe, 'sepia')).toThrow('no sepia mode')
    expect(() => wallpaperPalette(repaintedRecipe('red'), 'dark')).toThrow('dark.base')
  })
})

describe('committed wallpapers', () => {
  for (const mode of WALLPAPER_MODES) {
    it(`${mode}: committed PNGs match a fresh render byte-for-byte`, async () => {
      const svg = wallpaperSvg(template, wallpaperPalette(recipe, mode))
      for (const [width, height] of WALLPAPER_SIZES) {
        const committed = await readFile(path.join(root, wallpaperName(mode, width, height)))
        expect(renderWallpaper(svg, width, height).equals(committed)).toBe(true)
      }
    })
  }

  it('greeter: committed PNGs match a fresh render byte-for-byte', async () => {
    const svg = greeterSvg(template, wallpaperPalette(recipe, 'dark'))
    for (const [width, height] of WALLPAPER_SIZES) {
      const committed = await readFile(
        path.join(
          root,
          `design/art/wallpapers/muse-greeter-${String(width)}x${String(height)}.png`,
        ),
      )
      expect(renderWallpaper(svg, width, height).equals(committed)).toBe(true)
    }
  })

  it('corners carry the wash, the centre the glow', async () => {
    const png = PNG.sync.read(await readFile(path.join(root, wallpaperName('dark', 1920, 1080))))
    expectPixel(png, [4, 4], [24, 24, 24, 255])
    expectPixel(png, [4, 1075], [36, 40, 50, 255])
    expect(channel(png, 960, 454, 2)).toBeGreaterThan(channel(png, 960, 454, 0))
    expect(channel(png, 960, 454, 2)).toBeGreaterThan(channel(png, 960, 454, 1))
  })

  it('every PNG carries its claimed size', async () => {
    const names = [
      ...WALLPAPER_MODES.flatMap((mode) =>
        WALLPAPER_SIZES.map(([width, height]) => [
          wallpaperName(mode, width, height),
          width,
          height,
        ]),
      ),
      ...WALLPAPER_SIZES.map(([width, height]) => [
        `design/art/wallpapers/muse-greeter-${String(width)}x${String(height)}.png`,
        width,
        height,
      ]),
    ]
    expect(names).toHaveLength(15)
    for (const [name, width, height] of names) {
      expect(pngSize(await readFile(path.join(root, name)))).toEqual([width, height])
    }
  })

  it('finds a planted stale file and only that file', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'desktop-art-'))
    fixtures.push(folder)
    const svg = wallpaperSvg(template, wallpaperPalette(recipe, 'dark'))
    const outputs = new Map([[wallpaperName('dark', 1920, 1080), renderWallpaper(svg, 1920, 1080)]])
    await writeDesktopArt(folder, outputs)
    expect(await staleDesktopArt(folder, outputs)).toEqual([])
    const [victim] = outputs.keys()
    await writeFile(path.join(folder, victim), Buffer.from('stale'))
    expect(await staleDesktopArt(folder, outputs)).toEqual([victim])
  })
})
