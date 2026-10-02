// How the extension runs git (the mention index, the Model API prompt's
// environment facts): by absolute path, found on the absolute PATH entries
// only, so a `git.exe` committed to the workspace is never the one that runs
// (PLAN.md D24); with a timeout, no console window, no credential prompt,
// and `GIT_OPTIONAL_LOCKS=0` so a background `git status` never takes the
// index lock out from under the user's own git.

import { type ExecFileOptions, execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
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
const CHECKOUT_FILTER_KEY = /^filter\.(.+)\.(?:clean|smudge|process|required)$/iu
const CHECKOUT_HOOK_KEY = /^hook\.(.+)\.(?:command|event|enabled)$/iu
const ATTRIBUTE_FILTER = /(?:^|\s)filter=([^\s]+)/gu
const ATTRIBUTE_FILTER_NAME = /^[\w.-]+$/u
const SAFE_CHECKOUT_ARGS = [
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

export interface GitRunnerDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  /** Only a foreign PR's checkout before its separate trust confirmation. */
  readonly isUntrustedCheckout?: boolean
  /** `execFile` as a promise of stdout; rejects on a failure, a timeout or a non-zero exit. */
  readonly execFile: (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
  ) => Promise<string>
}

type ExecFile = GitRunnerDeps['execFile']

/** Git's configuration key parts come from a foreign repository: unusable ones refuse the checkout. */
function checkoutRefusal(): Error {
  // Configuration keys and exec errors may contain private details.
  return new Error(UI_TEXT.openPullRequestFiltersUnavailable)
}

/** The per-command overrides that turn off hooks and filters need Git 2.36 or newer. */
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
 * The options that keep a foreign pull request's checkout from running
 * programs: no hooks, no fsmonitor, no replacement objects, no automatic
 * maintenance, and every configured filter and named hook switched off.
 * Filter/hook command values are never read. The attributes-file path is
 * read only to find the selectors whose drivers must also be switched off.
 */
async function checkoutOverrides(
  execFile: ExecFile,
  git: string,
  options: ExecFileOptions,
  args: readonly string[],
  deps: Pick<GitRunnerDeps, 'platform' | 'env'>,
  check?: () => void,
): Promise<readonly string[]> {
  const read = async (query: readonly string[]) => {
    check?.()
    let output: string
    try {
      output = await execFile(git, [...SAFE_CHECKOUT_ARGS, ...query], options)
    } catch {
      throw checkoutRefusal()
    }
    check?.()
    return output
  }
  const configuration = await read(['config', '--null', '--name-only', '--list'])
  const names = configuration.split('\0')
  const drivers = new Set(
    names.flatMap((name) => {
      const driver = CHECKOUT_FILTER_KEY.exec(name)?.[1]
      return driver === undefined ? [] : [driver]
    }),
  )
  if (args[0] === 'worktree' && args[1] === 'add') {
    // Attribute selectors also name filters enabled only by the destination's
    // conditional includes. Read the foreign tree, never the current checkout.
    const commit = args.at(-1)
    if (commit === undefined || !/^[\da-f]{40}(?:[\da-f]{24})?$/u.test(commit)) {
      throw checkoutRefusal()
    }
    const addAttributes = (text: string) => {
      for (const line of text.split(/\r?\n/u)) {
        if (line.trimStart().startsWith('#')) continue
        // The first field is a pattern (possibly C-quoted), never an attribute.
        const attributes = /^\s*(?:"(?:\\.|[^"\\])*"|[^\s]+)\s+(.*)$/u.exec(line)?.[1] ?? ''
        // Includes [attr] macros without evaluating patterns or include conditions.
        for (const match of attributes.matchAll(ATTRIBUTE_FILTER)) {
          const name = match[1] ?? ''
          if (!ATTRIBUTE_FILTER_NAME.test(name) || name.length > GIT_FILTER_NAME_MAX_CHARS) {
            throw checkoutRefusal()
          }
          drivers.add(name)
          if (drivers.size > GIT_FILTER_NAMES_MAX) throw checkoutRefusal()
        }
      }
    }
    const tree = await read(['ls-tree', '-r', '-z', '--name-only', commit])
    const files = tree.split('\0')
    for (const file of files) {
      if (file === '.gitattributes' || file.endsWith('/.gitattributes')) {
        addAttributes(await read(['cat-file', 'blob', `${commit}:${file}`]))
      }
    }
    const p = deps.platform === 'win32' ? path.win32 : path.posix
    const infoPath = await read([
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/attributes',
    ])
    const info = infoPath.replace(/\r?\n$/u, '')
    const attributesPath = await read([
      'config',
      '--null',
      '--path',
      '--default',
      '',
      '--get',
      'core.attributesFile',
    ])
    const configured = attributesPath.split('\0', 1)[0] ?? ''
    const home =
      environmentValue(deps.env, deps.platform, 'HOME') ??
      environmentValue(deps.env, deps.platform, 'USERPROFILE')
    // Git treats an empty XDG_CONFIG_HOME as unset, not as the current directory.
    const givenXdg = environmentValue(deps.env, deps.platform, 'XDG_CONFIG_HOME')
    const xdg =
      (givenXdg === '' ? undefined : givenXdg) ??
      (home === undefined ? undefined : p.join(home, '.config'))
    const defaultAttributes = xdg === undefined ? undefined : p.join(xdg, 'git', 'attributes')
    const global = configured === '' ? defaultAttributes : configured
    for (const file of [info, global]) {
      if (file === undefined || file === '') continue
      check?.()
      let text: string
      try {
        text = await readFile(p.resolve(String(options.cwd), file), 'utf8')
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
        throw checkoutRefusal()
      }
      check?.()
      addAttributes(text)
    }
  }
  // New Git can configure named hooks independently of core.hooksPath.
  const hooks = new Set(
    names.flatMap((name) => {
      const hook = CHECKOUT_HOOK_KEY.exec(name)?.[1]
      return hook === undefined ? [] : [hook]
    }),
  )
  // -c splits at its first '='; such subsection names cannot be represented
  // by these per-command overrides. Never guess an escape.
  if ([...drivers, ...hooks].some((name) => name.includes('=') || /\p{Cc}/u.test(name))) {
    throw checkoutRefusal()
  }
  return [
    ...SAFE_CHECKOUT_ARGS,
    ...[...drivers].flatMap((driver) => [
      '-c',
      `filter.${driver}.clean=`,
      '-c',
      `filter.${driver}.smudge=`,
      '-c',
      `filter.${driver}.process=`,
      '-c',
      `filter.${driver}.required=false`,
    ]),
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
  const env: NodeJS.ProcessEnv = {
    ...deps.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  }
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
      invocation = [
        ...(await checkoutOverrides(deps.execFile, git, options, args, deps, beforeRun)),
        ...args,
      ]
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
 * git with stdin and binary stdout (M72's checkpoints): found as the other
 * runner finds it, no console window, stdout capped at GIT_OUTPUT_MAX_BYTES
 * and stderr at GIT_STDERR_MAX_CHARS, killed at its timeout. The caller
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
      const fail = (error: Error) => {
        failure ??= error
        child.kill()
      }
      const timer = setTimeout(() => {
        fail(new Error(`git ${command} timed out after ${String(options.timeoutMs)} ms`))
      }, options.timeoutMs)
      const onAbort = () => {
        fail(new Error(`git ${command} was stopped: the window is closing`))
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => {
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
      child.on('close', (code) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        if (failure !== undefined) {
          reject(failure)
        } else if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new GitExitError(code ?? -1, stderr, command))
        }
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
