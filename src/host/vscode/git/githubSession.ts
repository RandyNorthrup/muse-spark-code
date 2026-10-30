// GitHub sign-in in a VS Code-family window (M71, PLAN.md D49; M123, D104
// §2): D104's three sources, first available wins, and the one window
// sign-in every conversation's Git adapter and the panel card read.
//
// - (a) VS Code's own GitHub sign-in (the built-in `github-authentication`
//   extension): the token is read for each call in this extension host and
//   handed to the GitHub client, never stored, logged or given to a
//   process. `ask` shows VS Code's own consent and sign-in; `silent` only
//   reads a session there is. Absent where the host does not ship that
//   extension (Arduino IDE 2, some forks).
// - (b) Muse Spark's own sign-in with GitHub's device flow
//   (src/runtime/github/deviceFlowSource.ts): the code shows in the panel
//   card, the token pair is kept in VS Code's secret storage (the OS
//   keychain behind it), never in a setting, a file or a log.
// - (c) The user's `gh` login, only while `museSpark.github.useGhLogin` is
//   on in user or machine settings (src/runtime/github/ghLoginSource.ts),
//   read through the governed launcher for one call.

import * as vscode from 'vscode'
import {
  SETTINGS_SECTION,
  GITHUB_AUTH_EXTENSION_ID,
  GITHUB_AUTH_PROVIDER,
  GITHUB_AUTH_SCOPES,
} from '../../../shared/constants'
import { GitHubSignIn } from '../../../core/git/githubSignIn'
import type { GitHubTokenSource, SettingInspection } from '../../../core/git/tokenSource'
import { githubAccountLogin, runtimeGitHubSources } from '../../../runtime/github/githubSources'
import type { SecretStore } from '../../auth/credentialStore'
import type { Logger } from '../../logger'

/** Source (a): VS Code's GitHub session, read per call. */
function vscodeSessionSource(log: Logger, fetch: typeof globalThis.fetch): GitHubTokenSource {
  return {
    kind: 'editorLease',
    async credential(mode) {
      try {
        const session = await vscode.authentication.getSession(
          GITHUB_AUTH_PROVIDER,
          [...GITHUB_AUTH_SCOPES],
          mode === 'ask' ? { createIfNone: true } : { silent: true },
        )
        return session === undefined
          ? undefined
          : {
              source: 'editorLease',
              bearer: session.accessToken,
              fetch,
              expiresAt: undefined,
              login: session.account.label,
            }
      } catch {
        // Declined or cancelled: VS Code rejects `createIfNone` then.
        // The provider's error name can itself identify an account.
        log.info('GitHub sign-in not given')
        return
      }
    },
    // VS Code keeps its own session and asks for it again itself.
    rejected: () => Promise.resolve(),
    // Signing out of VS Code's account is VS Code's (its Accounts menu).
    signOut: () => Promise.resolve(),
  }
}

export interface WindowGitHubSignInDeps {
  /** VS Code's secret storage: where source (b) keeps its token pair. */
  readonly secrets: SecretStore
  /** VS Code's proxy-aware fetch (M56, D43). */
  readonly fetch: typeof globalThis.fetch
  readonly userAgent: string
  readonly log: Logger
}

/** This window's GitHub sign-in over D104's sources. */
export function windowGitHubSignIn(deps: WindowGitHubSignInDeps): GitHubSignIn {
  const hasEditorSignIn = vscode.extensions.getExtension(GITHUB_AUTH_EXTENSION_ID) !== undefined
  return new GitHubSignIn({
    sources: (present) => [
      ...(hasEditorSignIn ? [vscodeSessionSource(deps.log, deps.fetch)] : []),
      ...runtimeGitHubSources(
        {
          store: deps.secrets,
          fetch: deps.fetch,
          // Only the app's page on GitHub, where the grant is revoked.
          openExternal: async (url) => {
            await vscode.env.openExternal(vscode.Uri.parse(url))
          },
          setting: (): SettingInspection | undefined =>
            vscode.workspace
              .getConfiguration(SETTINGS_SECTION)
              .inspect<boolean>('github.useGhLogin'),
        },
        present,
      ),
    ],
    now: Date.now,
    login: githubAccountLogin(deps),
    log: deps.log,
  })
}
