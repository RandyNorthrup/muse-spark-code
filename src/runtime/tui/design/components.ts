import { createElement, type ReactElement } from 'react'
import stringWidth from 'string-width'
import { formatNumber } from '../../../shared/l10n/text'
import type { TuiInk } from '../view'
import type { TuiRole } from './palette'
import { clipSgr, paint, paintBold, type TuiTheme } from './theme'

/** Powerline symbols, in every Nerd Font: branch and the tab
separator. Plain text stays words, never look-alike glyphs. */
export const TUI_NERD_BRANCH = '\u{E0A0}'
export const TUI_NERD_TAB_SEP = '\u{E0B0}'

const STATUS_ITEM_GAP = 3

function textLine(ink: TuiInk, key: string, text: string): ReactElement {
  return createElement(ink.Text, { key }, text)
}

/** The plain title row every frameless pane shares; absent without a title. */
function plainTitle(
  ink: TuiInk,
  theme: TuiTheme,
  title: string | undefined,
  width: number,
): ReactElement[] {
  return title === undefined
    ? []
    : [textLine(ink, 'title', paint(theme, 'muted', clipPlain(title, width)))]
}

/** One text row per body line, keyed and painted by the caller. */
function bodyLines(
  ink: TuiInk,
  lines: readonly string[],
  keyPrefix: string,
  paintLine: (line: string) => string,
): ReactElement[] {
  return lines.map((line, index) =>
    textLine(ink, `${keyPrefix}-${formatNumber(index)}`, paintLine(line)),
  )
}

/** The plain body painter: clipped text rows in the theme's text tone. */
function plainText(theme: TuiTheme, width: number): (line: string) => string {
  return (line) => paint(theme, 'text', clipSgr(line, width))
}

/** The frameless pane with the plain body painter. */
function plainPanel(
  ink: TuiInk,
  theme: TuiTheme,
  title: string | undefined,
  lines: readonly string[],
  width: number,
): ReactElement {
  return plainPane(ink, theme, title, lines, width, plainText(theme, width))
}

/** The whole frameless pane: a plain title over caller-painted lines. */
function plainPane(
  ink: TuiInk,
  theme: TuiTheme,
  title: string | undefined,
  lines: readonly string[],
  width: number,
  paintLine: (line: string) => string,
): ReactElement {
  return createElement(
    ink.Box,
    { flexDirection: 'column', width, overflow: 'hidden' },
    ...plainTitle(ink, theme, title, width),
    ...bodyLines(ink, lines, 'line', paintLine),
  )
}

/** Clip plain text to a cell width, never splitting a glyph. Paint
runs after: SGR never changes the width. */
function clipPlain(text: string, width: number): string {
  if (stringWidth(text) <= width) return text
  let kept = ''
  let used = 0
  for (const glyph of text) {
    const cells = stringWidth(glyph)
    if (used + cells > width) break
    kept += glyph
    used += cells
  }
  return kept
}

/** Fit plain text into a framed row: clipped, then padded so the
closing border lands on the same column every row. */
function fitLine(text: string, width: number): string {
  const clipped = clipPlain(text, width)
  return clipped + ' '.repeat(Math.max(0, width - stringWidth(clipped)))
}

function centerLine(text: string, width: number): string {
  return ' '.repeat(Math.max(0, Math.floor((width - stringWidth(text)) / 2))) + text
}

function frameTop(theme: TuiTheme, title: string, inner: number, tone: TuiRole): string {
  const label = title === '' ? '' : ` ${clipPlain(title, Math.max(0, inner - 2))} `
  const dashes = inner - stringWidth(label)
  const before = Math.floor(dashes / 2)
  const after = dashes - before
  return (
    paint(theme, tone, `╭${'─'.repeat(before)}`) +
    (label === '' ? '' : paintBold(theme, 'text', label)) +
    paint(theme, tone, `${'─'.repeat(after)}╮`)
  )
}

/** A titled box: rounded frame, title centred on the top rule, caller
lines inside. The frame wears the tone, the content reads as text, so
roles adapt to the theme instead of inheriting the terminal default.
`frame: false` drops the frame for screen readers, which mangle box
drawing: the title and lines read as plain text. */
export function Panel(props: {
  ink: TuiInk
  theme: TuiTheme
  lines: readonly string[]
  width: number
  title?: string
  tone?: TuiRole
  frame?: boolean
}): ReactElement {
  if (props.frame === false) {
    return plainPanel(props.ink, props.theme, props.title, props.lines, props.width)
  }
  const tone = props.tone ?? 'border'
  const inner = Math.max(1, props.width - 2)
  return createElement(
    props.ink.Box,
    { flexDirection: 'column', width: props.width, overflow: 'hidden' },
    textLine(props.ink, 'top', frameTop(props.theme, props.title ?? '', inner, tone)),
    ...bodyLines(
      props.ink,
      props.lines,
      'row',
      (line) =>
        paint(props.theme, tone, '│') +
        paint(props.theme, 'text', fitLine(line, inner)) +
        paint(props.theme, tone, '│'),
    ),
    textLine(props.ink, 'bottom', paint(props.theme, tone, `╰${'─'.repeat(inner)}╯`)),
  )
}

/** One status row: muted labels, text values, clipped to the width. */
export function StatusLine(props: {
  ink: TuiInk
  theme: TuiTheme
  items: readonly (readonly [label: string, value: string])[]
  width: number
}): ReactElement {
  const row = props.items
    .map(
      ([label, value]) =>
        `${paint(props.theme, 'muted', label)}: ${paint(props.theme, 'text', value)}`,
    )
    .join(' '.repeat(STATUS_ITEM_GAP))
  return createElement(
    props.ink.Box,
    { flexDirection: 'row', width: props.width, overflow: 'hidden' },
    textLine(props.ink, 'status', clipSgr(row, props.width)),
  )
}

/** The launch splash: the mark, the product name and one progress bar,
all centred. Art lines carry their own tier SGR from the loader. */
export function Splash(props: {
  ink: TuiInk
  theme: TuiTheme
  art: readonly string[]
  caption: string
  progress: string
  width: number
}): ReactElement {
  return createElement(
    props.ink.Box,
    { flexDirection: 'column', width: props.width, overflow: 'hidden' },
    ...props.art.map((line, index) =>
      textLine(
        props.ink,
        `art-${formatNumber(index)}`,
        centerLine(clipSgr(line, props.width), props.width),
      ),
    ),
    textLine(
      props.ink,
      'caption',
      centerLine(paint(props.theme, 'muted', clipPlain(props.caption, props.width)), props.width),
    ),
    textLine(
      props.ink,
      'progress',
      centerLine(paint(props.theme, 'accent', clipPlain(props.progress, props.width)), props.width),
    ),
  )
}

/** A spinner beside its label. */
export function Progress(props: {
  ink: TuiInk
  theme: TuiTheme
  tick: string
  label: string
  width: number
}): ReactElement {
  return createElement(
    props.ink.Box,
    { flexDirection: 'row', width: props.width, overflow: 'hidden' },
    textLine(props.ink, 'tick', paint(props.theme, 'accent', props.tick)),
    textLine(
      props.ink,
      'label',
      ` ${paint(props.theme, 'text', clipPlain(props.label, Math.max(0, props.width - 2)))}`,
    ),
  )
}

/** The tab strip: the active tab bold in accent, the rest muted. */
export function TabStrip(props: {
  ink: TuiInk
  theme: TuiTheme
  tabs: readonly (readonly [id: string, label: string])[]
  active: string
  nerdFont: boolean
  width: number
}): ReactElement {
  const sep = props.nerdFont ? ` ${TUI_NERD_TAB_SEP} ` : ' | '
  const row = props.tabs
    .map(([id, label]) =>
      id === props.active
        ? paintBold(props.theme, 'accent', label)
        : paint(props.theme, 'muted', label),
    )
    .join(paint(props.theme, 'muted', sep))
  return createElement(
    props.ink.Box,
    { flexDirection: 'row', width: props.width, overflow: 'hidden' },
    textLine(props.ink, 'tabs', clipSgr(row, props.width)),
  )
}

/** A docked bottom pane: heavy top rule, title, caller lines.
`frame: false` reads the title and lines plain for screen readers. */
export function BottomPane(props: {
  ink: TuiInk
  theme: TuiTheme
  title: string
  lines: readonly string[]
  width: number
  frame?: boolean
}): ReactElement {
  if (props.frame === false) {
    return plainPanel(props.ink, props.theme, props.title, props.lines, props.width)
  }
  const inner = Math.max(1, props.width - 2)
  const label = ` ${clipPlain(props.title, Math.max(0, inner - 2))} `
  const dashes = inner - stringWidth(label)
  const before = Math.floor(dashes / 2)
  const top =
    paint(props.theme, 'border', `╞${'═'.repeat(before)}`) +
    paintBold(props.theme, 'text', label) +
    paint(props.theme, 'border', `${'═'.repeat(dashes - before)}╡`)
  return createElement(
    props.ink.Box,
    { flexDirection: 'column', width: props.width, overflow: 'hidden' },
    textLine(props.ink, 'top', top),
    ...bodyLines(
      props.ink,
      props.lines,
      'row',
      (line) =>
        paint(props.theme, 'border', '│') +
        paint(props.theme, 'text', fitLine(line, inner)) +
        paint(props.theme, 'border', '│'),
    ),
    textLine(props.ink, 'bottom', paint(props.theme, 'border', `╰${'─'.repeat(inner)}╯`)),
  )
}

export type AgentPresence = 'active' | 'idle' | 'done'

/** The agent map: one row per agent with its presence dot and branch. */
export function AgentMap(props: {
  ink: TuiInk
  theme: TuiTheme
  agents: readonly (readonly [name: string, presence: AgentPresence, branch: string])[]
  nerdFont: boolean
  width: number
}): ReactElement {
  const dot: Record<AgentPresence, string> = { active: '●', idle: '○', done: '●' }
  const tone: Record<AgentPresence, TuiRole> = { active: 'accent', idle: 'muted', done: 'success' }
  const on = props.nerdFont ? TUI_NERD_BRANCH : 'on'
  return createElement(
    props.ink.Box,
    { flexDirection: 'column', width: props.width, overflow: 'hidden' },
    ...props.agents.map(([name, presence, branch], index) =>
      textLine(
        props.ink,
        `agent-${formatNumber(index)}`,
        clipSgr(
          `${paint(props.theme, tone[presence], dot[presence])} ${paint(props.theme, 'text', name)} ${paint(props.theme, 'muted', on)} ${paint(props.theme, 'muted', branch)}`,
          props.width,
        ),
      ),
    ),
  )
}

/** A borderless peek: muted title over indented lines. */
export function PeekPane(props: {
  ink: TuiInk
  theme: TuiTheme
  title: string
  lines: readonly string[]
  width: number
}): ReactElement {
  return plainPane(props.ink, props.theme, props.title, props.lines, props.width, (line) =>
    paint(props.theme, 'text', `  ${clipPlain(line, Math.max(0, props.width - 2))}`),
  )
}
