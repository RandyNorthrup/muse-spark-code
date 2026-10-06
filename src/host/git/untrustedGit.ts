// The untrusted lane (M71, PLAN.md D49): the git that lists, adds and
// indexes someone else's pull request before its separate trust
// confirmation (heldCheckout.ts). It is the extension's own runner (git.ts)
// with these arguments before each command's own, and it ships only in
// dist/conversationGit.js, beside the held checkout (PLAN.md D6).

import type { ExecFileOptions } from 'node:child_process'
import { UI_TEXT, UNTRUSTED_CHECKOUT_MIN_GIT_MINOR } from '../../shared/constants'
import {
  type GitArgsBefore,
  type GitExecFile,
  hasGitProgramControls,
  processGitRunner,
} from '../git'

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

/** An old git, or a configured name the overrides cannot spell: the checkout is refused. */
function checkoutRefusal(): Error {
  // Configuration keys and exec errors may contain private details.
  return new Error(UI_TEXT.openPullRequestFiltersUnavailable)
}

/** The per-command overrides that turn off hooks and fsmonitor need Git 2.36 or newer. */
async function requireCheckoutSafeGit(
  execFile: GitExecFile,
  git: string,
  options: ExecFileOptions,
): Promise<void> {
  let output: string
  try {
    output = await execFile(git, ['--version'], options)
  } catch {
    throw checkoutRefusal()
  }
  if (!hasGitProgramControls(output, UNTRUSTED_CHECKOUT_MIN_GIT_MINOR)) {
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
  execFile: GitExecFile,
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

/** The lane's arguments for one runner (git.ts `argsBefore`). */
export function untrustedCheckoutArgs(): GitArgsBefore {
  // The git whose version was accepted; a failed read is asked again next time.
  let supportedGit: string | undefined
  return async (execFile, git, options, beforeRun) => {
    // The owner's last check runs outside each lookup's catch: a lost
    // owner is reported as it is, never as a missing Git feature.
    if (supportedGit !== git) {
      await requireCheckoutSafeGit(execFile, git, options)
      supportedGit = git
    }
    beforeRun?.()
    return await checkoutOverrides(execFile, git, options, beforeRun)
  }
}

/** The untrusted lane over this process's git and `env` (the window's by default). */
export function untrustedGitRunner(env?: NodeJS.ProcessEnv): ReturnType<typeof processGitRunner> {
  return processGitRunner({ argsBefore: untrustedCheckoutArgs(), env })
}
