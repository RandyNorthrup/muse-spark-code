// Types for scripts/lib/editor-matrix.mjs, which the unit tests import
// (M104g). The records' own shapes are the conformance report schemas.
export const MATRIX_PATH: string
export function receiptJsonPath(host: string): string
export function receiptMarkdownPath(host: string): string
export const VSCODE_OBSERVATIONS_PATH: string

export interface MatrixGroup {
  readonly title: string
  readonly hosts: readonly string[]
}
export const MATRIX_GROUPS: readonly MatrixGroup[]
export const MATRIX_HOSTS: readonly string[]

export function matrixHosts(): readonly string[]

export interface MatrixRow {
  readonly status: string
  readonly version: string
  readonly legs: string
  readonly waits: string
  readonly evidence: string
}
export function rowFor(host: string, record: unknown): MatrixRow
export function renderMatrix(records: Record<string, unknown>): string
