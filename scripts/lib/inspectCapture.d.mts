// Types for scripts/lib/inspectCapture.mjs's per-program B1 capture, which
// the capture command and its unit test import.
export interface CaptureProgram {
  readonly program: string
  readonly recursive: boolean
  readonly operands: readonly string[]
  readonly tool: readonly string[]
  readonly binary: string
  readonly helperReport?: boolean
}
export const CAPTURE_PROGRAMS: readonly CaptureProgram[]
export interface CaptureBinary {
  readonly configured: string
  readonly resolved: string | null
  readonly owner: string
  readonly helperReport?: boolean
}
export interface CaptureRow {
  readonly program: string
  readonly argv: string
  readonly exit: string
  readonly helperLines: readonly string[]
  readonly refusal: string | null
  readonly programOutput: boolean
  readonly outputBytes: number
  readonly binary: CaptureBinary
}
export function createCaptureWorkspace(base: string): {
  readonly root: string
  readonly workspace: string
  readonly home: string
  readonly identity: string
}
export function capturePrograms(
  helper: string,
  options?: { readonly scratchBase?: string },
): { readonly root: string; readonly rows: readonly CaptureRow[] }
export function normaliseCaptureText(text: string, replacements: readonly string[]): string
export function formatCapture(rows: readonly CaptureRow[], replacements: readonly string[]): string
