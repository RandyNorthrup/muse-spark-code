import { z } from 'zod'
import {
  TUI_ANSI256_CUBE_GREEN,
  TUI_ANSI256_CUBE_LEVELS,
  TUI_ANSI256_CUBE_OFFSET,
  TUI_ANSI256_CUBE_RED,
  TUI_ANSI256_GRAY_BASE,
  TUI_ANSI256_GRAY_LEVELS,
  TUI_ANSI256_GRAY_OFFSET,
  TUI_ANSI256_GRAY_STEP,
  TUI_ANSI256_VGA,
  TUI_CHANNEL_LEVELS,
  TUI_CHANNEL_MAX,
  TUI_REDMEAN_GREEN_WEIGHT,
} from '../../../shared/constants'
import generated from '../../../../design/tokens/generated/tui-palette.json'

const tuiPaletteSchema = z.strictObject({
  version: z.literal(1),
  roles: z.strictObject({
    text: z.strictObject({ dark: z.string(), light: z.string() }),
    muted: z.strictObject({ dark: z.string(), light: z.string() }),
    border: z.strictObject({ dark: z.string(), light: z.string() }),
    brand: z.strictObject({ dark: z.string(), light: z.string() }),
    accent: z.strictObject({ dark: z.string(), light: z.string() }),
    selection: z.strictObject({ dark: z.string(), light: z.string() }),
    success: z.strictObject({ dark: z.string(), light: z.string() }),
    warning: z.strictObject({ dark: z.string(), light: z.string() }),
    danger: z.strictObject({ dark: z.string(), light: z.string() }),
    info: z.strictObject({ dark: z.string(), light: z.string() }),
  }),
  motion: z.strictObject({ splashFrameMs: z.number(), progressFrameMs: z.number() }),
})

export type TuiRole = keyof typeof tuiPaletteSchema.shape.roles.shape

export type TuiThemeMode = 'dark' | 'light'

export type TuiAnsi16 =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'redBright'
  | 'greenBright'
  | 'yellowBright'
  | 'blueBright'
  | 'magentaBright'
  | 'cyanBright'
  | 'whiteBright'

export const TUI_ANSI16_CODES: Record<TuiAnsi16, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  redBright: 91,
  greenBright: 92,
  yellowBright: 93,
  blueBright: 94,
  magentaBright: 95,
  cyanBright: 96,
  whiteBright: 97,
}

/** The sixteen colours, hand-picked per role and theme so relative
luminance survives: the brand stays brighter than the accent in the dark,
and both land on the same deep blue in the light, as the tokens do. */
const TUI_ANSI16: Record<TuiThemeMode, Record<TuiRole, TuiAnsi16>> = {
  dark: {
    text: 'white',
    muted: 'gray',
    border: 'gray',
    brand: 'blueBright',
    accent: 'blue',
    selection: 'blue',
    success: 'green',
    warning: 'yellow',
    danger: 'redBright',
    info: 'cyan',
  },
  light: {
    text: 'black',
    muted: 'gray',
    border: 'gray',
    brand: 'blue',
    accent: 'blue',
    selection: 'blue',
    success: 'green',
    warning: 'yellow',
    danger: 'red',
    info: 'cyan',
  },
}

export interface TuiTierColor {
  readonly hex: string
  readonly rgb: readonly [number, number, number]
  readonly ansi256: number
  readonly ansi16: TuiAnsi16
}

const HEX_RADIX = 16
const HEX_TRIPLE = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/u

function hexToRgb(hex: string): readonly [number, number, number] | undefined {
  const match = HEX_TRIPLE.exec(hex)
  if (match === null) return undefined
  const [, r = '', g = '', b = ''] = match
  return [
    Number.parseInt(r, HEX_RADIX),
    Number.parseInt(g, HEX_RADIX),
    Number.parseInt(b, HEX_RADIX),
  ]
}

/** Redmean distance: close enough to perception for a fixed palette. */
function redmean(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const red = (r1 + r2) / 2
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return (
    (2 + red / TUI_CHANNEL_LEVELS) * dr * dr +
    TUI_REDMEAN_GREEN_WEIGHT * dg * dg +
    (2 + (TUI_CHANNEL_MAX - red) / TUI_CHANNEL_LEVELS) * db * db
  )
}

const RGB_CHANNELS = 3

/** The nearest 256-palette index for an sRGB triple: the colour cube,
the grey ramp and the sixteen VGA defaults compete by redmean. */
export function rgbToAnsi256(r: number, g: number, b: number): number {
  const levels = TUI_ANSI256_CUBE_LEVELS
  const nearest = (value: number): number => {
    let level = 0
    for (let i = 1; i < levels.length; i += 1) {
      const edge = levels[i]
      const prev = levels[i - 1]
      if (edge === undefined || prev === undefined) continue
      if (Math.abs(value - edge) < Math.abs(value - prev)) level = i
    }
    return level
  }
  const [ri, gi, bi] = [nearest(r), nearest(g), nearest(b)]
  const cube =
    TUI_ANSI256_CUBE_OFFSET + TUI_ANSI256_CUBE_RED * ri + TUI_ANSI256_CUBE_GREEN * gi + bi
  const grayMix = Math.round((r + g + b) / RGB_CHANNELS)
  const grayStep = Math.max(
    0,
    Math.min(
      TUI_ANSI256_GRAY_LEVELS - 1,
      Math.round((grayMix - TUI_ANSI256_GRAY_BASE) / TUI_ANSI256_GRAY_STEP),
    ),
  )
  const gray = TUI_ANSI256_GRAY_OFFSET + grayStep
  const grayLevel = TUI_ANSI256_GRAY_BASE + TUI_ANSI256_GRAY_STEP * grayStep
  const candidates: { index: number; rgb: readonly [number, number, number] }[] = [
    {
      index: cube,
      rgb: [levels[ri] ?? 0, levels[gi] ?? 0, levels[bi] ?? 0] as const,
    },
    { index: gray, rgb: [grayLevel, grayLevel, grayLevel] as const },
    ...TUI_ANSI256_VGA.map((rgb, index) => ({ index, rgb })),
  ]
  let best = candidates[0]
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = redmean(r, g, b, candidate.rgb[0], candidate.rgb[1], candidate.rgb[2])
    if (distance >= bestDistance) continue
    bestDistance = distance
    best = candidate
  }
  return best?.index ?? 0
}

/** Every role in every tier, from the generated token table. */
export function resolvePalette(theme: TuiThemeMode): Record<TuiRole, TuiTierColor> {
  const parsed = tuiPaletteSchema.parse(generated)
  const roles = parsed.roles as Record<TuiRole, { dark: string; light: string }>
  return Object.fromEntries(
    (Object.keys(roles) as TuiRole[]).map((role) => {
      const hex = roles[role][theme]
      const rgb = hexToRgb(hex)
      if (rgb === undefined) throw new Error(`invalid TUI hex for role ${role}: ${hex}`)
      const [r, g, b] = rgb
      return [role, { hex, rgb, ansi256: rgbToAnsi256(r, g, b), ansi16: TUI_ANSI16[theme][role] }]
    }),
  ) as Record<TuiRole, TuiTierColor>
}

/** Frame intervals from the motion scale: the splash breathes on base,
progress ticks on fast. */
export function tuiMotionMs(): { splashFrameMs: number; progressFrameMs: number } {
  return tuiPaletteSchema.parse(generated).motion
}
