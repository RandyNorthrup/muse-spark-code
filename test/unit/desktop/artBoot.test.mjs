// M111 AR boot art: the Plymouth theme packages every file its script
// shows, paints boot.json's colours, registers its callbacks and calls only
// the script API upstream Plymouth verifies; the GRUB theme paints
// boot.json's colours and wires the background, the class icon and the
// Inter faces the bake drill proves. TH's progress PNGs and the GRUB
// background are byte-identical to their sources.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import {
  BOOT_ART,
  BOOT_JSON,
  BOOT_PROGRESS_FILL,
  BOOT_PROGRESS_TRACK,
  BOOT_SOURCES,
  GRUB_THEME_DIR,
  PLYMOUTH_DIR,
  bootPalette,
  bootSvg,
  renderWallpaper,
} from '../../../scripts/build-desktop-art.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readRoot = (name) => readFile(path.join(root, name))
const readText = (name) => readFile(path.join(root, name), 'utf8')

const boot = JSON.parse(await readText(BOOT_JSON))
const script = await readText(`${PLYMOUTH_DIR}/muse-desktop.script`)
const descriptor = await readText(`${PLYMOUTH_DIR}/muse-desktop.plymouth`)
const theme = await readText(`${GRUB_THEME_DIR}/theme.txt`)
const sources = new Map()
for (const { source } of BOOT_ART) {
  sources.set(source, await readText(`${BOOT_SOURCES}/${source}`))
}

// The script-plugin call surface, transcribed from upstream Plymouth
// (gitlab.freedesktop.org/plymouth/plymouth.git, b79b1786, 2026-11-02):
// the C builtins in src/plugins/splash/script/script-lib-{plymouth,
// sprite,image,math}.c plus the .script libraries beside them. Window,
// Image, Sprite, Math and Plymouth calls must land in their own set;
// calls on script locals (sprites and images the script builds) must land
// in the sprite/image union.
const SCRIPT_API = {
  Window: new Set([
    'GetHeight',
    'GetWidth',
    'GetX',
    'GetY',
    'SetBackgroundBottomColor',
    'SetBackgroundTopColor',
  ]),
  Image: new Set(['Adopt', 'Crop', 'GetHeight', 'GetWidth', 'Rotate', 'Scale', 'Text', 'Tile']),
  Sprite: new Set([
    'GetHeight',
    'GetImage',
    'GetOpacity',
    'GetWidth',
    'GetX',
    'GetY',
    'GetZ',
    'SetImage',
    'SetOpacity',
    'SetPosition',
    'SetX',
    'SetY',
    'SetZ',
  ]),
  Math: new Set(['Abs', 'Clamp', 'Cos', 'Int', 'Max', 'Min', 'Random', 'Sin', 'Sqrt', 'Tan']),
  Plymouth: new Set([
    'GetCapslockState',
    'GetKeyboardLayout',
    'GetMode',
    'SetBootProgressFunction',
    'SetDisplayHotplugFunction',
    'SetDisplayMessageFunction',
    'SetDisplayNormalFunction',
    'SetDisplayPasswordFunction',
    'SetDisplayPromptFunction',
    'SetDisplayQuestionFunction',
    'SetHideMessageFunction',
    'SetKeyboardInputFunction',
    'SetMessageFunction',
    'SetQuitFunction',
    'SetRefreshFunction',
    'SetRefreshRate',
    'SetRootMountedFunction',
    'SetSystemUpdateFunction',
    'SetUpdateStatusFunction',
    'SetValidateInputFunction',
  ]),
}
const CONSTRUCTORS = new Set(['Image', 'Sprite'])

function uncommented(text) {
  return text
    .split('\n')
    .map((line) => line.split('#', 1)[0])
    .join('\n')
}

function dottedCalls(text) {
  return uncommented(text)
    .matchAll(/([A-Za-z_][\dA-Za-z_]*)\.([A-Za-z_][\dA-Za-z_]*)\s*\(/g)
    .map(([, object, method]) => [object, method])
    .toArray()
}

function floatTriples(text) {
  return text
    .matchAll(/(0\.\d+),\s*(0\.\d+),\s*(0\.\d+)/g)
    .map(([, red, green, blue]) => [red, green, blue].map(Number))
    .toArray()
}

function hexToChannels(value) {
  return [value.slice(1, 3), value.slice(3, 5), value.slice(5, 7)].map((pair) =>
    Number.parseInt(pair, 16),
  )
}

function themeAssignments() {
  // Globals use `name: "value"`, component properties `name = value` with
  // strings quoted and numbers bare.
  return new Map(
    theme
      .matchAll(/^\s*([\w-]+)\s*[:=]\s*(?:"([^"]*)"|(\S+))\s*$/gm)
      .map(([, key, quoted, bare]) => [key, quoted ?? bare]),
  )
}

describe('plymouth theme', () => {
  it('packages every file the script shows', async () => {
    const shown = new Set(
      script
        .matchAll(/Image\s*\(\s*"([^"]+)"\s*\)/g)
        .map(([, name]) => name)
        .filter((name) => !name.startsWith('special://')),
    )
    expect(shown.size).toBeGreaterThan(0)
    for (const name of shown) {
      await expect(
        readRoot(`${PLYMOUTH_DIR}/${name}`),
        `${name} is packaged`,
      ).resolves.toBeDefined()
    }
    expect(descriptor).toContain('ModuleName=script')
    expect(descriptor).toContain(
      'ScriptFile=/usr/share/plymouth/themes/muse-desktop/muse-desktop.script',
    )
    expect(descriptor).toContain('ImageDir=/usr/share/plymouth/themes/muse-desktop')
  })

  it('paints boot.json colours in Inter 13', () => {
    const palette = bootPalette(boot)
    const expected = new Map([
      ['backgroundTop', palette.backgroundTop],
      ['backgroundBottom', palette.backgroundBottom],
      ['message', palette.message],
    ])
    const triples = floatTriples(script)
    expect(triples.length).toBeGreaterThan(0)
    for (const triple of triples) {
      const channels = triple.map((unit) => Math.round(unit * 255))
      const matchesBoot = expected
        .values()
        .some((value) =>
          hexToChannels(value).every((band, at) => Math.abs(band - channels[at]) <= 1),
        )
      expect(matchesBoot, `triple ${triple.join(',')} matches boot.json`).toBe(true)
    }
    const fonts = script
      .matchAll(/Image\.Text\s*\([^)]*"([^"]+)"\s*\)/g)
      .map(([, font]) => font)
      .toArray()
    expect(fonts.length).toBeGreaterThan(0)
    for (const font of fonts) {
      expect(font).toBe('Inter 13')
    }
  })

  it('registers progress, message, dialog, quit and refresh', () => {
    const registered = uncommented(script)
      .matchAll(/Plymouth\.(Set\w+)\s*\(\s*(\w+)/g)
      .map(([, registration, callback]) => [registration, callback])
      .toArray()
    const registrations = registered.map(([registration]) => registration)
    for (const registration of [
      'SetBootProgressFunction',
      'SetDisplayMessageFunction',
      'SetHideMessageFunction',
      'SetDisplayNormalFunction',
      'SetDisplayPasswordFunction',
      'SetQuitFunction',
      'SetRefreshFunction',
    ]) {
      expect(registrations).toContain(registration)
    }
    const defined = new Set(
      uncommented(script)
        .matchAll(/fun\s+(\w+)/g)
        .map(([, name]) => name),
    )
    for (const [registration, callback] of registered) {
      expect(defined.has(callback), `${registration} names a defined ${callback}`).toBe(true)
    }
  })

  it('calls only the upstream-verified script API', () => {
    const calls = dottedCalls(script)
    expect(calls.length).toBeGreaterThan(0)
    const localMethods = new Set([...SCRIPT_API.Sprite, ...SCRIPT_API.Image])
    for (const [object, method] of calls) {
      const allowed = Object.hasOwn(SCRIPT_API, object) ? SCRIPT_API[object] : localMethods
      expect(allowed.has(method), `${object}.${method} is upstream API`).toBe(true)
    }
    const code = uncommented(script)
    const constructed = code
      .matchAll(/\b([A-Z][\dA-Za-z_]*)\s*\(/g)
      .filter((match) => code[match.index - 1] !== '.')
      .map(([, name]) => name)
      .toArray()
    const uniqueConstructed = new Set(constructed)
    for (const name of uniqueConstructed) {
      expect(CONSTRUCTORS.has(name), `${name} is a constructor`).toBe(true)
    }
  })

  it('renders the boot palette, not hardcoded colours', () => {
    const repainted = {
      ...boot,
      dark: { ...boot.dark, progressFill: { value: '#ff0000' } },
    }
    const bullet = sources.get('bullet.svg')
    expect(bullet).toBeDefined()
    const png = PNG.sync.read(renderWallpaper(bootSvg(bullet, bootPalette(repainted)), 7, 7))
    const at = (3 * png.width + 3) * 4
    expect(png.data[at]).toBeGreaterThanOrEqual(250)
    expect(png.data[at + 1]).toBe(0)
    expect(png.data[at + 2]).toBe(0)
  })

  it('committed boot art matches fresh renders byte-for-byte', async () => {
    const palette = bootPalette(boot)
    for (const { source, output, width, height } of BOOT_ART) {
      const svg = sources.get(source)
      expect(svg, `${source} was read`).toBeDefined()
      const committed = await readRoot(output)
      expect(renderWallpaper(bootSvg(svg, palette), width, height).equals(committed)).toBe(true)
    }
  })

  it("progress PNGs are TH's bytes", async () => {
    const track = await readRoot(`${PLYMOUTH_DIR}/progress-track.png`)
    const trackSource = await readRoot(BOOT_PROGRESS_TRACK)
    expect(track.equals(trackSource)).toBe(true)
    const fill = await readRoot(`${PLYMOUTH_DIR}/progress-fill.png`)
    const fillSource = await readRoot(BOOT_PROGRESS_FILL)
    expect(fill.equals(fillSource)).toBe(true)
  })
})

describe('grub theme', () => {
  it('paints boot.json colours', () => {
    const palette = bootPalette(boot)
    const dark = boot.dark
    const assigned = themeAssignments()
    expect(assigned.get('desktop-color')).toBe(palette.backgroundTop)
    expect(assigned.get('item_color')).toBe(dark.item.value)
    expect(assigned.get('selected_item_color')).toBe(dark.selectedItem.value)
    expect(assigned.get('fg_color')).toBe(palette.progressFill)
    expect(assigned.get('bg_color')).toBe(palette.progressTrack)
    expect(assigned.get('border_color')).toBe(palette.border)
    const knownColours = new Set(Object.values(dark).map((entry) => entry.value))
    for (const [key, value] of assigned) {
      if (!value.startsWith('#')) continue
      expect(knownColours.has(value), `${key} names a boot.json colour`).toBe(true)
    }
  })

  it('wires the background, the icon size and the baked Inter faces', async () => {
    const assigned = themeAssignments()
    expect(assigned.get('desktop-image')).toBe('background.png')
    await expect(readRoot(`${GRUB_THEME_DIR}/background.png`)).resolves.toBeDefined()
    expect(assigned.get('icon_width')).toBe('32')
    expect(assigned.get('icon_height')).toBe('32')
    const icon = PNG.sync.read(await readRoot(`${GRUB_THEME_DIR}/icons/muse.png`))
    expect([icon.width, icon.height]).toEqual([32, 32])
    // The bake drill proves grub-mkfont names these faces exactly so.
    expect(assigned.get('item_font')).toBe('Inter Regular 16')
    expect(assigned.get('selected_item_font')).toBe('Inter Bold 16')
    expect(assigned.get('terminal-font')).toBe('Inter Regular 16')
  })

  it('background is the dark wallpaper', async () => {
    const background = await readRoot(`${GRUB_THEME_DIR}/background.png`)
    const wallpaper = await readRoot('design/art/wallpapers/muse-dark-1920x1080.png')
    expect(background.equals(wallpaper)).toBe(true)
  })

  it('muse icon carries brand paint', async () => {
    const icon = PNG.sync.read(await readRoot(`${GRUB_THEME_DIR}/icons/muse.png`))
    let painted = 0
    let blue = 0
    for (let at = 0; at < icon.data.length; at += 4) {
      if (icon.data[at + 3] === 0) continue
      painted += 1
      if (icon.data[at + 2] > icon.data[at] && icon.data[at + 2] > icon.data[at + 1]) blue += 1
    }
    expect(painted).toBeGreaterThan(100)
    expect(blue / painted).toBeGreaterThan(0.9)
  })
})
