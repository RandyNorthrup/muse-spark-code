// Stack frames for the flight recorder (M93, PLAN.md D72): where a failure
// happened inside the package, never what it said. Shared by the host and
// the webview. Only V8 frame lines (`at …`) are read; a frame's location is
// handed to the caller's mapper, which answers the package-relative file it
// names (one of REPORT_PACKAGE_FRAME_PATHS) or nothing. The error's message,
// function names, other lines and every location the mapper does not vouch
// for are dropped, so raw text cannot ride along as a "path": a forged line
// can at most name a package file and two numbers.

import { REPORT_ERROR_CODES, REPORT_STACK_MAX_FRAMES, REPORT_UNKNOWN_ERROR_CODE } from './constants'

/** One verified frame: a package file and its line and column. */
export interface PackageFrame {
  readonly path: string
  readonly line: number
  readonly column: number
}

const FRAME_PREFIX = 'at '
const ASYNC_PREFIX = 'async '
/** `file:line:column` at the end of a location. */
const LOCATION = /^(.+):(\d+):(\d+)$/

/** The location of one frame line, or undefined when the line is not a frame. */
function frameLocation(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(FRAME_PREFIX)) {
    return undefined
  }
  let rest = trimmed.slice(FRAME_PREFIX.length)
  if (rest.startsWith(ASYNC_PREFIX)) {
    rest = rest.slice(ASYNC_PREFIX.length)
  }
  if (rest.endsWith(')')) {
    const open = rest.lastIndexOf('(')
    return open === -1 ? undefined : rest.slice(open + 1, -1)
  }
  return rest
}

/**
 * The package frames of a stack, most recent call first, capped at
 * REPORT_STACK_MAX_FRAMES. `packagePath` maps a frame's file or URL to its
 * package-relative path, or undefined for anything outside the package.
 */
export function packageFramesOf(
  stack: string,
  packagePath: (location: string) => string | undefined,
): readonly PackageFrame[] {
  const frames: PackageFrame[] = []
  for (const line of stack.split('\n')) {
    if (frames.length >= REPORT_STACK_MAX_FRAMES) {
      break
    }
    const location = frameLocation(line)
    const match = location === undefined ? null : LOCATION.exec(location)
    if (match === null) {
      continue
    }
    const path = packagePath(match[1] ?? '')
    const lineNumber = Number(match[2])
    const column = Number(match[3])
    if (
      path === undefined ||
      !Number.isSafeInteger(lineNumber) ||
      !Number.isSafeInteger(column) ||
      lineNumber < 1 ||
      column < 0
    ) {
      continue
    }
    frames.push({ path, line: lineNumber, column })
  }
  return frames
}

/** A failure's class as the recorder's code: a known name, or the fixed unknown word. */
export function reportCodeOf(error: unknown): string {
  return error instanceof Error && REPORT_ERROR_CODES.has(error.name)
    ? error.name
    : REPORT_UNKNOWN_ERROR_CODE
}

/** The stack text of a failure, or empty when it has none. */
export function stackOf(error: unknown): string {
  return error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
}
