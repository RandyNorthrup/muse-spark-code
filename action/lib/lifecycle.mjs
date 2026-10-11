// The Action's one launcher owner (M80, SPEC §6.2, decision D-M7). Every child
// and every phase of an invocation runs under it: one stop latch, one current
// child, one signal handler pair, concrete wall-clock and output bounds, and a
// bounded final cleanup that deletes private staging and drops the key and
// token references. The Action's scripts use Node built-ins only.

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createWriteStream, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

// Phase wall-clock bounds (milliseconds).
export const ACTION_GATE_MS = 30_000
export const ACTION_INSTALL_MS = 300_000
export const ACTION_CHECKOUT_MS = 120_000
export const ACTION_INPUT_MS = 30_000
export const ACTION_EXEC_OVERHEAD_MS = 10_000
export const ACTION_GIT_MS = 30_000
export const ACTION_SCAN_MS = 30_000
export const ACTION_EXTRACT_MS = 10_000
export const ACTION_PUBLISH_MS = 10_000
// The sticky comment's API calls.
export const ACTION_POST_MS = 30_000
export const ACTION_DOWNLOAD_MS = 60_000
export const ACTION_APPLY_MS = 180_000
export const ACTION_PUSH_MS = 60_000
export const ACTION_STOP_GRACE_MS = 5000
export const ACTION_KILL_AFTER_MS = ACTION_STOP_GRACE_MS + 2000
export const ACTION_REAP_MS = 2000
export const ACTION_CLEANUP_MS = 5000
// Output bounds (bytes or characters).
export const ACTION_STDERR_MAX_BYTES = 1_048_576
export const ACTION_CHILD_STDOUT_MAX_BYTES = 16_777_216
export const ACTION_EVENTS_MAX_BYTES = 67_108_864
export const ACTION_RESULT_MAX_BYTES = 16_777_216
export const ACTION_PATCH_MAX_BYTES = 16_777_216
export const ACTION_SCAN_STDOUT_MAX_BYTES = 65_536
export const ACTION_COMMENT_MAX_CHARS = 60_000
export const ACTION_META_MAX_BYTES = 65_536
export const ACTION_TASK_MAX_CHARS = 4000
export const ACTION_DEFAULT_MAX_DIFF_BYTES = 262_144
export const ACTION_MAX_DIFF_BYTES = 1_048_576
// GitHub caps a webhook payload at 25 MB; the event file is read whole.
export const ACTION_EVENT_MAX_BYTES = 26_214_400
// The W workflow fixture's hard USD cap (SPEC §7.5, D-M6).
export const ACTION_W_BUDGET_USD = 1
// The exec key line's byte cap (EXEC_KEY_MAX_BYTES).
export const ACTION_KEY_MAX_BYTES = 4096

export const DEFAULT_BOUNDS = Object.freeze({
  killAfterMs: ACTION_KILL_AFTER_MS,
  reapMs: ACTION_REAP_MS,
  cleanupMs: ACTION_CLEANUP_MS,
})

const SIGNAL_EXIT_BASE = 128
const REDACTED = '[redacted]'

/** 128 + the signal's number, as a shell reports it: 130 for SIGINT, 143 for SIGTERM, 137 for SIGKILL. */
export function signalExitCode(signal) {
  return SIGNAL_EXIT_BASE + (os.constants.signals[signal] ?? os.constants.signals.SIGTERM)
}

/** A ChildOutcome as an exit code: its code, else 128 + its signal. */
export function outcomeCode(outcome) {
  return outcome.code === null ? signalExitCode(outcome.signal ?? 'SIGTERM') : outcome.code
}

/** Step I/O outside the owner that did not finish within its bound (RVM80CD P2-5). */
export class BoundError extends Error {
  constructor(what) {
    super(`${what} did not finish in time`)
    this.name = 'BoundError'
  }
}

/**
 * `operation` settled within `withinMs`, or a BoundError: for the step's own
 * input read before the owner exists and its outputs after cleanup. A stuck
 * file operation cannot hold the step open.
 */
export async function withinBound(operation, withinMs, what) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new BoundError(what))
        }, withinMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** A latched stop refuses every later phase and child. */
export class ActionStopError extends Error {
  constructor(stop) {
    super(`stopped: ${stop.kind === 'signal' ? stop.signal : stop.kind}`)
    this.name = 'ActionStopError'
    this.stop = stop
  }
}

/** Each nonempty literal, longest first, replaced without pattern semantics. */
export function redactLiterals(text, literals) {
  const ordered = literals
    .filter((literal) => typeof literal === 'string' && literal !== '')
    .toSorted((left, right) => right.length - left.length)
  let redacted = text
  for (const literal of ordered) {
    redacted = redacted.split(literal).join(REDACTED)
  }
  return redacted
}

/**
 * True when this module file is the process's entry script. Node loads the
 * entry by its real path, so the script argument is compared after
 * resolving links, and without case on Windows (a runner's drive letter).
 */
export function isEntry(moduleUrl) {
  const script = process.argv[1]
  if (script === undefined) return false
  let real
  try {
    real = realpathSync(script)
  } catch {
    return false
  }
  const self = fileURLToPath(moduleUrl)
  return process.platform === 'win32' ? real.toLowerCase() === self.toLowerCase() : real === self
}

function processSignals(signal, run) {
  process.on(signal, run)
  return () => {
    process.off(signal, run)
  }
}

const POSIX_ALLOWED = ['LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TZ']
const WINDOWS_ALLOWED = ['SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'SystemDrive']

/** A case-insensitive read on Windows, where variable names are not case sensitive. */
function variable(env, platform, name) {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/**
 * Every child's environment, built from an allow-list (SPEC §6.2): the
 * trusted Node directory and system PATH, locale, private home/temp/data
 * folders, Windows system variables and the caller's proxy/CA inputs only.
 * Nothing else is inherited: no GIT_*, token, GITHUB_*, ACTIONS_*, RUNNER_*,
 * NODE_OPTIONS/NODE_PATH, DBUS, SSH or keyring route, and never the key.
 */
export function childEnvironment({ platform, parentEnv, paths, nodePath, network }) {
  const isWindows = platform === 'win32'
  const systemRoot = variable(parentEnv, platform, 'SystemRoot') ?? String.raw`C:\Windows`
  const system = isWindows
    ? [path.win32.join(systemRoot, 'System32'), systemRoot]
    : ['/usr/bin', '/bin']
  const env = { PATH: [path.dirname(nodePath), ...system].join(isWindows ? ';' : ':') }
  const allowed = isWindows ? WINDOWS_ALLOWED : POSIX_ALLOWED
  for (const name of allowed) {
    const value = variable(parentEnv, platform, name)
    if (value !== undefined) env[name] = value
  }
  env.HOME = paths.home
  env.TMPDIR = paths.tmp
  env.TEMP = paths.tmp
  env.TMP = paths.tmp
  env.XDG_CONFIG_HOME = path.join(paths.home, 'config')
  env.XDG_DATA_HOME = path.join(paths.home, 'data')
  env.XDG_CACHE_HOME = path.join(paths.home, 'cache')
  env.XDG_STATE_HOME = path.join(paths.home, 'state')
  if (isWindows) {
    env.USERPROFILE = paths.home
    env.APPDATA = path.join(paths.home, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.join(paths.home, 'AppData', 'Local')
  }
  if (network?.httpsProxy) {
    env.HTTPS_PROXY = network.httpsProxy
    env.https_proxy = network.httpsProxy
    env.NODE_USE_ENV_PROXY = '1'
  }
  if (network?.noProxy) {
    env.NO_PROXY = network.noProxy
    env.no_proxy = network.noProxy
  }
  if (network?.extraCaCerts) env.NODE_EXTRA_CA_CERTS = network.extraCaCerts
  return env
}

/** One running child: exact signal first, SIGKILL at the kill bound, reap bound after that. */
function createChildRecord(bounds) {
  let child
  let isClosed = false
  let isSignalled = false
  let isKilled = false
  let killTimer
  let reapTimer
  let onReapFailure
  const { promise: whenClosed, resolve: markClosed } = Promise.withResolvers()
  const forceKill = () => {
    if (isClosed || isKilled || child === undefined) return
    isKilled = true
    clearTimeout(killTimer)
    child.kill('SIGKILL')
    reapTimer = setTimeout(() => {
      if (!isClosed) onReapFailure?.(new Error('a child was not reaped after it was killed'))
    }, bounds.reapMs)
  }
  return {
    whenClosed,
    get isClosed() {
      return isClosed
    },
    attach(spawned, reapFailure) {
      child = spawned
      onReapFailure = reapFailure
    },
    terminate(cause, isRepeat) {
      if (isClosed || child === undefined) return
      if (!isSignalled) {
        isSignalled = true
        child.kill(cause.kind === 'signal' ? cause.signal : 'SIGTERM')
        killTimer = setTimeout(forceKill, bounds.killAfterMs)
      } else if (isRepeat) {
        forceKill()
      }
    },
    close() {
      isClosed = true
      clearTimeout(killTimer)
      clearTimeout(reapTimer)
      markClosed()
    },
  }
}

/** Whether `waiting` settled within `withinMs` (a rejection still rejects). */
async function within(waiting, withinMs) {
  const { promise: expired, resolve } = Promise.withResolvers()
  const timer = setTimeout(() => {
    resolve(false)
  }, withinMs)
  const settled = (async () => {
    await waiting
    return true
  })()
  // A rejection after the bound passed has nowhere to go; allSettled consumes it.
  void Promise.allSettled([settled])
  try {
    return await Promise.race([settled, expired])
  } finally {
    clearTimeout(timer)
  }
}

/** Bytes from a child stream, into memory or a private file, never past the bound. */
function boundedSink(stream, maxBytes, filePath, onOverflow, onFileError, prefixMaxBytes) {
  const chunks = []
  let bytes = 0
  let retained = 0
  const file =
    filePath === undefined ? undefined : createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
  file?.on('error', onFileError)
  stream.on('data', (chunk) => {
    bytes += chunk.length
    if (!Number.isSafeInteger(bytes) || (prefixMaxBytes === undefined && bytes > maxBytes)) {
      stream.destroy()
      onOverflow()
      return
    }
    // Review input keeps only its bounded prefix; drain/count the rest without
    // retaining it. The same child and phase deadlines still govern the stream.
    const captured =
      prefixMaxBytes === undefined
        ? chunk
        : Buffer.from(chunk.subarray(0, Math.max(0, prefixMaxBytes - retained)))
    retained += captured.length
    if (captured.length === 0) return
    if (file === undefined) chunks.push(captured)
    else file.write(captured)
  })
  return {
    bytes: () => new Uint8Array(Buffer.concat(chunks)),
    totalBytes: () => bytes,
    finish: (done) => {
      if (file === undefined) done()
      else file.end(done)
    },
  }
}

/**
 * The invocation's single owner. `stop` latches once; a later stop with a
 * repeated signal escalates the current child at once without resetting any
 * deadline. Nothing starts after a stop, and publication is never eligible
 * again. `cleanup` is bounded and always drops the secret references.
 */
export function createLauncherOwner({
  paths,
  dropSecrets,
  totalMs,
  bounds = DEFAULT_BOUNDS,
  onSignal = processSignals,
  spawnChild = spawn,
  temporaryFiles = [],
}) {
  const controller = new globalThis.AbortController()
  let cause = null
  let current
  let isCleanedUp = false
  let hasCleanupFailed = false
  const stopListeners = new Set()
  const sensitive = []

  const stop = (next) => {
    const isRepeat = cause !== null
    if (cause === null) {
      cause = next
      controller.abort(new ActionStopError(next))
      for (const listener of stopListeners) listener(next)
    }
    current?.terminate(cause, isRepeat && next.kind === 'signal')
  }

  const totalTimer = setTimeout(() => {
    stop({ kind: 'phase_timeout', phase: 'owner' })
  }, totalMs)
  totalTimer.unref?.()
  const unsubscribe = ['SIGINT', 'SIGTERM'].map((signal) =>
    onSignal(signal, () => {
      stop({ kind: 'signal', signal })
    }),
  )

  const refuseIfStopped = () => {
    if (cause !== null) throw new ActionStopError(cause)
  }
  const overflow = () => {
    stop({ kind: 'output_limit' })
  }
  const fileFailure = () => {
    stop({ kind: 'failure' })
  }

  /** Runs `operation` until it settles or the owner stops, whichever is first; bounded by `withinMs`. */
  async function phase(name, withinMs, operation) {
    refuseIfStopped()
    const { promise: stopped, reject } = Promise.withResolvers()
    const listener = (latched) => {
      reject(new ActionStopError(latched))
    }
    stopListeners.add(listener)
    const timer = setTimeout(() => {
      stop({ kind: 'phase_timeout', phase: name })
    }, withinMs)
    const running = (async () => await operation(controller.signal))()
    // A late rejection after a stop has nowhere to go; allSettled consumes it.
    void Promise.allSettled([running])
    try {
      return await Promise.race([running, stopped])
    } finally {
      clearTimeout(timer)
      stopListeners.delete(listener)
    }
  }

  function child(input) {
    refuseIfStopped()
    if (
      input.stdoutPrefixMaxBytes !== undefined &&
      (!Number.isSafeInteger(input.stdoutPrefixMaxBytes) ||
        input.stdoutPrefixMaxBytes <= 0 ||
        input.stdoutPrefixMaxBytes > input.stdoutMaxBytes)
    )
      throw new Error('stdout prefix must fit the existing output bound')
    if (current !== undefined && !current.isClosed) {
      throw new Error('the owner runs one child at a time')
    }
    const record = createChildRecord(bounds)
    current = record
    return new Promise((resolve, reject) => {
      let isSettled = false
      const fail = (error) => {
        if (isSettled) return
        isSettled = true
        record.close()
        reject(error)
      }
      let spawned
      try {
        spawned = spawnChild(input.file, [...input.args], {
          cwd: input.cwd,
          env: input.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          shell: false,
        })
      } catch (error) {
        fail(error)
        return
      }
      record.attach(spawned, fail)
      const timer = setTimeout(() => {
        stop({ kind: 'phase_timeout', phase: 'child' })
      }, input.withinMs)
      const stdout = boundedSink(
        spawned.stdout,
        input.stdoutMaxBytes,
        input.stdoutPath,
        overflow,
        fileFailure,
        input.stdoutPrefixMaxBytes,
      )
      const stderr = boundedSink(spawned.stderr, input.stderrMaxBytes, undefined, overflow)
      spawned.stdin.on('error', () => {
        // A child that exits before reading its stdin; its exit reports it.
      })
      spawned.on('error', (error) => {
        clearTimeout(timer)
        fail(error)
      })
      spawned.on('close', (code, signal) => {
        clearTimeout(timer)
        record.close()
        stdout.finish(() => {
          if (isSettled) return
          isSettled = true
          resolve({
            code,
            signal,
            stdout: stdout.bytes(),
            stderr: stderr.bytes(),
            ...(input.stdoutPrefixMaxBytes !== undefined && {
              stdoutTotalBytes: stdout.totalBytes(),
            }),
          })
        })
      })
      if (input.stdin === undefined) {
        spawned.stdin.end()
      } else {
        const bytes = Buffer.from(input.stdin)
        sensitive.push(bytes)
        spawned.stdin.end(bytes)
      }
    })
  }

  /**
   * Final cleanup: a child still running is stopped and given the kill and
   * reap bounds; then staging and temporary files are removed within the
   * cleanup bound. Whatever happens, the secret references are dropped.
   */
  async function cleanup() {
    if (isCleanedUp) return
    isCleanedUp = true
    clearTimeout(totalTimer)
    try {
      if (current !== undefined && !current.isClosed) {
        stop({ kind: 'failure' })
        const isReaped = await within(current.whenClosed, bounds.killAfterMs + bounds.reapMs)
        if (!isReaped) hasCleanupFailed = true
      }
      const removals = [paths.staging, ...temporaryFiles]
        .filter((file) => typeof file === 'string')
        .map((file) => rm(file, { force: true }))
      if (!(await within(Promise.all(removals), bounds.cleanupMs))) hasCleanupFailed = true
    } catch {
      hasCleanupFailed = true
    } finally {
      for (const bytes of sensitive) bytes.fill(0)
      sensitive.length = 0
      dropSecrets()
      for (const off of unsubscribe) off()
      stopListeners.clear()
    }
  }

  return {
    signal: controller.signal,
    get stopped() {
      return cause !== null
    },
    get cause() {
      return cause
    },
    get publicationAllowed() {
      return cause === null && !isCleanedUp
    },
    get cleanupFailed() {
      return hasCleanupFailed
    },
    stop,
    phase,
    child,
    cleanup,
  }
}
