import { resourceEnvironment } from '../core/resources/launch'
// How the extension runs git (the mention index, the Model API prompt's
// environment facts): by absolute path, found on the absolute PATH entries
// only, so a `git.exe` committed to the workspace is never the one that runs
// (PLAN.md D24); with a timeout, no console window, no credential prompt,
// and `GIT_OPTIONAL_LOCKS=0` so a background `git status` never takes the
// index lock out from under the user's own git.

import { type ExecFileOptions, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { admitResource, resourceWindowsJob, stopResourceTree } from '../core/resources/admission'
import { spawnMcpJob } from './backend/mcpJobLaunch'
import { observeResourceProcess } from './resources/resourceAdmission'
import { treeSpawnOptions } from './processTree'
import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { resolveExecutable } from '../core/executables'
import type { BestOfNGitGuard } from '../core/bestOfN/bestOfNRunner'
import { environmentValue } from '../core/backends/musecode/launch'
import {
  BEST_OF_N_MIN_GIT_MINOR,
  GIT_FILTER_NAMES_ARGS,
  GIT_FILTER_NAMES_MAX,
  GIT_FILTER_NAME_MAX_CHARS,
  GIT_METADATA_OPTIONS,
  GIT_OUTPUT_MAX_BYTES,
  type GIT_PUSH_CREDENTIAL_VARIABLES,
  GIT_STDERR_MAX_CHARS,
  GIT_TIMEOUT_MS,
  UI_TEXT,
} from '../shared/constants'

import { withoutCredentials } from '../core/credentialEnvironment'

const GIT = 'git'
const PATH_VARIABLE = 'PATH'
const GIT_MISSING = 'git was not found on the absolute entries of PATH'
const CONFIG_OPTION = '-c'
const OPTION_MARK = '-'
const FILTER_SEPARATOR = '\u{0}'
const FILTER_KEY = /^filter\.([^=\p{Cc}]+)\.(?:clean|process|required)$/u
// Best-of-N's automatic snapshots run with no hook, no fsmonitor, no replace
// refs and no maintenance, and refuse a repository that configures a program.
const AUTOMATIC_ARGS = [
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
const PROGRAM_CONFIG = /^(?:filter\..+\.(?:clean|smudge|process)|hook\..+\.command)$/iu
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

/**
 * git for an automatic metadata read in `cwd` (the prompt's facts, D15; the
 * session board, M77): no fsmonitor, maintenance, replacement refs or
 * signature program (GIT_METADATA_OPTIONS), and each configured filter
 * driver's clean and process emptied by name, its command never read. The
 * runner's `GIT_OPTIONAL_LOCKS=0` takes no index lock, so status writes no
 * index and no index hook runs. Rejects when the names cannot be read.
 */
export async function metadataGit(
  runGit: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>,
  cwd: string,
): Promise<(args: readonly string[], timeoutMs?: number) => Promise<string>> {
  let names: string
  try {
    names = await runGit([...GIT_METADATA_OPTIONS, ...GIT_FILTER_NAMES_ARGS], cwd)
  } catch (error: unknown) {
    // `config --get-regexp` exits 1 when no filter is configured.
    if (gitExitCode(error) !== 1) {
      throw error
    }
    names = ''
  }
  const filters = gitFilterOptions(names)
  return async (args, timeoutMs) =>
    await runGit([...GIT_METADATA_OPTIONS, ...filters, ...args], cwd, timeoutMs)
}

/** git is not on the absolute entries of PATH (D24): nothing ran. */
export class GitMissingError extends Error {
  public constructor() {
    super(GIT_MISSING)
    this.name = 'GitMissingError'
  }
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
  return { ...withoutCredentials(env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
}

export interface GitRunnerDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  /**
   * Arguments put before each command's own once the runner found git:
   * only the untrusted lane that lists, adds and indexes someone else's
   * pull request before its separate trust confirmation (git/untrustedGit.ts,
   * heldCheckout.ts). It may run git itself with the call's options, and
   * calls `beforeRun` where a check must precede a process.
   */
  readonly argsBefore?: GitArgsBefore | undefined
  /** Best-of-N's automatic local snapshots, never ordinary user Git commands. */
  readonly isAutomatic?: boolean
  /** `execFile` as a promise of stdout; rejects on a failure, a timeout or a non-zero exit. */
  readonly execFile: (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    input?: string,
    beforeRun?: BestOfNGitGuard,
  ) => Promise<string>
}

/** `execFile` as the runner calls it. */
export type GitExecFile = GitRunnerDeps['execFile']

/** What `argsBefore` is handed: the runner's `execFile`, the git it found, the call's options and check. */
export type GitArgsBefore = (
  execFile: GitExecFile,
  git: string,
  options: ExecFileOptions,
  beforeRun?: () => void,
) => Promise<readonly string[]>

/** Git's hooks/fsmonitor controls require a known major and minimum minor version. */
export function hasGitProgramControls(output: string, minimumMinor: number): boolean {
  const version = /^git version (\d+)\.(\d+)/u.exec(output)
  const major = Number(version?.[1])
  const minor = Number(version?.[2])
  return (
    Number.isSafeInteger(major) &&
    Number.isSafeInteger(minor) &&
    (major > 2 || (major === 2 && minor >= minimumMinor))
  )
}

/**
 * A git runner; rejects when git is not on the absolute PATH. A call that
 * does real work (a worktree's checkout, M32) passes its own timeout;
 * `Infinity` is no deadline of ours (M123: as in VS Code's own Git, only
 * Cancel and the window's closing stop the call).
 */
export function createGitRunner(
  deps: GitRunnerDeps,
): (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
  input?: string,
  beforeRun?: BestOfNGitGuard,
) => Promise<string> {
  const env = quietGitEnvironment(deps.env)
  const gitPath = gitLocator(deps)
  let supportedVersion: { readonly git: string; readonly checked: Promise<void> } | undefined
  return async (args, cwd, timeoutMs = GIT_TIMEOUT_MS, input, beforeRun) => {
    const git = gitPath()
    if (git === undefined) {
      throw new GitMissingError()
    }
    const options: ExecFileOptions = {
      cwd,
      env,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      // Node's execFile reads a timeout of 0 as none.
      timeout: timeoutMs === Infinity ? 0 : timeoutMs,
      windowsHide: true,
      ...(beforeRun?.signal !== undefined && { signal: beforeRun.signal }),
    }
    beforeRun?.()
    if (deps.isAutomatic === true) {
      if (supportedVersion?.git !== git) {
        supportedVersion = {
          git,
          checked: (async () => {
            const output = await deps.execFile(git, ['--version'], options)
            if (!hasGitProgramControls(output, BEST_OF_N_MIN_GIT_MINOR)) {
              throw new Error(UI_TEXT.bestOfNGitProgramsUnavailable)
            }
          })(),
        }
      }
      await supportedVersion.checked
      beforeRun?.()
      const location = args.filter(
        (arg) => arg.startsWith('--git-dir=') || arg.startsWith('--work-tree='),
      )
      const names = await deps.execFile(
        git,
        [...AUTOMATIC_ARGS, ...location, 'config', '--null', '--name-only', '--list'],
        options,
      )
      if (names.split('\0').some((name) => PROGRAM_CONFIG.test(name))) {
        throw new Error(UI_TEXT.bestOfNGitProgramsUnavailable)
      }
    }
    const prefix =
      deps.argsBefore === undefined
        ? []
        : await deps.argsBefore(deps.execFile, git, options, beforeRun)
    const invocation = [...(deps.isAutomatic === true ? AUTOMATIC_ARGS : []), ...prefix, ...args]
    await beforeRun?.prepare?.()
    // Configuration/version reads can await. The owned caller rechecks
    // synchronously here, with no await before the actual process entry.
    beforeRun?.()
    if (beforeRun !== undefined)
      return await deps.execFile(git, invocation, options, input, beforeRun)
    return input === undefined
      ? await deps.execFile(git, invocation, options)
      : await deps.execFile(git, invocation, options, input)
  }
}

/**
 * The runner over this process's own environment and Node's `execFile`: the
 * one the extension uses, and the one tests use to drive real git (M32).
 */
export function processGitRunner(
  options: {
    readonly isAutomatic?: boolean
    readonly argsBefore?: GitArgsBefore | undefined
    readonly env?: NodeJS.ProcessEnv | undefined
  } = {},
): (
  args: readonly string[],
  cwd: string,
  timeoutMs?: number,
  input?: string,
  beforeRun?: BestOfNGitGuard,
) => Promise<string> {
  return createGitRunner({
    platform: process.platform,
    env: options.env ?? process.env,
    argsBefore: options.argsBefore,
    fileExists: existsSync,
    isAutomatic: options.isAutomatic === true,
    execFile: async (_file, args, options, input, beforeRun) => {
      if (typeof options.cwd !== 'string' || options.env === undefined)
        throw new Error('Git requires an explicit working directory and environment')
      const run = createGitProcess({
        platform: process.platform,
        env: options.env,
        fileExists: existsSync,
        spawn,
      })
      const result = await run(args, {
        cwd: options.cwd,
        env: options.env,
        // A timeout of 0 is the runner's "no deadline" (see createGitRunner).
        timeoutMs: options.timeout === 0 ? undefined : (options.timeout ?? GIT_TIMEOUT_MS),
        ...(input !== undefined && { input }),
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(beforeRun !== undefined && { beforeRun }),
      })
      return result.toString('utf8')
    },
  })
}

/**
 * A failed git call's exit code, however the runner reported it: a
 * `GitExitError` carries it in `exitCode`, which is -1 when a signal ended
 * git (the runner's own sentinel, never a real exit code); a Node
 * child-process error carries a numeric `code`. Undefined when the call
 * produced no exit at all (git missing, a timeout, a capped buffer): never a
 * guess. A caller that acts on one specific code compares for that code and
 * treats every other value, -1 included, as a failure.
 */
export function gitExitCode(error: unknown): number | undefined {
  if (isGitExitError(error)) {
    return error.exitCode
  }
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
    ? error.code
    : undefined
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
  /** Checkpoint Git bypasses temp pressure and checks this storage volume instead. */
  readonly checkpointDestination?: string | undefined
  /**
   * D104's named exception (M123): a confirmed push or a pull request fetch
   * keeps the user's own Git environment (credential helpers, SSH agent and
   * token variables, as a terminal would), with `GIT_TERMINAL_PROMPT=0`.
   * Everything else keeps the quiet environment. The process never gains
   * anything of ours either way: no `http.extraHeader`, no credential
   * helper of ours, no token variable. The caller hands the very list
   * (GIT_PUSH_CREDENTIAL_VARIABLES), so activation does not carry it.
   */
  readonly credentialRoutes?: typeof GIT_PUSH_CREDENTIAL_VARIABLES | undefined
  readonly beforeRun?: BestOfNGitGuard | undefined
  readonly cwd: string
  /** The child's whole environment: nothing else is inherited. */
  readonly env: NodeJS.ProcessEnv
  /** Written to stdin, which is then closed; stdin is empty without it. */
  readonly input?: string | Uint8Array
  /**
   * The deadline, or undefined for none (M123's native route: a push, a
   * fetch or a commit's hooks run as long as they take; Cancel and the
   * window's closing stop them through `signal`).
   */
  readonly timeoutMs: number | undefined
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
  /**
   * The git to run instead of a PATH search (M123's native route: the git
   * the host resolved, absolute only, `fixedGitLocator`), or undefined
   * when there is none, so the run fails as git missing (D24).
   */
  readonly locate?: (() => string | undefined) | undefined
}

/**
 * One environment for both launch routes, an allow-list per operation
 * (RVM123G2 R3): no credential variable at all, or for D104's exception
 * (a confirmed push, a pull request fetch) only the Git routes
 * GIT_PUSH_CREDENTIAL_VARIABLES names, never a model or provider key.
 */
function childGitEnvironment(options: GitProcessOptions): NodeJS.ProcessEnv {
  return options.credentialRoutes === undefined
    ? withoutCredentials(options.env)
    : {
        ...withoutCredentials(options.env, options.credentialRoutes),
        GIT_TERMINAL_PROMPT: '0',
      }
}

/**
 * The stderr kept for an error: once the cap cut it, the last (partial)
 * word goes too, so a credential cut short at the cap, no longer in a shape
 * the redactor knows, is never shown, logged or returned (redact before
 * truncate).
 */
export function cappedStderr(stderr: string, wasCut: boolean): string {
  if (!wasCut) {
    return stderr
  }
  const lastSpace = stderr.search(/\s\S*$/u)
  return lastSpace === -1 ? '' : stderr.slice(0, lastSpace + 1)
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
  const gitPath = deps.locate ?? gitLocator(deps)
  return async (args, options) => {
    const resource =
      options.checkpointDestination === undefined
        ? await admitResource('other', options.signal, options.beforeRun?.resourceClass)
        : await admitResource(
            'other',
            options.signal,
            'checkpoint',
            false,
            options.checkpointDestination,
          )
    let wasSpawned = false
    try {
      const job =
        resource === undefined || deps.platform !== 'win32' ? undefined : await resourceWindowsJob()
      options.beforeRun?.()
      return await new Promise<Buffer>((resolve, reject) => {
        const git = gitPath()
        if (git === undefined) {
          resource?.complete(true)
          reject(new GitMissingError())
          return
        }
        const command = subcommandOf(args)
        if (options.signal?.aborted === true) {
          resource?.complete(true)
          reject(new Error(`git ${command} was not started: the window is closing`))
          return
        }
        // The same environment on both routes: the governed Windows job too
        // keeps D104's user environment for a push and a fetch (M123).
        const childEnv = resourceEnvironment(childGitEnvironment(options), resource)
        // The Windows helper creates git only after GO: the caller's check
        // runs again at that authorization, after the helper's own start
        // (RVM123G2 R1), and its refusal is this command's.
        let refusal: Error | undefined
        const guard = options.beforeRun
        const authorize =
          guard === undefined
            ? undefined
            : () => {
                try {
                  guard()
                } catch (error: unknown) {
                  refusal = error instanceof Error ? error : new Error(String(error))
                  throw error
                }
              }
        const child =
          job === undefined
            ? deps.spawn(git, [...args], {
                cwd: options.cwd,
                env: childEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
                ...treeSpawnOptions(deps.platform),
              })
            : spawnMcpJob({
                executablePath: job.executablePath,
                file: git,
                args,
                cwd: options.cwd,
                env: childEnv,
                isVerbatim: false,
                log: () => {
                  /* The launcher returns its failure through the process streams. */
                },
                resource,
                resourceAssembly: job.assemblyPath,
                authorize,
              })
        wasSpawned = true
        if (job === undefined) observeResourceProcess(resource, child)
        const chunks: Buffer[] = []
        let size = 0
        let stderr = ''
        let isStderrCut = false
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
          if (resource === undefined) child.kill()
          else
            void stopResourceTree(resource).catch((stopError: unknown) => {
              failure =
                stopError instanceof Error
                  ? stopError
                  : new Error('Registered Git tree stop failed')
              clearTimeout(timer)
              options.signal?.removeEventListener('abort', onAbort)
              child.stdout.destroy()
              child.stderr.destroy()
              reject(failure)
            })
          stopping.abort()
        }
        const { timeoutMs } = options
        const timer =
          timeoutMs === undefined
            ? undefined
            : setTimeout(() => {
                fail(new Error(`git ${command} timed out after ${String(timeoutMs)} ms`))
              }, timeoutMs)
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
            const joined = `${stderr}${chunk}`
            isStderrCut ||= joined.length > GIT_STDERR_MAX_CHARS
            stderr = joined.slice(0, GIT_STDERR_MAX_CHARS)
          } else if (chunk !== '') {
            isStderrCut = true
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
          if (refusal !== undefined) {
            reject(refusal)
          } else if (failure !== undefined) {
            reject(failure)
          } else if (code === 0) {
            resolve(Buffer.concat(chunks))
          } else {
            reject(new GitExitError(code ?? -1, cappedStderr(stderr, isStderrCut), command))
          }
        }
        child.on('close', (code) => {
          void settle(code)
        })
        child.stdin.end(options.input ?? '')
      })
    } catch (error: unknown) {
      resource?.complete(!wasSpawned)
      throw error
    }
  }
}

/** git's absolute path on this process's PATH (D24), for M123's native route; undefined when absent. */
export function processGitPath(): string | undefined {
  return gitLocator({ platform: process.platform, env: process.env, fileExists: existsSync })()
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
