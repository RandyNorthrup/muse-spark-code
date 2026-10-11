export const CAPTURE_PLAN: readonly {
  name: string
  method: 'GET' | 'POST'
  route: string
  authenticated: boolean
  body?: Record<string, unknown>
}[]
export function scrubCapture(value: unknown, key: string): unknown
export function parseCaptureSse(
  text: string,
): { event: string | null; data: Record<string, unknown> }[]
export function checkCapture(name: string, status: number, body: unknown): void
export interface CaptureManifest {
  startedAt: string
  finishedAt: string
  provider: string
  model: string
  workspace: string
  state: 'running' | 'complete' | 'failed'
  postResponseAttempts: number
  nonInferenceAttempts: number
  refusedPostAttempts: number
  captures: { file: string; sha256: string; status: number; checked: boolean }[]
}
/** Clears options.key after the run, including a refused/uncertain dispatch. */
export function runMetaCapture(options: {
  key: string
  outputDir: string
  fetchImpl?: typeof fetch
}): Promise<CaptureManifest>
