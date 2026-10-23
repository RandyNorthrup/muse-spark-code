// Shared by the opt-in live drills on the real Muse Code CLI: the backend
// they start, and the CLI's trace log they count model attempts from (one log
// per `muse serve` process, readable once that process has exited).

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import {
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_MODEL_ID,
  MUSE_CODE_BUNDLE_FILE,
} from '../../src/shared/constants'
import type { Logger } from '../../src/host/logger'

const TRACE_DIR = path.join(homedir(), '.local', 'share', 'muse', 'local-tracing', 'bootstrap')
/** One line per model attempt admitted; the two fields are not adjacent on the line. */
const ATTEMPT_LINE = /event="model.attempt.lifecycle".*phase="admission"/g
const LOG_WAIT_MS = 30_000
const LOG_POLL_MS = 250
// The owner's rule for live tests (2026-09-24): the contributor tier, on
// throwaway content only.
export const LIVE_MODEL_ID = `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** A running host holds its log locked; that read fails and the file is skipped for now. */
function tryRead(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** The trace log of the host that served the session, once it can be read. */
export async function sessionLog(sessionId: string): Promise<string> {
  const mark = `session_id="${sessionId}"`
  const deadline = Date.now() + LOG_WAIT_MS
  for (;;) {
    const found = readdirSync(TRACE_DIR)
      .map((name) => tryRead(path.join(TRACE_DIR, name)))
      .find((text) => text?.includes(mark) === true)
    if (found !== undefined) {
      return found
    }
    if (Date.now() > deadline) {
      throw new Error(`no readable trace log mentions session ${sessionId}`)
    }
    await sleep(LOG_POLL_MS)
  }
}

export function countAttempts(log: string): number {
  return log.match(ATTEMPT_LINE)?.length ?? 0
}

/** The CLI session log's date-sharded path (XDG-aware, like the CLI itself). */
export function sessionJsonlPath(sessionId: string): string {
  const dataHome = process.env['XDG_DATA_HOME'] ?? path.join(homedir(), '.local', 'share')
  const now = new Date()
  const shard = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join(path.sep)
  return path.join(dataHome, 'muse', 'sessions', shard, sessionId, 'session.jsonl')
}

export interface SessionResponseCounts {
  readonly responses: number
  readonly models: readonly string[]
}

/**
Model requests answered in a CLI session log: one `model_response_created`
per request, each `model_completed` naming its model. Shapes verified
2026-10-22 against real `muse serve` session logs (0 and 1 responses).
*/
export function countSessionResponses(logPath: string): SessionResponseCounts {
  const responses: string[] = []
  const models: string[] = []
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    const record = JSON.parse(line) as {
      payload_type?: string
      payload?: { event?: { kind?: string; response_id?: string; model?: string } }
    }
    if (record.payload_type !== 'runtime.session') continue
    const event = record.payload?.event
    if (event?.kind === 'model_response_created' && typeof event.response_id === 'string') {
      responses.push(event.response_id)
    }
    if (event?.kind === 'model_completed' && typeof event.model === 'string') {
      models.push(event.model)
    }
  }
  return { responses: responses.length, models }
}

/** The real CLI's backend for one drill in `workspaceRoot`. */
export function liveBackend(
  workspaceRoot: string,
  extensionVersion: string,
  log: Logger,
): MuseCodeBackendManager {
  return new MuseCodeBackendManager({
    // Opt-in independent CLI drill: no VS Code checkpoint namespace or restore surface.
    bundlePath: path.resolve('dist', MUSE_CODE_BUNDLE_FILE),
    beforeWorkspaceHostStart: () => Promise.resolve(),
    log,
    extensionVersion,
    getConfiguredBinaryPath: () => '',
    getEnvironmentVariables: () => [],
    workspaceRoot,
    getShellSandbox: () => 'off',
    getSandboxNetwork: () => 'default',
    userProfileDir: process.env['USERPROFILE'],
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy: '', noProxy: [] }),
  })
}
