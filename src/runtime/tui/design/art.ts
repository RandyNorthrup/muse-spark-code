import stringWidth from 'string-width'
import {
  TUI_SQUIGGLE_ASCII,
  TUI_SQUIGGLE_BLOCKS,
  TUI_SQUIGGLE_MINI_ASCII,
  TUI_SQUIGGLE_MINI_BLOCKS,
} from '../../../../design/tui/art.generated'
import type { TuiColorTier, TuiThemeMode } from './capabilities'
import { sgrFor } from './theme'

export type TuiArtKind = 'squiggle' | 'squiggle-mini'

const BLOCKS: Record<TuiArtKind, readonly string[]> = {
  squiggle: TUI_SQUIGGLE_BLOCKS,
  'squiggle-mini': TUI_SQUIGGLE_MINI_BLOCKS,
}
const ASCII: Record<TuiArtKind, readonly string[]> = {
  squiggle: TUI_SQUIGGLE_ASCII,
  'squiggle-mini': TUI_SQUIGGLE_MINI_ASCII,
}

/** The brand squiggle for one tier: quadrant blocks in the tier's brand
colour, or the ASCII twin where the terminal is least capable or the
font is not a Nerd Font. Plain stays bare; the ASCII twin still takes
the tier's brand colour, so it reads as the mark everywhere. */
export function brandArt(
  kind: TuiArtKind,
  tier: TuiColorTier,
  mode: TuiThemeMode,
  hasNerdFont: boolean,
): readonly string[] {
  if (tier === 'plain') return ASCII[kind]
  const sgr = sgrFor(tier, mode, 'brand')
  if (sgr === undefined) return ASCII[kind]
  const glyphs = hasNerdFont ? BLOCKS[kind] : ASCII[kind]
  return glyphs.map((line) => (line === '' ? '' : `${sgr.open}${line}${sgr.close}`))
}

/** The art's drawn size, for layouts that centre it. */
export function brandArtSize(kind: TuiArtKind): { columns: number; rows: number } {
  const lines = BLOCKS[kind]
  return {
    columns: Math.max(...lines.map((line) => stringWidth(line))),
    rows: lines.length,
  }
}
