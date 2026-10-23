import { execFile } from 'node:child_process'
import {
  TUI_LIMITS,
  TUI_TIER_C256_COLORS,
  TUI_TIER_SIXTEEN_COLORS,
} from '../../../shared/constants'

/** What the terminal can show: full colour, the 256 palette, the 16 ANSI
colours, or plain unstyled text. */
export type TuiColorTier = 'truecolor' | 'c256' | 'sixteen' | 'plain'

/** Light or dark cells behind the text. */
export type TuiThemeMode = 'dark' | 'light'

export interface TuiCapabilities {
  readonly tier: TuiColorTier
  readonly theme: TuiThemeMode
  /** Motion plays when the person has not asked for reduced motion. */
  readonly motion: boolean
  /** Nerd Font glyphs; plain text is the default and the fallback. */
  readonly nerdFont: boolean
}

/** Everything detection reads: parsed flags, the environment, and the
answers of the capability probes (null when a probe could not answer). */
export interface TuiCapabilityInputs {
  readonly noColor: boolean
  readonly reducedMotion: boolean
  readonly nerdFont: boolean
  readonly env: Readonly<Record<string, string | undefined>>
  /** `tput colors` for this TERM, or null when tput is missing or mute. */
  readonly termColors: number | null
  /** The macOS interface style, or null off macOS or when unreadable. */
  readonly macTheme: TuiThemeMode | null
  /** The macOS reduce-motion setting, or null when unknown. */
  readonly macReducedMotion: boolean | null
}

const COLORTERM_TRUECOLOR = new Set(['truecolor', '24bit'])
const NO_COLOR_TERMS = new Set(['', 'dumb', 'unknown'])

/** The tier decision, pure and total: every input combination lands on
exactly one tier, and an unknown terminal degrades to the safe floor. */
export function resolveColorTier(inputs: {
  noColor: boolean
  env: Readonly<Record<string, string | undefined>>
  termColors: number | null
}): TuiColorTier {
  if (inputs.noColor) return 'plain'
  const colorterm = inputs.env['COLORTERM']?.toLowerCase()
  if (colorterm !== undefined && COLORTERM_TRUECOLOR.has(colorterm)) return 'truecolor'
  // Windows Terminal is truecolor; its session id is the tell.
  if (inputs.env['WT_SESSION'] !== undefined) return 'truecolor'
  if (inputs.termColors !== null) {
    if (inputs.termColors >= TUI_TIER_C256_COLORS) return 'c256'
    // Eight terminfo colours still take the sixteen ANSI codes: bright
    // variants have worked everywhere since the nineties.
    return inputs.termColors >= TUI_TIER_SIXTEEN_COLORS ? 'sixteen' : 'plain'
  }
  const term = inputs.env['TERM'] ?? ''
  if (NO_COLOR_TERMS.has(term)) return 'plain'
  return term.includes('256color') ? 'c256' : 'sixteen'
}

export function resolveThemeMode(inputs: {
  env: Readonly<Record<string, string | undefined>>
  macTheme: TuiThemeMode | null
}): TuiThemeMode {
  const override = inputs.env['MUSE_TUI_THEME']?.toLowerCase()
  return override === 'light' || override === 'dark' ? override : (inputs.macTheme ?? 'dark')
}

export function resolveCapabilities(inputs: TuiCapabilityInputs): TuiCapabilities {
  return {
    tier: resolveColorTier(inputs),
    theme: resolveThemeMode(inputs),
    motion: !inputs.reducedMotion && inputs.macReducedMotion !== true,
    nerdFont: inputs.nerdFont,
  }
}

export type TuiProbeExec = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string | undefined> },
) => Promise<{ stdout: string } | null>

/** A probe answers stdout or nothing: a missing tool, a timeout kill and
the tool's own refusal all mean "no answer", and the decision table's
fallbacks cover every null. */
function defaultExec(
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string | undefined> },
): Promise<{ stdout: string } | null> {
  return new Promise((resolve) => {
    execFile(file, [...args], options, (error, stdout) => {
      if (error === null) resolve({ stdout })
      else resolve(null)
    })
  })
}

async function probe(
  exec: TuiProbeExec,
  file: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const answer = await exec(file, args, {
    timeout: TUI_LIMITS.probeMs,
    maxBuffer: TUI_LIMITS.probeBytes,
    env,
  })
  return answer?.stdout ?? null
}

/** Runs the capability probes and resolves the tier, theme, motion and
font. Never throws for a missing tool: a silent probe degrades. */
export async function detectCapabilities(options: {
  noColor: boolean
  reducedMotion: boolean
  nerdFont: boolean
  env: Readonly<Record<string, string | undefined>>
  platform: NodeJS.Platform
  exec?: TuiProbeExec
}): Promise<TuiCapabilities> {
  const exec = options.exec ?? defaultExec
  const env: Record<string, string | undefined> = { ...options.env }
  const [tput, macTheme, macMotion] = await Promise.all([
    probe(exec, 'tput', ['colors'], env),
    options.platform === 'darwin'
      ? probe(exec, 'defaults', ['read', '-g', 'AppleInterfaceStyle'], env)
      : Promise.resolve(null),
    options.platform === 'darwin'
      ? probe(exec, 'defaults', ['read', 'com.apple.universalaccess', 'reduceMotion'], env)
      : Promise.resolve(null),
  ])
  const termColors = tput === null ? null : Number(tput.trim())
  const macStyle = macTheme?.trim()
  return resolveCapabilities({
    noColor: options.noColor,
    reducedMotion: options.reducedMotion,
    nerdFont: options.nerdFont,
    env: options.env,
    termColors: termColors === null || Number.isNaN(termColors) ? null : termColors,
    macTheme: macStyle === undefined ? null : macStyle === 'Dark' ? 'dark' : 'light',
    macReducedMotion: macMotion === null ? null : macMotion.trim() === '1',
  })
}
