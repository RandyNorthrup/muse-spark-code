import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import { formatNumber } from '../../shared/l10n/text'
import type { TuiController } from './controller'
import type { TuiAsk } from './protocol'
import {
  askChoices,
  askLines,
  pairingLines,
  statusLines,
  terminalGraphemes,
  terminalText,
} from './state'

interface InkTextProps {
  children?: ReactNode
  color?: string
}
interface InkBoxProps {
  children?: ReactNode
  flexDirection?: 'column' | 'row'
  width?: number
  height?: number
  overflow?: 'hidden'
}
export interface InkBinding {
  Text: ComponentType<InkTextProps>
  Box: ComponentType<InkBoxProps>
  render(
    element: ReactElement,
    options: { exitOnCtrlC: false; patchConsole: false },
  ): {
    rerender(element: ReactElement): void
    /** Resolves only after this renderer's output is flushed to the terminal. */
    waitUntilRenderFlush(): Promise<void>
    unmount(): void
  }
}

export interface TuiLine {
  text: string
  color?: 'red' | 'green'
}

export function contentLines(controller: TuiController): TuiLine[] {
  const { state, view } = controller
  switch (view) {
    case 'chat': {
      return state.chat.flatMap((item) =>
        `${item.role === 'user' ? UI_TEXT.tuiYou : UI_TEXT.tuiAgent}: ${terminalText(item.text)}`
          .split('\n')
          .map((text) => ({ text })),
      )
    }
    case 'diff': {
      return state.diff === undefined
        ? []
        : [
            { text: terminalText(state.diff.path) },
            ...terminalText(state.diff.patch)
              .split('\n')
              .map((text): TuiLine => {
                if (text.startsWith('+')) return { text, color: 'green' }
                return text.startsWith('-') ? { text, color: 'red' } : { text }
              }),
          ]
    }
    case 'tasks': {
      return state.tasks.map((item) => ({
        text: `${terminalText(item.title)} (${terminalText(item.status)})`,
      }))
    }
    case 'status': {
      return [...statusLines(state), ...pairingLines(state)].map((text) => ({ text }))
    }
  }
}

/** Plain text line mode has no Ink rendering or cursor controls at all. */
export function lineView(controller: TuiController): string {
  return contentLines(controller)
    .map((line) => line.text)
    .join(' | ')
    .replaceAll('\n', ' ')
}

function wrapLine(line: TuiLine, width: number): TuiLine[] {
  const glyphs = terminalGraphemes(terminalText(line.text).replaceAll('\n', ' '))
  const lines: TuiLine[] = []
  do {
    // Reserve half the columns: every Unicode glyph is at most two cells.
    lines.push({ ...line, text: glyphs.splice(0, Math.max(1, Math.floor(width / 2))).join('') })
  } while (glyphs.length > 0)
  return lines
}

/** All action text and paid terms must fit before any choice is presented. */
export function approvalLines(
  controller: TuiController,
  options: { columns: number; rows: number },
): { lines: TuiLine[]; ask: TuiAsk | undefined } {
  const ask = controller.state.asks[0]
  if (ask === undefined) return { lines: [], ask: undefined }
  const width = Math.max(1, options.columns)
  const height = Math.max(0, options.rows)
  const lines = [...askLines(ask), UI_TEXT.tuiApprovalFocus].flatMap((text) =>
    wrapLine({ text }, width),
  )
  if (lines.length <= height) return { lines, ask }
  const warning = wrapLine({ text: UI_TEXT.tuiApprovalTooLarge }, width).slice(0, height)
  const action = askLines(ask)
    .slice(0, -askChoices(ask).length)
    .flatMap((text) => wrapLine({ text }, width))
  return {
    lines: [...action.slice(0, Math.max(0, height - warning.length)), ...warning],
    ask: undefined,
  }
}

/** Approval choices have identical props: no selected/default emphasis. */
export function tuiView(
  controller: TuiController,
  ink: InkBinding,
  options: { columns: number; rows: number; noColor: boolean },
): ReactElement {
  const width = Math.max(1, options.columns)
  const height = Math.max(0, options.rows)
  const pairing = pairingLines(controller.state).flatMap((text) => wrapLine({ text }, width))
  const ask = controller.state.asks[0]
  const fixed: TuiLine[] = [
    ...statusLines(controller.state)
      .flatMap((text) => wrapLine({ text }, width))
      .slice(0, TUI_LIMITS.statusHeaderRows),
    ...pairing,
  ]
  const footer: TuiLine[] = [
    { text: UI_TEXT.tuiKeys },
    ...(ask === undefined
      ? [{ text: `${UI_TEXT.composerLabel}: ${terminalText(controller.input)}` }]
      : []),
  ].flatMap((line) => wrapLine(line, width))
  const available = Math.max(0, height - fixed.length - footer.length)
  const body = contentLines(controller).flatMap((line) => wrapLine(line, width))
  const end = Math.max(0, body.length - controller.scroll)
  let visible: TuiLine[] = [...fixed, ...body.slice(Math.max(0, end - available), end), ...footer]
  if (ask === undefined) {
    controller.presentAsk(undefined)
  } else {
    const approval = approvalLines(controller, options)
    if (approval.ask === undefined) controller.presentAsk(undefined)
    visible = [...fixed.slice(0, Math.max(0, height - approval.lines.length)), ...approval.lines]
  }
  return createElement(
    ink.Box,
    { flexDirection: 'column', width, height, overflow: 'hidden' },
    ...visible.map((line, index) =>
      createElement(
        ink.Text,
        {
          key: formatNumber(index),
          ...(!options.noColor && line.color !== undefined && { color: line.color }),
        },
        line.text,
      ),
    ),
  )
}

/** Raw input is decoded by runTui for both surfaces; Ink only renders. */
export function TuiInputView(props: {
  controller: TuiController
  ink: InkBinding
  columns: number
  rows: number
  noColor: boolean
}): ReactElement {
  return tuiView(props.controller, props.ink, props)
}
