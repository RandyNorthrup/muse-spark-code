// TD: the TUI design system. Decision tables pin capabilities, known
// answers pin the 256 mapping, and goldens pin the exact terminal bytes
// per tier at both sizes. Regenerate goldens only deliberately, after
// reviewing the rendered diff:
//   UPDATE_TUI_GOLDENS=1 npx vitest run test/unit/tuiDesign.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detectCapabilities,
  resolveCapabilities,
  resolveColorTier,
  resolveThemeMode,
  type TuiColorTier,
  type TuiThemeMode,
} from '../../src/runtime/tui/design/capabilities'
import { brandArt, brandArtSize } from '../../src/runtime/tui/design/art'
import { parseTuiArgs } from '../../src/runtime/tui/args'
import { progressBar, splashFrames, spinnerFrame } from '../../src/runtime/tui/design/motion'
import { resolvePalette, rgbToAnsi256, tuiMotionMs } from '../../src/runtime/tui/design/palette'
import { UI_TEXT } from '../../src/shared/constants'
import { clipSgr, paint, paintBold, sgrFor } from '../../src/runtime/tui/design/theme'
import { harnessInk, renderTui } from '../harness/tui/renderer'
import { TUI_SCENES, type TuiGoldenScene } from '../harness/tui/scenes'

const GOLDENS = path.resolve('test/harness/tui/goldens')
const ART = path.resolve('design/tui/art')
const TIERS: readonly TuiColorTier[] = ['truecolor', 'c256', 'sixteen', 'plain']
const SIZES = [
  { columns: 80, rows: 24 },
  { columns: 120, rows: 40 },
] as const

describe('TUI capability tiers', () => {
  it.each([
    [{ noColor: true, env: {}, termColors: 256 }, 'plain'],
    [{ noColor: false, env: { COLORTERM: 'truecolor' }, termColors: 8 }, 'truecolor'],
    [{ noColor: false, env: { COLORTERM: '24bit' }, termColors: null }, 'truecolor'],
    [{ noColor: false, env: { WT_SESSION: 'x' }, termColors: null }, 'truecolor'],
    [{ noColor: false, env: {}, termColors: 256 }, 'c256'],
    [{ noColor: false, env: {}, termColors: 88 }, 'sixteen'],
    [{ noColor: false, env: {}, termColors: 8 }, 'sixteen'],
    [{ noColor: false, env: {}, termColors: 2 }, 'plain'],
    [{ noColor: false, env: { TERM: 'xterm-256color' }, termColors: null }, 'c256'],
    [{ noColor: false, env: { TERM: 'xterm' }, termColors: null }, 'sixteen'],
    [{ noColor: false, env: { TERM: 'dumb' }, termColors: null }, 'plain'],
    [{ noColor: false, env: {}, termColors: null }, 'plain'],
  ] as const)('tier %j resolves %s', (inputs, tier) => {
    expect(resolveColorTier(inputs)).toBe(tier)
  })

  it.each([
    [{ env: { MUSE_TUI_THEME: 'light' }, macTheme: 'dark' }, 'light'],
    [{ env: { MUSE_TUI_THEME: 'DARK' }, macTheme: 'light' }, 'dark'],
    [{ env: { MUSE_TUI_THEME: 'nope' }, macTheme: 'light' }, 'light'],
    [{ env: {}, macTheme: 'light' }, 'light'],
    [{ env: {}, macTheme: null }, 'dark'],
  ] as const)('theme %j resolves %s', (inputs, mode) => {
    expect(resolveThemeMode(inputs)).toBe(mode)
  })

  it('prefers reduced motion from the flag or the system, and plain text by default', () => {
    const base = {
      noColor: false,
      nerdFont: false,
      env: {},
      termColors: 256 as number | null,
      macTheme: null as TuiThemeMode | null,
    }
    expect(
      resolveCapabilities({ ...base, reducedMotion: false, macReducedMotion: null }).motion,
    ).toBe(true)
    expect(
      resolveCapabilities({ ...base, reducedMotion: true, macReducedMotion: null }).motion,
    ).toBe(false)
    expect(
      resolveCapabilities({ ...base, reducedMotion: false, macReducedMotion: true }).motion,
    ).toBe(false)
    expect(
      resolveCapabilities({ ...base, reducedMotion: false, macReducedMotion: null }).nerdFont,
    ).toBe(false)
    expect(
      resolveCapabilities({
        ...base,
        nerdFont: true,
        reducedMotion: false,
        macReducedMotion: null,
      }).nerdFont,
    ).toBe(true)
  })

  it('probes tput and the macOS settings, degrading on silence', async () => {
    const calls: string[][] = []
    const exec = (file: string, args: readonly string[]) => {
      calls.push([file, ...args])
      if (file === 'tput') return Promise.resolve({ stdout: '256\n' })
      if (args.includes('AppleInterfaceStyle')) return Promise.resolve({ stdout: 'Dark\n' })
      return Promise.resolve(args.includes('reduceMotion') ? { stdout: '0\n' } : null)
    }
    const found = await detectCapabilities({
      noColor: false,
      reducedMotion: false,
      nerdFont: false,
      env: { TERM: 'xterm-256color' },
      platform: 'darwin',
      exec,
    })
    expect(found).toEqual({ tier: 'c256', theme: 'dark', motion: true, nerdFont: false })
    expect(calls).toContainEqual(['tput', 'colors'])

    const silent = await detectCapabilities({
      noColor: false,
      reducedMotion: false,
      nerdFont: false,
      env: { TERM: 'xterm' },
      platform: 'linux',
      exec: () => Promise.resolve(null),
    })
    expect(silent).toEqual({ tier: 'sixteen', theme: 'dark', motion: true, nerdFont: false })
  })

  it('detects this machine without throwing', async () => {
    const found = await detectCapabilities({
      noColor: false,
      reducedMotion: false,
      nerdFont: false,
      env: process.env,
      platform: process.platform,
    })
    expect(['truecolor', 'c256', 'sixteen', 'plain']).toContain(found.tier)
    expect(['dark', 'light']).toContain(found.theme)
  })
})

describe('TUI palette', () => {
  it.each([
    [255, 0, 0, 196],
    [0, 255, 0, 46],
    [0, 0, 255, 21],
    [255, 255, 255, 231],
    [0, 0, 0, 16],
    [128, 128, 128, 244],
    [61, 139, 255, 69],
  ] as const)('rgb(%i, %i, %i) maps to ANSI %i', (r, g, b, index) => {
    expect(rgbToAnsi256(r, g, b)).toBe(index)
  })

  it('resolves every role from the tokens in both themes', () => {
    for (const mode of ['dark', 'light'] as const) {
      const palette = resolvePalette(mode)
      expect(Object.keys(palette)).toHaveLength(10)
      for (const color of Object.values(palette)) {
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/)
        expect(color.ansi256).toBeGreaterThanOrEqual(0)
        expect(color.ansi256).toBeLessThanOrEqual(255)
      }
    }
    expect(resolvePalette('dark').brand.hex).toBe('#3d8bff')
    expect(resolvePalette('light').brand.hex).toBe('#0a5cff')
    expect(resolvePalette('dark').brand.ansi16).toBe('blueBright')
    expect(resolvePalette('dark').accent.ansi16).toBe('blue')
    expect(tuiMotionMs()).toEqual({ splashFrameMs: 180, progressFrameMs: 120 })
  })

  it.each([
    ['truecolor', 'dark', 'brand', '\u{1B}[38;2;61;139;255m'],
    ['c256', 'dark', 'brand', '\u{1B}[38;5;69m'],
    ['sixteen', 'dark', 'brand', '\u{1B}[94m'],
    ['sixteen', 'light', 'danger', '\u{1B}[31m'],
  ] as const)('%s %s %s opens %j', (tier, mode, role, open) => {
    expect(sgrFor(tier, mode, role)?.open).toBe(open)
    expect(sgrFor(tier, mode, role)?.close).toBe('\u{1B}[39m')
  })

  it('paints nothing plain', () => {
    expect(sgrFor('plain', 'dark', 'brand')).toBeUndefined()
  })
})

describe('TUI paint and clip', () => {
  const theme = { tier: 'truecolor', mode: 'dark' } as const
  const ESC = String.fromCodePoint(27)

  it('wraps text in the role SGR, or leaves it bare when plain', () => {
    const sgr = sgrFor('truecolor', 'dark', 'warning')
    expect(sgr).toBeDefined()
    if (sgr === undefined) throw new Error('warning SGR is missing')
    expect(paint(theme, 'warning', 'hey')).toBe(`${sgr.open}hey${sgr.close}`)
    expect(paint({ tier: 'plain', mode: 'dark' }, 'warning', 'hey')).toBe('hey')
    const accent = sgrFor('truecolor', 'dark', 'accent')
    if (accent === undefined) throw new Error('accent SGR is missing')
    expect(paintBold(theme, 'accent', 'hey')).toBe(
      `${ESC}[1m${accent.open}hey${accent.close}${ESC}[22m`,
    )
    expect(paintBold({ tier: 'plain', mode: 'dark' }, 'accent', 'hey')).toBe(
      `${ESC}[1mhey${ESC}[22m`,
    )
  })

  it('clips painted text without tearing spans', () => {
    const warn = (text: string) => paint(theme, 'warning', text)
    expect(clipSgr(warn('hello'), 5)).toBe(warn('hello'))
    expect(clipSgr(warn('hello world'), 5)).toBe(warn('hello'))
    expect(clipSgr('hello', 5)).toBe('hello')
    expect(clipSgr('hello world', 5)).toBe('hello')
    expect(clipSgr('あいう', 4)).toBe('あい')
    const sgr = sgrFor('truecolor', 'dark', 'warning')
    if (sgr === undefined) throw new Error('warning SGR is missing')
    expect(clipSgr(paintBold(theme, 'warning', 'hello world'), 5)).toBe(
      `${ESC}[1m${sgr.open}hello${sgr.close}${ESC}[22m`,
    )
  })

  it('fails red on SGR it never emits', () => {
    expect(() => clipSgr(`${ESC}[31mred`, 2)).toThrow('unhandled SGR')
  })
})

describe('TUI brand art', () => {
  it('sizes the marks for centred layouts', () => {
    expect(brandArtSize('squiggle')).toEqual({ columns: 44, rows: 12 })
    expect(brandArtSize('squiggle-mini')).toEqual({ columns: 22, rows: 6 })
  })

  it('colors the blocks per tier and keeps ASCII bare', () => {
    const colored = brandArt('squiggle-mini', 'truecolor', 'dark', true)
    expect(colored.some((line) => line.includes('\u{1B}[38;2;61;139;255m'))).toBe(true)
    const indexed = brandArt('squiggle-mini', 'c256', 'dark', true)
    expect(indexed.some((line) => line.includes('\u{1B}[38;5;69m'))).toBe(true)
    const sixteen = brandArt('squiggle-mini', 'sixteen', 'dark', true)
    expect(sixteen.some((line) => line.includes('\u{1B}[94m'))).toBe(true)
    const plain = brandArt('squiggle-mini', 'plain', 'dark', true)
    expect(plain.join('\n')).not.toContain('\u{1B}')
    expect(/^[\u{20}-\u{7E}\n]*$/u.test(plain.join('\n'))).toBe(true)
  })

  it('falls back to the colored ASCII twin without a Nerd Font', () => {
    const safe = brandArt('squiggle-mini', 'truecolor', 'dark', false)
    expect(safe.some((line) => line.includes('▗'))).toBe(false)
    expect(safe.some((line) => line.includes('#'))).toBe(true)
    expect(safe.some((line) => line.includes('\u{1B}[38;2;61;139;255m'))).toBe(true)
    const bare = brandArt('squiggle-mini', 'plain', 'dark', false)
    expect(bare.join('')).not.toContain('\u{1B}')
  })

  it('keeps the generated module fresh with its sources', async () => {
    const generated = await import('../../design/tui/art.generated')
    for (const [name, blocks, ascii] of [
      ['squiggle', generated.TUI_SQUIGGLE_BLOCKS, generated.TUI_SQUIGGLE_ASCII],
      ['squiggle-mini', generated.TUI_SQUIGGLE_MINI_BLOCKS, generated.TUI_SQUIGGLE_MINI_ASCII],
    ] as const) {
      const ans = readFileSync(path.join(ART, `${name}.ans`), 'utf8')
        .replaceAll(new RegExp(String.fromCodePoint(27) + String.raw`\[[0-9;]*m`, 'gu'), '')
        .split('\n')
      ans.pop()
      expect([...blocks]).toEqual(ans)
      const txt = readFileSync(path.join(ART, `${name}.txt`), 'utf8').split('\n')
      txt.pop()
      expect([...ascii]).toEqual(txt)
    }
  })

  it('holds no sparkle in the art files', () => {
    // U+2726-U+2729 are the four-point sparkle family; a star that is not
    // the brand never reaches the terminal.
    const sparkle = /[✦-✩]/u
    for (const file of ['squiggle.ans', 'squiggle.txt', 'squiggle-mini.ans', 'squiggle-mini.txt']) {
      expect(readFileSync(path.join(ART, file), 'utf8')).not.toMatch(sparkle)
    }
  })
})

describe('TUI motion', () => {
  it('cycles the spinner and fills the bar by the book', () => {
    expect(spinnerFrame(0, false)).toBe('▁')
    expect(spinnerFrame(6, false)).toBe('█')
    expect(spinnerFrame(12, false)).toBe('▁')
    expect(spinnerFrame(0, true)).toBe('|')
    expect(spinnerFrame(4, true)).toBe('|')
    expect(progressBar(10, 0.6, false)).toBe('██████░░░░')
    expect(progressBar(4, 0, true)).toBe('....')
    expect(progressBar(4, 2, true)).toBe('####')
    expect(progressBar(4, -1, true)).toBe('....')
  })

  it('reveals the splash top-down, or holds it still', () => {
    const art = ['a', 'b', 'c']
    const frames = splashFrames(art, false)
    expect(frames).toEqual([['a'], ['a', 'b'], ['a', 'b', 'c']])
    expect(splashFrames(art, true)).toEqual([art])
  })
})

describe('TUI flags', () => {
  it('parses the motion and font options, absent unless passed', () => {
    const plain = parseTuiArgs([], {})
    const flagged = parseTuiArgs(['--reduced-motion', '--nerd-font'], {})
    expect(plain.ok).toBe(true)
    expect(flagged.ok).toBe(true)
    if (plain.ok) {
      expect(plain.options.reducedMotion).toBeUndefined()
      expect(plain.options.nerdFont).toBeUndefined()
    }
    if (flagged.ok) {
      expect(flagged.options.reducedMotion).toBe(true)
      expect(flagged.options.nerdFont).toBe(true)
    }
    expect(UI_TEXT.tuiUsage).toContain('--reduced-motion')
    expect(UI_TEXT.tuiUsage).toContain('--nerd-font')
  })
})

describe('TUI goldens', () => {
  const shouldUpdate = process.env['UPDATE_TUI_GOLDENS'] === '1'
  const isLightOnly = process.env['TUI_GOLDEN_MODES'] === 'light'
  const modesFor = (scene: TuiGoldenScene): { mode: TuiThemeMode; suffix: string }[] => {
    if (isLightOnly) return [{ mode: 'light', suffix: '-light' }]
    if (!scene.light) return [{ mode: 'dark', suffix: '' }]
    return [
      { mode: 'dark', suffix: '' },
      { mode: 'light', suffix: '-light' },
    ]
  }
  for (const scene of TUI_SCENES) {
    for (const size of SIZES) {
      const tiers = scene.reader ? (['plain'] as const) : TIERS
      for (const tier of tiers) {
        for (const { mode, suffix } of modesFor(scene)) {
          const name = scene.reader
            ? `reader-${String(size.columns)}x${String(size.rows)}`
            : `${tier}-${String(size.columns)}x${String(size.rows)}${suffix}`
          it(`${scene.name} ${name}`, () => {
            const element = scene.element({
              ink: harnessInk,
              columns: size.columns,
              tier,
              mode,
            })
            const bytes = renderTui(element, { columns: size.columns, rows: size.rows })
            const file = path.join(GOLDENS, scene.name, `${name}.ans`)
            if (shouldUpdate || !existsSync(file)) {
              mkdirSync(path.dirname(file), { recursive: true })
              writeFileSync(file, `${bytes}\n`)
            }
            expect(bytes).toBe(readFileSync(file, 'utf8').replace(/\n$/, ''))
          })
        }
      }
    }
  }

  it('runs dark always, light for the light scenes or the light pass', () => {
    for (const scene of TUI_SCENES) {
      const modes = modesFor(scene)
      if (isLightOnly) {
        expect(modes).toEqual([{ mode: 'light', suffix: '-light' }])
      } else if (scene.light) {
        expect(modes).toHaveLength(2)
      } else {
        expect(modes).toEqual([{ mode: 'dark', suffix: '' }])
      }
    }
  })

  it('re-seats colour on wrapped log lines', () => {
    const scene = TUI_SCENES.find((entry) => entry.name === 'bottom')
    if (scene === undefined) throw new Error('bottom scene is missing')
    const frame = renderTui(
      scene.element({ ink: harnessInk, columns: 80, tier: 'truecolor', mode: 'dark' }),
      { columns: 80, rows: 24 },
    )
    const open = sgrFor('truecolor', 'dark', 'warning')?.open
    expect(open).toBeDefined()
    const lines = frame.split('\n')
    expect(lines.length).toBeGreaterThan(4)
    for (const line of lines) {
      if (line.includes('--reporter') || line.includes('--fail-fast')) expect(line).toContain(open)
    }
  })

  it('regenerates byte-identical goldens', () => {
    // The suite itself is deterministic: two renders of the everything
    // scene agree byte for byte.
    const scene = TUI_SCENES.find((entry) => entry.name === 'panel')
    if (scene === undefined) throw new Error('panel scene is missing')
    const render = () =>
      renderTui(scene.element({ ink: harnessInk, columns: 80, tier: 'truecolor', mode: 'dark' }), {
        columns: 80,
        rows: 24,
      })
    expect(render()).toBe(render())
  })

  it('keeps tput honest on this machine', () => {
    // The probe this suite trusts: tput answers a count for a sane TERM.
    try {
      const colors = execFileSync('tput', ['colors'], {
        env: { ...process.env, TERM: 'xterm-256color' },
        timeout: 5000,
      })
        .toString()
        .trim()
      expect(Number(colors)).toBe(256)
    } catch {
      // No tput here (notably Windows): the null probe covers it, and the
      // decision table pins the fallback.
      expect(process.platform).toBe('win32')
    }
  })
})
