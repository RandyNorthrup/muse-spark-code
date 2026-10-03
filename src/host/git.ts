// How the extension runs git (the mention index, the Model API prompt's
// environment facts): by absolute path, found on the absolute PATH entries
// only, so a `git.exe` committed to the workspace is never the one that runs
// (PLAN.md D24); with a timeout, no console window, no credential prompt,
// and `GIT_OPTIONAL_LOCKS=0` so a background `git status` never takes the
// index lock out from under the user's own git.

import { type ExecFileOptions, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { resolveExecutable } from '../core/executables'
import { environmentValue } from '../core/backends/musecode/launch'
import {
  GIT_FILTER_NAMES_MAX,
  GIT_FILTER_NAME_MAX_CHARS,
  GIT_OUTPUT_MAX_BYTES,
  GIT_STDERR_MAX_CHARS,
  GIT_TIMEOUT_MS,
  UI_TEXT,
  UNTRUSTED_CHECKOUT_MIN_GIT_MINOR,
} from '../shared/constants'

const GIT = 'git'
const PATH_VARIABLE = 'PATH'
const GIT_MISSING = 'git was not found on the absolute entries of PATH'
const CONFIG_OPTION = '-c'
const OPTION_MARK = '-'
const FILTER_SEPARATOR = '\u{0}'
const FILTER_KEY = /^filter\.([^=\p{Cc}]+)\.(?:clean|process|required)$/u
const CHECKOUT_HOOK_KEY = /^hook\.(.+)\.(?:command|event|enabled)$/iu
/**
 * Every git a held pull request's checkout runs (heldCheckout.ts) runs with
 * these: no hooks, no fsmonitor, no replacement objects, no automatic
 * maintenance or garbage collection.
 */
export const UNTRUSTED_CHECKOUT_OPTIONS: readonly string[] = [
  '--no-replace-objects',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
]
const filterKeys = z
  .array(z.string().check(z.maxLength(GIT_FILTER_NAME_MAX_CHARS), z.regex(FILTER_KEY)))
  .check(z.maxLength(GIT_FILTER_NAMES_MAX))

/** Names only become scoped overrides; configured command values are never read. */
export function gitFilterOptions(output: string): readonly string[] {
  const names = output === '' ? [] : output.split(FILTER_SEPARATOR)
  if (names.at(-1) === '') {
    names.pop()
  }
  const parsed = filterKeys.safeParse(names)
  if (!parsed.success) {
    throw new Error(UI_TEXT.checkpointFailed)
  }
  const drivers = new Set(parsed.data.map((key) => key.slice(0, key.lastIndexOf('.'))))
  return [...drivers].flatMap((driver) => [
    '-c',
    `${driver}.clean=`,
    '-c',
    `${driver}.process=`,
    '-c',
    `${driver}.required=false`,
  ])
}

/** git is not on the absolute entries of PATH (D24): nothing ran. */
export class GitMissingError extends Error {
  public constructor() {
    super(GIT_MISSING)
    this.name = 'GitMissingError'
  }
}

/** Local error identity must survive our independently built host bundles. */
export function isGitMissingError(value: unknown): value is GitMissingError {
  return value instanceof Error && value.name === 'GitMissingError'
}

/** The subcommand of an argument list, past `-c name=value` pairs and other options. */
function subcommandOf(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === CONFIG_OPTION) {
      index += 1
    } else if (!arg.startsWith(OPTION_MARK)) {
      return arg
    }
  }
  return GIT
}

/**
 * git's absolute path, found once per PATH value; a miss is not cached, so
 * git installed while the window is open is found on the next call.
 */
function gitLocator(
  deps: Pick<GitRunnerDeps, 'platform' | 'env' | 'fileExists'>,
): () => string | undefined {
  let cache: { readonly pathValue: string | undefined; readonly git: string } | undefined
  return () => {
    const pathValue = environmentValue(deps.env, deps.platform, PATH_VARIABLE)
    if (cache === undefined || cache.pathValue !== pathValue) {
      const git = resolveExecutable(GIT, {
        platform: deps.platform,
        pathVariable: pathValue,
        fileExists: deps.fileExists,
      })
      cache = git === undefined ? undefined : { pathValue, git }
    }
    return cache?.git
  }
}

/** The extension's git environment: no optional locks, and never a credential prompt. */
export function quietGitEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
}

export interface GitRunnerDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  /**
   * Only the git that lists, adds and indexes someone else's pull request
   * before its separate trust confirmation (heldCheckout.ts).
   */
  readonly isUntrustedCheckout?: boolean
  /** `execFile` as a promise of stdout; rejects on a failure, a timeout or a non-zero exit. */
  readonly execFile: (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ) => Promise<string>
}

type ExecFile = GitRunnerDeps['execFile']

/** An old git, or a configured name the overrides cannot spell: the checkout is refused. */
function checkoutRefusal(): Error {
  // Configuration keys and exec errors may contain private details.
  return new Error(UI_TEXT.openPullRequestFiltersUnavailable)
}

/** The per-command overrides that turn off hooks and fsmonitor need Git 2.36 or newer. */
async function requireCheckoutSafeGit(
  execFile: ExecFile,
  git: string,
  options: ExecFileOptions,
): Promise<void> {
  let output: string
  try {
    output = await execFile(git, ['--version'], options)
  } catch {
    throw checkoutRefusal()
  }
  const version = /^git version (\d+)\.(\d+)/u.exec(output)
  const major = Number(version?.[1])
  const minor = Number(version?.[2])
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    major < 2 ||
    (major === 2 && minor < UNTRUSTED_CHECKOUT_MIN_GIT_MINOR)
  ) {
    throw checkoutRefusal()
  }
}

/**
 * The options that keep the untrusted lane's git from running programs: the
 * fixed ones above, and every named hook the configuration where it runs
 * defines switched off (hook commands are never read). The lane never
 * checks a tree out (heldCheckout.ts writes the files), so no filter needs
 * switching off.
 */
async function checkoutOverrides(
  execFile: ExecFile,
  git: string,
  options: ExecFileOptions,
  check?: () => void,
): Promise<readonly string[]> {
  check?.()
  let configuration: string
  try {
    configuration = await execFile(
      git,
      [...UNTRUSTED_CHECKOUT_OPTIONS, 'config', '--null', '--name-only', '--list'],
      options,
    )
  } catch {
    throw checkoutRefusal()
  }
  check?.()
  // New Git can configure named hooks independently of core.hooksPath.
  const hooks = new Set(
    configuration.split('\0').flatMap((name) => {
      const hook = CHECKOUT_HOOK_KEY.exec(name)?.[1]
      return hook === undefined ? [] : [hook]
    }),
  )
  // -c splits at its first '='; such subsection names cannot be represented
  // by these per-command overrides. Never guess an escape.
  if ([...hooks].some((name) => name.includes('=') || /\p{Cc}/u.test(name))) {
    throw checkoutRefusal()
  }
  return [
    ...UNTRUSTED_CHECKOUT_OPTIONS,
    ...[...hooks].flatMap((hook) => [
      '-c',
      `hook.${hook}.enabled=false`,
      '-c',
      `hook.${hook}.event=`,
    ]),
  ]
}

/**
 * A git runner; rejects when git is not on the absolute PATH. A call that
 * does real work (a worktree's checkout, M32) passes its own timeout.
 */
export function createGitRunner(
  deps: GitRunnerDeps,
): (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
  beforeRun?: () => void,
) => Promise<string> {
  const env = quietGitEnvironment(deps.env)
  const gitPath = gitLocator(deps)
  // The git whose version was accepted; a failed read is asked again next time.
  let supportedGit: string | undefined
  return async (args, cwd, timeoutMs = GIT_TIMEOUT_MS, beforeRun) => {
    const git = gitPath()
    if (git === undefined) {
      throw new GitMissingError()
    }
    const options: ExecFileOptions = {
      cwd,
      env,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    }
    beforeRun?.()
    let invocation = args
    if (deps.isUntrustedCheckout === true) {
      // The owner's last check runs outside each lookup's catch: a lost
      // owner is reported as it is, never as a missing Git feature.
      if (supportedGit !== git) {
        await requireCheckoutSafeGit(deps.execFile, git, options)
        supportedGit = git
      }
      beforeRun?.()
      invocation = [...(await checkoutOverrides(deps.execFile, git, options, beforeRun)), ...args]
    }
    // Metadata discovery awaits; current trust/ownership checks directly precede process entry.
    beforeRun?.()
    return await deps.execFile(git, invocation, options)
  }
}

const execFileAsync = promisify(execFile)

/**
 * The runner over this process's own environment and Node's `execFile`: the
 * one the extension uses, and the one tests use to drive real git (M32).
 */
export function processGitRunner(
  given: { readonly isUntrustedCheckout?: boolean; readonly env?: NodeJS.ProcessEnv } = {},
): (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
  beforeRun?: () => void,
) => Promise<string> {
  return createGitRunner({
    platform: process.platform,
    env: given.env ?? process.env,
    isUntrustedCheckout: given.isUntrustedCheckout === true,
    fileExists: existsSync,
    execFile: async (file, args, options) => {
      const { stdout } = await execFileAsync(file, [...args], { ...options, encoding: 'utf8' })
      return stdout
    },
  })
}

/** git ended with a non-zero exit code: the code and what it said (capped). */
export class GitExitError extends Error {
  public constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
    command: string,
  ) {
    super(`git ${command} exited with code ${String(exitCode)}: ${stderr.trim()}`)
    this.name = 'GitExitError'
  }
}

/** All extra fields are checked; the original error/message are retained. */
export function isGitExitError(value: unknown): value is GitExitError {
  return (
    value instanceof Error &&
    value.name === 'GitExitError' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    Number.isSafeInteger(value.exitCode) &&
    'stderr' in value &&
    typeof value.stderr === 'string'
  )
}

export interface GitProcessOptions {
  readonly cwd: string
  /** The child's whole environment: nothing else is inherited. */
  readonly env: NodeJS.ProcessEnv
  /** Written to stdin, which is then closed; stdin is empty without it. */
  readonly input?: string | Uint8Array
  readonly timeoutMs: number
  /** Aborting ends the command (the window closing). */
  readonly signal?: AbortSignal
  /**
   * Takes stdout as it comes instead of collecting it (M71's held checkout):
   * git waits until each chunk's promise settles, a rejection ends the
   * command with that error, and the result is empty.
   */
  readonly onStdout?: (chunk: Buffer) => Promise<void>
}

/** One git command's stdout as bytes; rejects on a failure, a timeout or a non-zero exit. */
export type GitProcess = (args: readonly string[], options: GitProcessOptions) => Promise<Buffer>

export interface GitProcessDeps {
  readonly platform: NodeJS.Platform
  /** Where git is looked for: this environment's PATH, absolute entries only (D24). */
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  readonly spawn: typeof spawn
}

/**
 * git with stdin and binary stdout (M72's checkpoints, M71's held checkout):
 * found as the other runner finds it, no console window, collected stdout
 * capped at GIT_OUTPUT_MAX_BYTES (a taker bounds its own) and stderr at
 * GIT_STDERR_MAX_CHARS, killed at its timeout. The caller
 * passes the complete environment, so nothing of the extension host's own
 * (a `GIT_DIR`, a `GIT_INDEX_FILE`) reaches it unless the caller says so.
 */
export function createGitProcess(deps: GitProcessDeps): GitProcess {
  const gitPath = gitLocator(deps)
  return (args, options) =>
    new Promise<Buffer>((resolve, reject) => {
      const git = gitPath()
      if (git === undefined) {
        reject(new GitMissingError())
        return
      }
      const command = subcommandOf(args)
      if (options.signal?.aborted === true) {
        reject(new Error(`git ${command} was not started: the window is closing`))
        return
      }
      const child = deps.spawn(git, [...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      let failure: Error | undefined
      // A failure (the timeout, the window closing) also ends the wait for a
      // taker still busy with a chunk after the child closed.
      // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
      const stopping = new AbortController()
      const stopped = new Promise<void>((resolveStopped) => {
        stopping.signal.addEventListener(
          'abort',
          () => {
            resolveStopped()
          },
          { once: true },
        )
      })
      const fail = (error: Error) => {
        failure ??= error
        child.kill()
        stopping.abort()
      }
      const timer = setTimeout(() => {
        fail(new Error(`git ${command} timed out after ${String(options.timeoutMs)} ms`))
      }, options.timeoutMs)
      const onAbort = () => {
        fail(new Error(`git ${command} was stopped: the window is closing`))
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      // A taker's chunks, one at a time and in order. A pause does not stop
      // chunks already read, and the child closes once its last chunk is
      // emitted, not taken: the command settles after this chain.
      let taking = Promise.resolve()
      const takeInTurn = async (
        previous: Promise<void>,
        take: (chunk: Buffer) => Promise<void>,
        chunk: Buffer,
      ): Promise<void> => {
        await previous
        try {
          // Nothing reaches the taker after a failure.
          if (failure === undefined) {
            await take(chunk)
          }
        } catch (error: unknown) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
        child.stdout.resume()
      }
      child.stdout.on('data', (chunk: Buffer) => {
        const take = options.onStdout
        if (take !== undefined) {
          child.stdout.pause()
          taking = takeInTurn(taking, take, chunk)
          return
        }
        size += chunk.length
        if (size > GIT_OUTPUT_MAX_BYTES) {
          fail(new Error(`git ${command} wrote more than ${String(GIT_OUTPUT_MAX_BYTES)} bytes`))
          return
        }
        chunks.push(chunk)
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < GIT_STDERR_MAX_CHARS) {
          stderr = `${stderr}${chunk}`.slice(0, GIT_STDERR_MAX_CHARS)
        }
      })
      // A command that exits before reading all of stdin closes the pipe
      // under the write; its exit code says what went wrong.
      child.stdin.on('error', () => {
        // Nothing to add: the exit code reports it.
      })
      child.on('error', (error) => {
        fail(error)
      })
      // The timeout and the abort stay armed until the taker is done.
      const settle = async (code: number | null): Promise<void> => {
        await Promise.race([taking, stopped])
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        if (failure !== undefined) {
          reject(failure)
        } else if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new GitExitError(code ?? -1, stderr, command))
        }
      }
      child.on('close', (code) => {
        void settle(code)
      })
      child.stdin.end(options.input ?? '')
    })
}

/** Whether git is on the absolute entries of this process's PATH (M72's availability). */
export function processGitLocator(): () => boolean {
  const locate = gitLocator({
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
  })
  return () => locate() !== undefined
}

/** The process runner over this process's PATH and Node's `spawn` (M72). */
export function processGitProcess(): GitProcess {
  return createGitProcess({
    platform: process.platform,
    env: process.env,
    fileExists: existsSync,
    spawn,
  })
}
