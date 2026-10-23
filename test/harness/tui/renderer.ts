import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import stringWidth from 'string-width'
import type { TuiInk } from '../../../src/runtime/tui/view'

/** The harness renders through real Ink: goldens pin the same bytes
production draws, laid out by the same Yoga. */
export const harnessInk: TuiInk = { Text, Box }

export interface TuiRenderOptions {
  readonly columns: number
  readonly rows: number
}

/** Render a component tree to exact terminal bytes. The frame must fit
the viewport it claims: an overflowing line or a frame taller than its
rows is a design bug, and fails red instead of pinning torn bytes. */
export function renderTui(element: ReactElement, options: TuiRenderOptions): string {
  const instance = render(element)
  try {
    const frame = instance.lastFrame()
    if (frame === undefined || frame === '') {
      throw new Error('the TUI harness rendered an empty frame')
    }
    const lines = frame.split('\n')
    if (lines.length > options.rows) {
      throw new Error(
        `the TUI frame is ${String(lines.length)} rows in a ${String(options.rows)}-row viewport`,
      )
    }
    for (const line of lines) {
      if (stringWidth(line) > options.columns) {
        throw new Error(`a TUI line exceeds the ${String(options.columns)}-column viewport`)
      }
    }
    return frame
  } finally {
    instance.unmount()
  }
}
