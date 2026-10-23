import stringWidth from 'string-width'
import type { TuiColorTier, TuiThemeMode } from './capabilities'
import { resolvePalette, TUI_ANSI16_CODES, type TuiRole } from './palette'

export const TUI_SGR_CLOSE = '\u{1B}[39m'

const TUI_BOLD_OPEN = '\u{1B}[1m'
const TUI_BOLD_CLOSE = '\u{1B}[22m'

/** What every component paints with: the tier picks the code space,
the mode picks the shade. */
export interface TuiTheme {
  readonly tier: TuiColorTier
  readonly mode: TuiThemeMode
}

const paletteCache = new Map<TuiThemeMode, ReturnType<typeof resolvePalette>>()

function paletteFor(mode: TuiThemeMode) {
  const cached = paletteCache.get(mode)
  if (cached !== undefined) return cached
  const resolved = resolvePalette(mode)
  paletteCache.set(mode, resolved)
  return resolved
}

/** The SGR open/close for one role, or undefined when the tier is plain.
The close always resets the foreground; backgrounds are never painted, so
the person's own terminal colour shows through. */
export function sgrFor(
  tier: TuiColorTier,
  mode: TuiThemeMode,
  role: TuiRole,
): { open: string; close: string } | undefined {
  if (tier === 'plain') return undefined
  const color = paletteFor(mode)[role]
  if (tier === 'truecolor') {
    const [r, g, b] = color.rgb
    return {
      open: `\u{1B}[38;2;${String(r)};${String(g)};${String(b)}m`,
      close: TUI_SGR_CLOSE,
    }
  }
  const code =
    tier === 'c256' ? `38;5;${String(color.ansi256)}` : String(TUI_ANSI16_CODES[color.ansi16])
  return { open: `\u{1B}[${code}m`, close: TUI_SGR_CLOSE }
}

/** Paint text in a role: raw SGR the terminal honours, bare text on
the plain tier. Callers clip first: paint never changes the width. */
export function paint(theme: TuiTheme, role: TuiRole, text: string): string {
  const sgr = sgrFor(theme.tier, theme.mode, role)
  return sgr === undefined ? text : `${sgr.open}${text}${sgr.close}`
}

/** The same, bold: the active tab, panel titles. Bold survives the
plain tier: it is an attribute, not a colour. */
export function paintBold(theme: TuiTheme, role: TuiRole, text: string): string {
  const sgr = sgrFor(theme.tier, theme.mode, role)
  return sgr === undefined
    ? `${TUI_BOLD_OPEN}${text}${TUI_BOLD_CLOSE}`
    : `${TUI_BOLD_OPEN}${sgr.open}${text}${sgr.close}${TUI_BOLD_CLOSE}`
}

// A literal would trip no-control-regex; the pattern is identical.
const SGR_ESCAPE_CODE = 27
const SGR_PATTERN = new RegExp(String.fromCodePoint(SGR_ESCAPE_CODE) + String.raw`\[[0-9;]*m`, 'gu')

function closerFor(params: string): string | undefined {
  if (params === '1') return TUI_BOLD_CLOSE
  return params.startsWith('38;') ? TUI_SGR_CLOSE : undefined
}

/** Clip painted text to a cell width: spans ride along cost-free, a
cut span regains its closers innermost-first, and SGR this module
never emits fails red instead of corrupting the bytes. */
export function clipSgr(line: string, width: number): string {
  if (stringWidth(line) <= width) return line
  const parts = line.split(SGR_PATTERN)
  const spans = line.match(SGR_PATTERN) ?? []
  const open: string[] = []
  let kept = ''
  let used = 0
  for (const [index, part] of parts.entries()) {
    for (const glyph of part) {
      const cells = stringWidth(glyph)
      if (used + cells > width) return kept + open.toReversed().join('')
      kept += glyph
      used += cells
    }
    const span = spans[index]
    if (span === undefined) continue
    const params = span.slice(2, -1)
    if (params === '22' || params === '39') {
      open.pop()
      kept += span
      continue
    }
    const closer = closerFor(params)
    if (closer === undefined) throw new Error(`unhandled SGR in TUI clip: ${params}`)
    open.push(closer)
    kept += span
  }
  return kept + open.toReversed().join('')
}
