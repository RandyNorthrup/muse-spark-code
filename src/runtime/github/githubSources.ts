// D104's two sources every editor can offer, assembled once (M123, PLAN.md
// D104 §2): Muse Spark's own device-flow sign-in and the user's `gh` login
// (opt in). VS Code's window adds its own editor session in front; the runtime
// panel offers these two. The account's login is read once per credential from
// GitHub's `GET /user`.
//
// Nothing here stores or logs a token: the device flow keeps its pair in the
// credential store it is given, `gh`'s token is held for the one call.

import { existsSync, realpathSync } from 'node:fs'
import { setTimeout as abortableSleep } from 'node:timers/promises'
import type { SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import { NO_WORKSPACE } from '../../core/executables'
import { resolveExecutable } from '../../core/execGuard'
import type { DeviceCodePrompt } from '../../core/git/deviceFlow'
import { GitHubClient } from '../../core/git/github'
import type { GitHubSignInDeps } from '../../core/git/githubSignIn'
import type { GitHubTokenSource } from '../../core/git/tokenSource'
import { execResourceFile } from '../../core/resources/launcher'
import { deviceFlowSource } from './deviceFlowSource'
import { ghLoginSource, type GhInvocation, type GhLoginSourceDeps } from './ghLoginSource'

/** `gh` on the absolute entries of PATH, as `git` is resolved; undefined when it is not there. */
function ghOnPath(): GhInvocation | undefined {
  const command = resolveExecutable('gh', {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
    scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
  })
  return command === undefined ? undefined : { command, args: [] }
}

export interface RuntimeGitHubSourcesDeps {
  /** Where the device flow keeps its token pair. */
  readonly store: SecretStore
  /** The network the credentials' calls go out on. */
  readonly fetch: typeof globalThis.fetch
  /** Shows GitHub's address after Sign out, where the grant is revoked. */
  readonly openExternal: (url: string) => Promise<void>
  /** `museSpark.github.useGhLogin` by scope, read at each call. */
  readonly setting: GhLoginSourceDeps['setting']
}

/** The device-flow sign-in and the `gh` login, in D104's order (the sign-in orders them itself). */
export function runtimeGitHubSources(
  deps: RuntimeGitHubSourcesDeps,
  present: (prompt: DeviceCodePrompt) => Promise<void>,
): GitHubTokenSource[] {
  return [
    deviceFlowSource({
      store: deps.store,
      flow: {
        fetch: deps.fetch,
        now: Date.now,
        sleep: (ms, signal) => abortableSleep(ms, undefined, { signal }),
      },
      present,
      openExternal: deps.openExternal,
      fetch: deps.fetch,
    }),
    ghLoginSource({
      setting: deps.setting,
      gh: ghOnPath,
      run: (file, args, options) => execResourceFile('probe', file, args, options),
      environment: () => process.env,
      fetch: deps.fetch,
    }),
  ]
}

/** The account's login for a credential, read from GitHub with the credential's own network. */
export function githubAccountLogin(deps: {
  readonly userAgent: string
  readonly log: Logger
}): GitHubSignInDeps['login'] {
  return async (credential) => {
    const client = new GitHubClient({
      fetch: credential.fetch,
      userAgent: deps.userAgent,
      log: deps.log,
    })
    const user = await client.currentUser(credential.bearer)
    return user.login
  }
}
