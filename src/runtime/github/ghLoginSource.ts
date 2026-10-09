// D104 source (c): the user's existing `gh` login, opt in only
// (`museSpark.github.useGhLogin` in user or machine settings; a
// repository's value never counts, `isGhLoginEnabled`). The runtime runs
// `gh auth token --hostname github.com` as a governed spawn with explicit
// arguments, no shell, capped output and no credential variable of ours,
// and holds the token in memory for the one call it is asked for: nothing
// is cached or stored. Each token is registered with the redactor.
//
// `gh` keeps its own login: a 401 and Sign out forget nothing of ours and
// never run `gh auth logout`.

import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { registerSecretValue } from '../../core/redact'
import {
  isGhLoginEnabled,
  type GitHubTokenSource,
  type SettingInspection,
} from '../../core/git/tokenSource'
import {
  GH_AUTH_TOKEN_ARGS,
  GH_AUTH_TOKEN_MAX_BYTES,
  GH_AUTH_TOKEN_TIMEOUT_MS,
} from '../../shared/constants'

/** How `gh` is started: its absolute path, and any leading arguments (a test's script). */
export interface GhInvocation {
  readonly command: string
  readonly args: readonly string[]
}

export interface GhLoginSourceDeps {
  /** `museSpark.github.useGhLogin` by scope, read at each call. */
  readonly setting: () => SettingInspection | undefined
  /** `gh` resolved as `git` is (an absolute PATH entry); undefined when absent. */
  readonly gh: () => GhInvocation | undefined
  /** The governed runner (`execResourceFile('probe', …)`). */
  readonly run: (
    file: string,
    args: readonly string[],
    options: ExecFileOptionsWithStringEncoding,
  ) => Promise<{ readonly stdout: string }>
  readonly environment: () => NodeJS.ProcessEnv
  readonly fetch: typeof fetch
}

// One line of token characters; anything else is not taken for a token.
const TOKEN_LINE = /^[\w.-]+\r?\n?$/u

export function ghLoginSource(deps: GhLoginSourceDeps): GitHubTokenSource {
  const registered = new Set<string>()
  return {
    kind: 'ghLogin',
    async credential(_mode, signal) {
      if (!isGhLoginEnabled(deps.setting())) return
      const gh = deps.gh()
      if (gh === undefined) return
      let stdout: string
      try {
        ;({ stdout } = await deps.run(gh.command, [...gh.args, ...GH_AUTH_TOKEN_ARGS], {
          encoding: 'utf8',
          // gh reads its own store; a GH_TOKEN or GITHUB_TOKEN of ours never reaches it.
          env: withoutCredentials(deps.environment()),
          signal,
          timeout: GH_AUTH_TOKEN_TIMEOUT_MS,
          maxBuffer: GH_AUTH_TOKEN_MAX_BYTES,
          windowsHide: true,
        }))
      } catch {
        signal.throwIfAborted()
        // Signed out, missing or failing: gh's words are not read or logged.
        return
      }
      if (!TOKEN_LINE.test(stdout)) return
      const token = stdout.trim()
      if (!registered.has(token)) {
        registered.add(token)
        registerSecretValue(token)
      }
      return { source: 'ghLogin', bearer: token, fetch: deps.fetch, expiresAt: undefined }
    },
    rejected() {
      // gh's login is gh's: the user runs `gh auth login` again.
      return Promise.resolve()
    },
    signOut() {
      return Promise.resolve()
    },
  }
}
