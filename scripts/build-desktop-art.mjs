// M111 lane AR (D91.11): the desktop wallpapers and greeter art, built from
// the SVG template in design/art/wallpapers/src/ and TH's recipe
// (desktop/shell/theme/wallpapers.json). One template, one composition per
// the approved mockups: the recipe's base-to-deep wash, the brand gradient
// glow, the squiggle-m watermark at the mockups' 0.07 opacity. Four modes
// (dark, light, hc-dark, hc-light) at 1920x1080, 2560x1440 and 3840x2160,
// plus the greeter backgrounds (the dark recipe with the glow halved and
// the mark at 0.05, so the login card reads). The recipe's `rule` key is
// not painted: it is the focus colour SS's on-wallpaper UI reads from the
// same recipe. SS consumes the PNGs named here.
//
//   node scripts/build-desktop-art.mjs          regenerate every PNG
//   node scripts/build-desktop-art.mjs --check  exit 1 naming stale files
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

export const WALLPAPER_TEMPLATE = 'design/art/wallpapers/src/wallpaper.svg'
export const WALLPAPER_RECIPE = 'desktop/shell/theme/wallpapers.json'
export const WALLPAPER_DIR = 'design/art/wallpapers'
export const WALLPAPER_MODES = ['dark', 'light', 'hc-dark', 'hc-light']
export const WALLPAPER_SIZES = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
]
// The glow's centre and mid opacity, and the watermark's opacity (the
// mockups' 0.07); the greeter halves the glow and drops the mark to 0.05.
export const WALLPAPER_GLOW_OPACITY = '0.32'
export const WALLPAPER_GLOW_MID_OPACITY = '0.12'
export const WALLPAPER_MARK_OPACITY = '0.07'
export const GREETER_MARK_OPACITY = '0.05'
const GREETER_GLOW_SCALE = 0.5
const HEX = /^#[0-9a-f]{6}$/

function fail(message) {
  throw new Error(`build-desktop-art: ${message}`)
}

function hex(value, what) {
  if (typeof value !== 'string' || !HEX.test(value)) fail(`${what} is not a #rrggbb colour`)
  return value
}

function numberText(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} is not a number`)
  return String(value)
}

/** One mode's painted colours from TH's recipe, validated; no colour is invented here. */
export function wallpaperPalette(recipe, mode) {
  const entry = recipe?.modes?.[mode]
  if (entry === undefined || entry === null || typeof entry !== 'object') {
    fail(`recipe has no ${mode} mode`)
  }
  return {
    base: hex(entry.base?.value, `${mode}.base`),
    deep: hex(entry.deep?.value, `${mode}.deep`),
    gradientFrom: hex(entry.gradientFrom?.value, `${mode}.gradientFrom`),
    gradientTo: hex(entry.gradientTo?.value, `${mode}.gradientTo`),
    glow: hex(entry.glow?.value, `${mode}.glow`),
  }
}

function fillPlaceholders(template, values) {
  let svg = template
  for (const [placeholder, value] of Object.entries(values)) {
    svg = svg.replaceAll(`%%${placeholder}%%`, () => value)
  }
  if (svg.includes('%%')) fail('a placeholder survived substitution')
  return svg
}

/** One mode's wallpaper SVG: the recipe's colours in the template's composition. */
export function wallpaperSvg(template, palette, options = {}) {
  const {
    glowOpacity = WALLPAPER_GLOW_OPACITY,
    glowMidOpacity = WALLPAPER_GLOW_MID_OPACITY,
    markOpacity = WALLPAPER_MARK_OPACITY,
  } = options
  return fillPlaceholders(template, {
    BASE: palette.base,
    DEEP: palette.deep,
    GRADIENT_FROM: palette.gradientFrom,
    GRADIENT_TO: palette.gradientTo,
    GLOW: palette.glow,
    GLOW_OPACITY: glowOpacity,
    GLOW_MID_OPACITY: glowMidOpacity,
    MARK_OPACITY: markOpacity,
  })
}

/** The greeter's SVG: the dark recipe with the glow halved and a fainter mark. */
export function greeterSvg(template, palette) {
  return wallpaperSvg(template, palette, {
    glowOpacity: numberText(Number(WALLPAPER_GLOW_OPACITY) * GREETER_GLOW_SCALE, 'greeter glow'),
    glowMidOpacity: numberText(
      Number(WALLPAPER_GLOW_MID_OPACITY) * GREETER_GLOW_SCALE,
      'greeter mid glow',
    ),
    markOpacity: GREETER_MARK_OPACITY,
  })
}

/** Render one SVG to PNG bytes at exactly width x height (resvg, pinned). */
export function renderWallpaper(svg, width, height) {
  const png = Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng(),
  )
  const decoded = PNG.sync.read(png)
  if (decoded.width !== width || decoded.height !== height) {
    fail(
      `resvg rendered ${String(decoded.width)}x${String(decoded.height)}, not ${width}x${height}`,
    )
  }
  return png
}

/** Every wallpaper and greeter PNG, as a map of posix path to bytes. */
export function renderDesktopArt({ template, recipe }) {
  const outputs = new Map()
  for (const mode of WALLPAPER_MODES) {
    const palette = wallpaperPalette(recipe, mode)
    const svg = wallpaperSvg(template, palette)
    for (const [width, height] of WALLPAPER_SIZES) {
      outputs.set(
        `${WALLPAPER_DIR}/muse-${mode}-${String(width)}x${String(height)}.png`,
        renderWallpaper(svg, width, height),
      )
    }
  }
  const dark = wallpaperPalette(recipe, 'dark')
  const greeter = greeterSvg(template, dark)
  for (const [width, height] of WALLPAPER_SIZES) {
    outputs.set(
      `${WALLPAPER_DIR}/muse-greeter-${String(width)}x${String(height)}.png`,
      renderWallpaper(greeter, width, height),
    )
  }
  return outputs
}

async function readInputs(root) {
  const template = await readFile(path.join(root, WALLPAPER_TEMPLATE), 'utf8')
  const recipe = JSON.parse(await readFile(path.join(root, WALLPAPER_RECIPE), 'utf8'))
  return { template, recipe }
}

export async function writeDesktopArt(root, outputs) {
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

/** Repo-relative posix paths whose committed bytes differ from a fresh render. */
export async function staleDesktopArt(root, outputs) {
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
    if (!committed.equals(data)) stale.push(name)
  }
  return stale.toSorted(compareStrings).map((name) => toPosix(name))
}

async function main() {
  const check = process.argv.includes('--check')
  const inputs = await readInputs(REPO_ROOT)
  const outputs = renderDesktopArt(inputs)
  if (!check) {
    await writeDesktopArt(REPO_ROOT, outputs)
    process.stdout.write(`desktop-art: wrote ${String(outputs.size)} files\n`)
    return
  }
  const stale = await staleDesktopArt(REPO_ROOT, outputs)
  if (stale.length > 0) {
    process.stdout.write(
      `desktop-art: stale output:\n${stale.map((name) => `  ${name}\n`).join('')}`,
    )
    process.exitCode = 1
    return
  }
  process.stdout.write(`desktop-art: ${String(outputs.size)} outputs fresh\n`)
}

if (isEntryPoint(import.meta.url)) {
  await main()
}
