// Committing through the user's own `git` (M123, PLAN.md D104): the
// checks before anything runs, the exact arguments, and what the consent
// names, for every editor outside VS Code.
//
// - The message rule mirrors the VS Code adapter: empty is refused, and a
//   credential-shaped string goes back masked, never into the repository.
// - `includeUnstaged` stages every change first (`git add -A`, as the git
//   extension's `all: true` does); otherwise only the index is committed.
// - Hooks and signing run as the user configured them: no `--no-verify`
//   and no `--no-gpg-sign` appear here. `readCommitSigning` reads the
//   signer's configuration for the consent; the key itself is a public
//   name or path, shown as it is.
// - Remote URLs come from the configuration itself (`git config
//   `remote.<name>.url`, as M71 reads them): `remote -v` and `get-url`
//   apply `insteadOf` rewrites, which would name the wrong repository.
// - The message travels as one `-m` value in an argument array, never near
//   a shell, so a leading `-` or a newline in it cannot become an option.

import type { GitProcess } from '../../host/git'
import { hasCredentialShapes } from './gitText'
import { readConfigValue, type NativeGitContext } from './status'

export type CommitMessageProblem = 'empty' | 'credentialShaped'

/** Why the message cannot go: empty, or shaped like a credential. */
export function commitMessageProblem(message: string): CommitMessageProblem | undefined {
  const trimmed = message.trim()
  if (trimmed === '') {
    return 'empty'
  }
  return hasCredentialShapes(trimmed) ? 'credentialShaped' : undefined
}

/** Fixed arguments: stages every change, tracked and new, before the commit. */
export function nativeStageAllArgs(): readonly string[] {
  return ['add', '-A']
}

/** Fixed shape: `commit -m`, with the trimmed message as its value. */
export function nativeCommitArgs(message: string): readonly string[] {
  return ['commit', '-m', message]
}

/** What the consent names beside hooks and credential helpers. */
export interface NativeCommitSigning {
  readonly gpgsign: boolean
  /** `gpg`, `ssh`, or `x509`, as configured; undefined when unset. */
  readonly format: string | undefined
  /** The configured key or key path; undefined when unset. */
  readonly key: string | undefined
}

/** One configuration value, read through the shared helper (exit 1 is unset). */
function signingValue(
  run: GitProcess,
  context: NativeGitContext,
  key: 'commit.gpgsign' | 'gpg.format' | 'user.signingkey',
): Promise<string | undefined> {
  return readConfigValue(run, context, key)
}

/** The signer's configuration: whether commits are signed, how, and with what. */
export async function readCommitSigning(
  run: GitProcess,
  context: NativeGitContext,
): Promise<NativeCommitSigning> {
  const [gpgsign, format, key] = await Promise.all([
    signingValue(run, context, 'commit.gpgsign'),
    signingValue(run, context, 'gpg.format'),
    signingValue(run, context, 'user.signingkey'),
  ])
  return {
    gpgsign: gpgsign?.toLowerCase() === 'true',
    format,
    key,
  }
}
