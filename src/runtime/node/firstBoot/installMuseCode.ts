// M110os RLF-MUSESETUP (D227): the first-boot setup's Muse Code step.
// Fetches Meta's official installer over TLS, runs it with bash, and
// verifies the installed CLI answers --version. Meta's infrastructure is
// trusted for availability only: redirects stay on https (Meta's own
// --proto-redir '=https', at most its --max-redirs 3), the download is
// re-fetched on transient failure, and nothing is called installed until
// the binary itself answers. Installer output is discarded: it names
// paths under the person's home, which never reach a log or a sentence.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  HTTP_REDIRECT_STATUSES,
  HTTP_STATUS,
  HTTP_TOO_MANY_REQUESTS,
  MUSE_INSTALL_DIR_VARIABLE,
  MUSE_INSTALL_SCRIPT_URL,
  MUSE_NO_MODIFY_PATH_VARIABLE,
  MUSE_POSIX_EXECUTABLE,
  MUSE_POSIX_INSTALL_SEGMENTS,
} from '../../../shared/constants'

const runFile = promisify(execFile)

/** Download attempts: the common three (curl's --retry shape). */
const FETCH_ATTEMPTS = 3
/** Backoff between download attempts, doubled each time. */
const FETCH_BACKOFF_FIRST_MS = 1000
/** Meta's own redirect bound (--max-redirs 3). */
const FETCH_MAX_REDIRECTS = 3
/** The installer is ~9 KiB; a megabyte headroom stops a runaway fetch. */
const INSTALLER_MAX_BYTES = 1_000_000
/** A version line shown to the person is cut at this length. */
const SHOWN_VERSION_MAX_CHARS = 100
/** Installer chatter is discarded past this buffer. */
const INSTALL_OUTPUT_MAX_BYTES = 65_536

export type MuseCodeInstallReason =
  'download-failed' | 'install-failed' | 'verify-failed' | 'timed-out'

export type MuseCodeInstallOutcome =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly reason: MuseCodeInstallReason }

export interface MuseCodeInstallOptions {
  /** The home the CLI installs into (Meta's $HOME/.local/bin default). */
  readonly homeDir: string
  /** The whole step's bound: fetch, install and verify share it. */
  readonly timeoutMs: number
  /** Environment mapping; Meta's MUSE_INSTALL_DIR knob is honoured. */
  readonly env?: NodeJS.ProcessEnv
}

/** An expected install failure, carrying its stable reason. Bugs throw anything else. */
class MuseSetupFailure extends Error {
  constructor(
    readonly reason: MuseCodeInstallReason,
    options?: ErrorOptions,
  ) {
    super(`setup muse ${reason}`, options)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Where Meta's installer puts the launcher: its knob, else $HOME/.local/bin. */
export function resolveMuseInstallDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env[MUSE_INSTALL_DIR_VARIABLE]
  return override !== undefined && override !== ''
    ? override
    : path.join(homeDir, ...MUSE_POSIX_INSTALL_SEGMENTS)
}

function redirectTarget(response: Response): string | undefined {
  return HTTP_REDIRECT_STATUSES.has(response.status)
    ? (response.headers.get('location') ?? undefined)
    : undefined
}

/** Follow one redirect chain manually, https-only. Returns the final answer. */
async function followRedirects(first: Response, url: string, deadline: number): Promise<Response> {
  let response = first
  let current = url
  for (let hops = 0; hops < FETCH_MAX_REDIRECTS; hops += 1) {
    const target = redirectTarget(response)
    if (target === undefined) return response
    const next = new URL(target, current)
    if (next.protocol !== 'https:') throw new MuseSetupFailure('download-failed')
    current = next.href
    response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    })
  }
  if (redirectTarget(response) !== undefined) throw new MuseSetupFailure('download-failed')
  return response
}

/**
Fetch Meta's installer, following at most Meta's own three redirects and
only to https. Throws the fixed setup words below; anything else is a bug.
*/
async function fetchInstaller(deadline: number): Promise<string> {
  // Every attempt restarts from the official source, never a redirect target.
  const url = MUSE_INSTALL_SCRIPT_URL
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    // No attempt starts past the deadline: a spent bound answers
    // timed-out the same way on every machine.
    if (Date.now() >= deadline) throw new MuseSetupFailure('timed-out')
    const isLastAttempt = attempt === FETCH_ATTEMPTS
    try {
      const response = await followRedirects(
        await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        }),
        url,
        deadline,
      )
      if (!response.ok) {
        // A tired server may answer next time; any other answer is final.
        if (
          !isLastAttempt &&
          (response.status >= HTTP_STATUS.internalServerError ||
            response.status === HTTP_TOO_MANY_REQUESTS)
        ) {
          await sleep(FETCH_BACKOFF_FIRST_MS * 2 ** (attempt - 1))
          continue
        }
        throw new MuseSetupFailure('download-failed')
      }
      const text = await response.text()
      if (text.length === 0 || text.length > INSTALLER_MAX_BYTES) {
        throw new MuseSetupFailure('download-failed')
      }
      return text
    } catch (error: unknown) {
      // AbortSignal.timeout() rejects with TimeoutError; a bare abort
      // answers AbortError. Both mean the bound ran out.
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new MuseSetupFailure('timed-out', { cause: error })
      }
      if (
        (error instanceof MuseSetupFailure && error.reason === 'download-failed') ||
        error instanceof TypeError
      ) {
        // Our own download failure, or undici's network failure: both are
        // retryable while attempts remain.
        if (!isLastAttempt && Date.now() < deadline) {
          await sleep(FETCH_BACKOFF_FIRST_MS * 2 ** (attempt - 1))
          continue
        }
        throw new MuseSetupFailure('download-failed', { cause: error })
      }
      throw error
    }
  }
  throw new MuseSetupFailure('download-failed')
}

/** execFile kills the child on its timeout and reports killed=true. */
function wasKilled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'killed' in error && error.killed === true
}

/**
Run Meta's installer script with bash. HOME is the install home and the
node manages PATH, so profiles stay untouched. Output is discarded.
*/
async function runInstaller(
  script: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'muse-setup-'))
  try {
    const file = path.join(dir, 'install.sh')
    writeFileSync(file, script, 'utf8')
    await runFile('bash', [file], {
      cwd: homeDir,
      env: { ...env, HOME: homeDir, [MUSE_NO_MODIFY_PATH_VARIABLE]: '1' },
      timeout: Math.max(1, timeoutMs),
      maxBuffer: INSTALL_OUTPUT_MAX_BYTES,
      windowsHide: true,
    })
  } catch (error: unknown) {
    throw new MuseSetupFailure(wasKilled(error) ? 'timed-out' : 'install-failed', {
      cause: error,
    })
  } finally {
    // The dir is ours alone (mkdtemp above, the child reaped): a removal
    // failure here is a genuine IO failure and surfaces as one.
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The installed CLI answers --version; anything else is not installed. */
async function verifyInstall(musePath: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await runFile(musePath, ['--version'], {
      timeout: Math.max(1, timeoutMs),
      maxBuffer: INSTALL_OUTPUT_MAX_BYTES,
      windowsHide: true,
    })
    const first = stdout.split('\n', 1)[0]?.trim() ?? ''
    if (first === '') throw new MuseSetupFailure('verify-failed')
    return first.slice(0, SHOWN_VERSION_MAX_CHARS)
  } catch (error: unknown) {
    if (error instanceof MuseSetupFailure) throw error
    throw new MuseSetupFailure(wasKilled(error) ? 'timed-out' : 'verify-failed', {
      cause: error,
    })
  }
}

/**
Install the Muse Code CLI from Meta's official installer into homeDir
and verify it. Expected failures come back as a reason; bugs throw.
*/
export async function installMuseCode(
  options: MuseCodeInstallOptions,
): Promise<MuseCodeInstallOutcome> {
  if (!path.isAbsolute(options.homeDir)) throw new Error('setup muse home is not absolute')
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('setup muse timeout is not usable')
  }
  const env = options.env ?? process.env
  const deadline = Date.now() + options.timeoutMs
  try {
    const script = await fetchInstaller(deadline)
    const remainingAfterFetch = deadline - Date.now()
    if (remainingAfterFetch <= 0) return { ok: false, reason: 'timed-out' }
    await runInstaller(script, options.homeDir, env, remainingAfterFetch)
    const remainingAfterInstall = deadline - Date.now()
    if (remainingAfterInstall <= 0) return { ok: false, reason: 'timed-out' }
    const musePath = path.join(resolveMuseInstallDir(options.homeDir, env), MUSE_POSIX_EXECUTABLE)
    const version = await verifyInstall(musePath, remainingAfterInstall)
    return { ok: true, version }
  } catch (error: unknown) {
    // NARROW: our own branded failures become reasons; anything else is a bug.
    if (error instanceof MuseSetupFailure) return { ok: false, reason: error.reason }
    throw error
  }
}
