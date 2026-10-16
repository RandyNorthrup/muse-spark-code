// A bounded, binary-safe diff through the user's own `git` (M123,
// PLAN.md D104): the change text behind the commit form's counts and the
// draft prompts, for every editor outside VS Code.
//
// The arguments are fixed (only staged or not; for a pull request's draft,
// the remote and the base, each checked plain); no path or option comes
// from user text, so nothing here can be talked into another command.
// The bytes are capped by the runner and cut here at a whole line, so a
// display string never ends mid-line; cutting mid-character inside a
// multi-byte sequence decodes as the replacement character, which only the
// panel shows. Pure besides the injected run.

import type { GitProcess } from '../../host/git'
import { GIT_PROMPT_COMMITS_MAX, GIT_TIMEOUT_MS } from '../../shared/constants'
import { isPlainRefName } from './pushPlan'
import type { NativeGitContext } from './status'

const NEWLINE_BYTE = 0x0a

/** Fixed arguments: the subcommand and every flag, no user text. */
export function nativeDiffArgs(isStaged: boolean): readonly string[] {
  return isStaged
    ? ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--cached']
    : ['diff', '--no-color', '--no-ext-diff', '--no-textconv']
}

export interface TruncatedDiff {
  readonly bytes: Buffer
  /** True when the output was longer than the cap. */
  readonly truncated: boolean
}

/**
 * At most `maxBytes` of `output`, cut back to the last whole line. A
 * single line longer than the cap is cut hard (its tail decodes with
 * replacements); an empty output is never "truncated".
 */
export function truncateDiffBytes(output: Buffer, maxBytes: number): TruncatedDiff {
  if (output.length <= maxBytes) {
    return { bytes: output, truncated: false }
  }
  const window = output.subarray(0, maxBytes)
  const newline = window.lastIndexOf(NEWLINE_BYTE)
  return {
    bytes: newline === -1 ? Buffer.from(window) : Buffer.from(window.subarray(0, newline + 1)),
    truncated: true,
  }
}

/** The staged or unstaged diff, capped by the runner and cut whole-line. */
export async function readNativeDiff(
  run: GitProcess,
  context: NativeGitContext,
  isStaged: boolean,
  maxBytes: number,
): Promise<TruncatedDiff> {
  const output = await run(nativeDiffArgs(isStaged), {
    cwd: context.cwd,
    env: context.env,
    timeoutMs: GIT_TIMEOUT_MS,
    ...(context.signal !== undefined && { signal: context.signal }),
  })
  return truncateDiffBytes(output, maxBytes)
}

/** `refs/remotes/<remote>/<base>`: the remote-tracking branch a pull request compares with. */
export function remoteBaseRef(remote: string, base: string): string {
  return `refs/remotes/${remote}/${base}`
}

/**
 * Whether `name` may stand in a pull request's base range: a plain ref
 * name (no option, force mark, `:` or whitespace) that git cannot read as
 * a range or a reflog step either.
 */
export function isRangeSafeRefName(name: string): boolean {
  return isPlainRefName(name) && !name.includes('..') && !name.includes('@{')
}

/**
 * The subjects of the commits a pull request would carry (M71's draft
 * prompt), newest first and at most `GIT_PROMPT_COMMITS_MAX`. Fixed flags;
 * the only names are the remote and the base, checked plain.
 */
export function nativeBranchLogArgs(remote: string, base: string): readonly string[] {
  return [
    'log',
    '--no-color',
    '--format=%s',
    `--max-count=${String(GIT_PROMPT_COMMITS_MAX)}`,
    `${remoteBaseRef(remote, base)}..HEAD`,
  ]
}

/** The files the branch changed since the base, NUL-separated, as M71's prompt lists them. */
export function nativeBranchFilesArgs(remote: string, base: string): readonly string[] {
  return [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--name-only',
    '-z',
    remoteBaseRef(remote, base),
    'HEAD',
  ]
}
