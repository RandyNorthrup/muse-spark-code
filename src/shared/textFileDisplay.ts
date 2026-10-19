// Muse Code persists displayText but not picked text-file chips. This readable
// suffix survives History. The full text remains visible so a user-authored
// identical line is never silently removed; even a damaged suffix flags the
// card as a file so rewind cannot silently lose its bytes.

import * as z from 'zod/mini'
import { TEXT_FILE_DISPLAY_MARKER } from './constants'

const FILE_NAMES = z.array(z.string())

/** Append a readable, structured annotation to the MSP display text. */
export function textFileDisplay(visibleText: string, names: readonly string[]): string {
  return `${visibleText}${TEXT_FILE_DISPLAY_MARKER}${JSON.stringify(names)}]`
}

/** `undefined` means no marker; empty names means malformed but file-bearing. */
export function readTextFileDisplay(displayText: string): readonly string[] | undefined {
  const markerAt = displayText.lastIndexOf(TEXT_FILE_DISPLAY_MARKER)
  if (markerAt === -1) {
    return undefined
  }
  const suffix = displayText.slice(markerAt + TEXT_FILE_DISPLAY_MARKER.length)
  if (!suffix.endsWith(']')) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(suffix.slice(0, -1))
    const result = FILE_NAMES.safeParse(parsed)
    return result.success && result.data.length > 0 ? result.data : []
  } catch (error) {
    // A damaged suffix still flags the card as a file so rewind cannot
    // silently lose its bytes. Anything else keeps its kind.
    if (error instanceof SyntaxError) return []
    throw error
  }
}
