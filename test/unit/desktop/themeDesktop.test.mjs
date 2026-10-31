import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { highlightTree, tags } from '@lezer/highlight'
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { Terminal } from '@xterm/headless'
import { TILING } from '../../../src/shared/desktopContracts'
import {
  CM_HIGHLIGHT,
  DESKTOP_BINARY_OUTPUTS,
  DESKTOP_CONSUMERS,
  DESKTOP_MODES,
  HYPR_TOKEN_NAMES,
  ansiTheme,
  checkDesktop,
  checkDesktopPairs,
  checkModelPairs,
  cmTheme,
  contrastRatio,
  emitHex,
  hyprModel,
  parseConsumers,
  pngPixel,
  renderCodeMirror,
  renderDesktop,
  renderLua,
  renderPaletteCss,
  renderPlymouth,
  renderQml,
  renderRust,
  renderXterm,
  resolveAppearance,
  resolveCss,
  resolvedColour,
} from '../../../scripts/build-tokens-desktop.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const themeDir = path.join(root, 'desktop/shell/theme')
const readTheme = (file) => readFile(path.join(themeDir, file), 'utf8')

const fixtures = []
afterEach(async () => {
  for (const folder of fixtures.splice(0)) await rm(folder, { recursive: true, force: true })
})

const { structuredClone } = globalThis
const consumers = JSON.parse(await readFile(path.join(root, DESKTOP_CONSUMERS), 'utf8'))
const outputs = await renderDesktop(consumers)

// Lezer tag names from the generated theme, including the mounted forms
// `special(string)` and `function(variableName)`, against the real tags.
function resolveTag(name) {
  const nested = /^(\w+)\((\w+)\)$/.exec(name)
  if (nested === null) {
    if (tags[name] === undefined) throw new Error(`Unknown lezer tag: ${name}`)
    return tags[name]
  }
  const outer = tags[nested[1]]
  const inner = tags[nested[2]]
  if (outer === undefined || inner === undefined) throw new Error(`Unknown lezer tag: ${name}`)
  return outer(inner)
}

// A real streaming grammar through the real parse pipeline: keywords,
// strings and comments land on lezer tags the theme then styles.
const testLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.eat('"')) {
      stream.skipTo('"')
      stream.next()
      return 'string'
    }
    const ch = stream.next()
    if (ch === '/' && stream.eat('/')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (ch !== undefined && /[\w$]/.test(ch)) {
      stream.eatWhile(/[\w$]/)
      return stream.current() === 'const' || stream.current() === 'return' ? 'keyword' : null
    }
    return null
  },
})

function channels(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
}

function luminanceOf(hex) {
  const linear = channels(hex).map((n) =>
    n / 255 <= 0.04045 ? n / 255 / 12.92 : ((n / 255 + 0.055) / 1.055) ** 2.4,
  )
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

describe('M111 TH desktop theme', () => {
  it('proves every desktop pair and ships fresh bytes', async () => {
    expect(checkModelPairs(consumers)).toEqual([])
    const files = {}
    for (const file of Object.keys(outputs)) {
      files[file] = await readFile(path.join(root, file), 'utf8')
    }
    expect(checkDesktopPairs(files)).toEqual([])
    expect(await checkDesktop(root)).toEqual([])
  })

  it('fails a stale or missing output by name without rewriting it', async () => {
    await mkdir(path.join(root, 'temp'), { recursive: true })
    const fixture = await mkdtemp(path.join(root, 'temp/th-desktop-'))
    fixtures.push(fixture)
    await mkdir(path.join(fixture, 'design/tokens/generated'), { recursive: true })
    await writeFile(path.join(fixture, DESKTOP_CONSUMERS), JSON.stringify(consumers))
    for (const [file, content] of Object.entries(outputs)) {
      await mkdir(path.join(fixture, path.dirname(file)), { recursive: true })
      await writeFile(path.join(fixture, file), content)
    }
    expect(await checkDesktop(fixture)).toEqual([])
    const stale = path.join(fixture, 'desktop/shell/theme/palette-dark.css')
    await writeFile(stale, '/* stale */')
    expect(await checkDesktop(fixture)).toContain(
      'Stale desktop token output: desktop/shell/theme/palette-dark.css; run npm run build:tokens:desktop',
    )
    expect(await readFile(stale, 'utf8')).toBe('/* stale */')
    await rm(stale)
    expect(await checkDesktop(fixture)).toContain(
      'Stale desktop token output: desktop/shell/theme/palette-dark.css; run npm run build:tokens:desktop',
    )
  })

  it('fails the pair when a derivation drifts', async () => {
    const broken = structuredClone(consumers)
    broken.modes.dark['colour.danger'].value = {
      colorSpace: 'srgb',
      components: [0.09, 0.09, 0.09],
      alpha: 1,
    }
    const problems = checkDesktopPairs(await renderDesktop(broken))
    expect(problems.some((p) => p.startsWith('dark: xterm/red on xterm/background:'))).toBe(true)
  })

  it('derives the terminal palette from the token hues by the fixed rules', () => {
    for (const mode of DESKTOP_MODES) {
      const theme = ansiTheme(parseConsumers(consumers), mode)
      const hex = Object.fromEntries(
        Object.entries(theme).map(([role, colour]) => [role, emitHex(colour)]),
      )
      const surface = hex.background
      const text = hex.foreground
      const darker = luminanceOf(surface) < luminanceOf(text) ? surface : text
      const lighter = darker === surface ? text : surface
      expect(hex.black).toBe(darker)
      expect(hex.white).toBe(lighter)
      // Cyan mixes info and success half way: every channel between them.
      for (const [i, channel] of channels(hex.cyan).entries()) {
        const [lo, hi] = [channels(hex.blue)[i], channels(hex.green)[i]].toSorted((a, b) => a - b)
        expect(channel).toBeGreaterThanOrEqual(lo)
        expect(channel).toBeLessThanOrEqual(hi)
      }
      // Brights lift their hue toward white; bright black is the muted tone.
      for (const hue of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan']) {
        const bright = `bright${hue[0].toUpperCase()}${hue.slice(1)}`
        expect(luminanceOf(hex[bright])).toBeGreaterThan(luminanceOf(hex[hue]))
      }
      expect(hex.brightBlack).toBe(
        emitHex(resolvedColour(parseConsumers(consumers), mode, 'colour.muted')),
      )
    }
  })

  it('resolves the portal appearance with the override', () => {
    // Mirrors the Rust crate's truth table case for case.
    expect(resolveAppearance(2, 0, 'system')).toBe('light')
    expect(resolveAppearance(2, 1, 'system')).toBe('hc-light')
    expect(resolveAppearance(1, 1, 'system')).toBe('hc-dark')
    expect(resolveAppearance(1, 0, 'system')).toBe('dark')
    expect(resolveAppearance(0, 0, 'system')).toBe('dark')
    expect(resolveAppearance(0, 1, 'system')).toBe('hc-dark')
    expect(resolveAppearance(undefined, undefined, 'system')).toBe('dark')
    expect(resolveAppearance(undefined, 1, 'system')).toBe('hc-dark')
    expect(resolveAppearance(99, 99, 'system')).toBe('dark')
    for (const override of ['light', 'dark', 'hc-light', 'hc-dark']) {
      expect(resolveAppearance(2, 1, override)).toBe(override)
      expect(resolveAppearance(undefined, undefined, override)).toBe(override)
    }
    expect(resolveAppearance(2, 0, 'bogus')).toBe('light')
    expect(resolveAppearance(undefined, undefined, '')).toBe('dark')
  })

  it('builds the Hyprland table against lane 0’s TILING contract', () => {
    const parsed = parseConsumers(consumers)
    expect(parsed.modes.dark[HYPR_TOKEN_NAMES.windowCorner].variable).toBe(TILING.windowCorner)
    expect(parsed.modes.dark[HYPR_TOKEN_NAMES.innerGap].variable).toBe(TILING.innerGap)
    expect(parsed.modes.dark[HYPR_TOKEN_NAMES.outerGap].variable).toBe(TILING.outerGap)
    expect(parsed.modes.dark[HYPR_TOKEN_NAMES.focusedBorder].variable).toBe(TILING.focusedBorder)
    expect(parsed.modes.dark[HYPR_TOKEN_NAMES.focusedBorderWidth].variable).toBe(
      TILING.focusedBorderWidth,
    )
    for (const mode of DESKTOP_MODES) {
      const model = hyprModel(parsed, mode)
      expect(model.smartGapsAlone).toBe(TILING.smartGapsAlone)
      expect(model.detachedTerminal).toBe(TILING.detachedTerminal)
      expect(model.innerGapPx).toBe(4)
      expect(model.outerGapPx).toBe(8)
      expect(model.roundingPx).toBe(12)
      expect(model.borderWidthPx).toBe(2)
    }
  })

  it('resolves every palette variable to a concrete value', () => {
    const parsed = parseConsumers(consumers)
    for (const mode of DESKTOP_MODES) {
      const names = Object.keys(parsed.modes[mode])
      for (const name of names) {
        const css = resolveCss(parsed, mode, name)
        expect(css).not.toContain('var(')
        expect(css).not.toContain('color-mix(')
      }
      // The scrim keeps the surface hue at 55% alpha; the column inset keeps
      // its viewport shape with literals substituted.
      const scrim = resolveCss(parsed, mode, 'colour.modal-scrim')
      const surface = emitHex(resolvedColour(parsed, mode, 'colour.surface'))
      if (mode.startsWith('hc')) {
        expect(scrim).toBe(surface)
      } else {
        expect(scrim.slice(0, 7)).toBe(surface)
        expect(scrim).toMatch(/^#[0-9a-f]{8}$/)
      }
      expect(resolveCss(parsed, mode, 'layout.column-inset')).toContain('100cqw')
    }
  })

  it('fails an unknown formula loudly instead of emitting a guess', () => {
    const broken = structuredClone(consumers)
    broken.modes.dark['colour.text'].css = 'color-mix(in srgb, red 50%, blue)'
    expect(() => resolveCss(parseConsumers(broken), 'dark', 'colour.text')).toThrow(
      'Desktop colour is not a hex literal',
    )
    const skewed = structuredClone(consumers)
    skewed.version = 2
    expect(() => parseConsumers(skewed)).toThrow()
    const anchorless = structuredClone(consumers)
    anchorless.modes.dark['colour.qr-field'].value.components = [0.5, 0.5, 0.5]
    expect(() => ansiTheme(parseConsumers(anchorless), 'dark')).toThrow('ANSI anchor is not pure')
  })

  it('loads every generated xterm theme into a real terminal', async () => {
    // The ITheme keys of @xterm/xterm 6.0.0 (typings/xterm.d.ts): every key
    // we emit must be one a real terminal reads.
    const themeKeys = new Set([
      'foreground',
      'background',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'selectionForeground',
      'selectionInactiveBackground',
      'scrollbarSliderBackground',
      'scrollbarSliderHoverBackground',
      'scrollbarSliderActiveBackground',
      'overviewRulerBorder',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
      'extendedAnsi',
    ])
    for (const mode of DESKTOP_MODES) {
      const theme = JSON.parse(await readTheme(`xterm-${mode}.json`))
      for (const key of Object.keys(theme)) expect(themeKeys.has(key)).toBe(true)
      expect(Object.keys(theme)).toHaveLength(24)
      const terminal = new Terminal({ theme, cols: 80, rows: 24, allowProposedApi: true })
      try {
        expect(terminal.options.theme.background).toBe(theme.background)
        expect(terminal.options.theme.foreground).toBe(theme.foreground)
        expect(terminal.options.theme.brightMagenta).toBe(theme.brightMagenta)
        await new Promise((done) => {
          terminal.write('muse\r\n\u{1B}[35mmagenta\u{1B}[0m', done)
        })
        expect(terminal.buffer.active.getLine(0).translateToString(true)).toContain('muse')
      } finally {
        terminal.dispose()
      }
    }
  })

  it('highlights code with the generated editor theme in real CodeMirror', async () => {
    for (const mode of DESKTOP_MODES) {
      const theme = JSON.parse(await readTheme(`codemirror-${mode}.json`))
      expect(theme.mode).toBe(mode)
      const style = HighlightStyle.define(
        CM_HIGHLIGHT.map((rule) => ({
          tag: rule.tags.map((tag) => resolveTag(tag)),
          color: theme.roles[rule.role],
          ...(rule.fontStyle !== undefined && { fontStyle: rule.fontStyle }),
        })),
      )
      const doc = 'const greeting = "hello"; // note'
      const state = EditorState.create({
        doc,
        extensions: [testLanguage, syntaxHighlighting(style)],
      })
      const tree = syntaxTree(state)
      expect(tree.length).toBe(doc.length)
      const painted = []
      highlightTree(tree, style, (from, to, classes) => {
        painted.push([doc.slice(from, to), classes])
      })
      const classFor = (text) => painted.find(([word]) => word === text)[1]
      // The highlighter maps tags to classes; the style module maps classes
      // to the CSS CodeMirror injects. Both are the real pipeline.
      const colorFor = (classes) => {
        const [primary] = classes.split(' ', 1)
        const rule = style.module.rules.find((r) => r.startsWith(`.${primary} `))
        return /color: ([^;]+);/.exec(rule)[1]
      }
      expect(style.style([tags.keyword])).toBe(classFor('const'))
      expect(colorFor(classFor('const'))).toBe(theme.roles.syntaxKeyword)
      expect(colorFor(classFor('"hello"'))).toBe(theme.roles.syntaxString)
      expect(colorFor(classFor('// note'))).toBe(theme.roles.muted)
    }
  })

  it('emits CodeMirror roles identical to the editor tokens', async () => {
    const parsed = parseConsumers(consumers)
    for (const mode of DESKTOP_MODES) {
      expect(JSON.parse(renderCodeMirror(parsed, mode)).roles).toEqual(cmTheme(parsed, mode))
      expect(JSON.parse(await readTheme(`codemirror-${mode}.json`)).roles).toEqual(
        cmTheme(parsed, mode),
      )
    }
  })

  it('carries every token into QML, Rust and Lua with identical values', () => {
    const parsed = parseConsumers(consumers)
    const qml = renderQml(parsed)
    expect(qml).toContain('pragma Singleton')
    expect(qml).toContain('readonly property string resolvedMode')
    for (const mode of DESKTOP_MODES) {
      const surface = emitHex(resolvedColour(parsed, mode, 'colour.surface'))
      expect(qml).toContain(`surface: ${JSON.stringify(surface)}`)
    }
    const rust = renderRust(parsed)
    expect(rust).toContain('pub struct Shadow')
    expect(rust).toContain('pub const SURFACE_DARK: u32 = 0xFF18_1818;')
    const lua = renderLua(parsed)
    expect(lua).toContain('detachedTerminal = "floating"')
    expect(lua).toContain('innerGap = 4')
  })

  it('emits the viewport geometry as functions, never a silent zero', () => {
    const parsed = parseConsumers(consumers)
    const qml = renderQml(parsed)
    expect(qml).toContain('function columnInsetFor(width)')
    expect(qml).toContain('function columnGutterFor(width)')
    expect(qml).not.toContain('columnInset:')
    const rust = renderRust(parsed)
    expect(rust).toContain('pub const fn column_inset(viewport_px: u32) -> u32')
    expect(rust).toContain('pub const fn column_gutter(viewport_px: u32) -> u32')
    expect(rust).not.toContain('COLUMN_INSET')
  })

  it('fails loudly when a viewport formula changes shape', () => {
    const reshaped = structuredClone(consumers)
    reshaped.modes.dark['layout.column-inset'].css = 'max(0px, (100cqw - 760px) / 2)'
    expect(() => renderQml(parseConsumers(reshaped))).toThrow(
      'Viewport formula changed shape: layout.column-inset in dark',
    )
    expect(() => renderRust(parseConsumers(reshaped))).toThrow(
      'Viewport formula changed shape: layout.column-inset in dark',
    )
  })

  it('refuses a QML property collision instead of shadowing a token', () => {
    const doubled = structuredClone(consumers)
    for (const mode of DESKTOP_MODES) {
      doubled.modes[mode]['colour.dupe'] = {
        type: 'color',
        value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1 },
        css: '#000000',
        variable: '--ms-space4',
      }
      doubled.modes[mode]['spacing.dupe'] = {
        type: 'dimension',
        value: { value: 4, unit: 'px' },
        css: '4px',
        variable: '--ms-space-4',
      }
    }
    // --ms-space4 and --ms-space-4 both camel to space4.
    expect(() => renderQml(parseConsumers(doubled))).toThrow('QML property collision: space4')
  })

  it('keeps provenance honest on every boot, wallpaper, pointer and icon value', async () => {
    const parsed = parseConsumers(consumers)
    const boot = JSON.parse(await readTheme('boot/boot.json')).dark
    for (const entry of Object.values(boot)) {
      expect(entry.value).toBe(emitHex(resolvedColour(parsed, 'dark', entry.token)))
    }
    for (const file of ['wallpapers.json', 'pointer.json', 'icons.json']) {
      const palettes = JSON.parse(await readTheme(file)).modes
      for (const mode of DESKTOP_MODES) {
        const entries = Object.values(palettes[mode])
        for (const entry of entries) {
          expect(entry.value).toBe(emitHex(resolvedColour(parsed, mode, entry.token)))
        }
      }
    }
  })

  it('writes boot pixels that decode to the token colours', async () => {
    const parsed = parseConsumers(consumers)
    expect(pngPixel(0x30, 0x36, 0x42).equals(pngPixel(0x30, 0x36, 0x42))).toBe(true)
    for (const [file, role] of [
      ['desktop/shell/theme/boot/progress-track.png', 'progressTrack'],
      ['desktop/shell/theme/boot/progress-fill.png', 'progressFill'],
    ]) {
      expect(DESKTOP_BINARY_OUTPUTS.has(file)).toBe(true)
      const bytes = await readFile(path.join(root, file))
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      let offset = 8
      let idat
      while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset)
        const type = bytes.subarray(offset + 4, offset + 8).toString()
        if (type === 'IDAT') idat = bytes.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length
      }
      const pixel = [...inflateSync(idat)]
      const token = role === 'progressTrack' ? 'colour.hover' : 'colour.brand-mark'
      const hex = emitHex(resolvedColour(parsed, 'dark', token))
      expect(pixel).toEqual([
        0,
        Number.parseInt(hex.slice(1, 3), 16),
        Number.parseInt(hex.slice(3, 5), 16),
        Number.parseInt(hex.slice(5, 7), 16),
      ])
    }
  })

  it('drives Plymouth through its verified script API only', () => {
    const script = renderPlymouth(parseConsumers(consumers))
    for (const call of [
      'Window.SetBackgroundTopColor',
      'Window.SetBackgroundBottomColor',
      '.SetX (',
      '.SetY (',
      '.SetZ (',
      '.Scale (',
      '.Crop (',
      '.SetImage (',
      'Math.Int (',
      'Plymouth.SetBootProgressFunction',
      'Plymouth.SetDisplayMessageFunction',
    ]) {
      expect(script).toContain(call)
    }
    // The trailing space distinguishes the wrong SetMessageFunction from the
    // right SetDisplayMessageFunction.
    for (const missing of ['SetPosition', 'SetClip', 'Image.Rectangle', 'SetMessageFunction (']) {
      expect(script).not.toContain(missing)
    }
  })

  it('agrees with the WCAG reference math on black, white and grey', () => {
    const grey = { colorSpace: 'srgb', components: [0.5, 0.5, 0.5], alpha: 1 }
    const black = { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1 }
    const white = { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1 }
    expect(contrastRatio(black, white)).toBeCloseTo(21)
    expect(contrastRatio(grey, white)).toBeCloseTo(3.97665)
    expect(
      contrastRatio({ colorSpace: 'oklch', components: [0, 0, 0], alpha: 1 }, white),
    ).toBeCloseTo(21)
  })

  it('renders the xterm and palette emitters byte-identical to the files', async () => {
    const parsed = parseConsumers(consumers)
    for (const mode of DESKTOP_MODES) {
      expect(outputs[`desktop/shell/theme/xterm-${mode}.json`]).toBe(
        await readTheme(`xterm-${mode}.json`),
      )
      expect(outputs[`desktop/shell/theme/palette-${mode}.css`]).toBe(
        await readTheme(`palette-${mode}.css`),
      )
      expect(renderXterm(parsed, mode)).toBe(
        JSON.stringify(JSON.parse(await readTheme(`xterm-${mode}.json`))),
      )
      const surface = emitHex(resolvedColour(parsed, mode, 'colour.surface'))
      expect(renderPaletteCss(parsed, mode)).toContain(`--ms-surface: ${surface};`)
    }
  })
})
