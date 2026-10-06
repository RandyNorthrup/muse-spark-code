// VS Code's GitHub sign-in (the built-in `github-authentication`
// extension), the only way M71 reaches GitHub (PLAN.md D49): the token is
// read for each call and handed to the GitHub client, never stored,
// logged or given to a process. `ask` shows VS Code's own consent and
// sign-in when there is no session; `silent` only reads one there is.

import * as vscode from 'vscode'
import { GITHUB_AUTH_PROVIDER, GITHUB_AUTH_SCOPES } from '../../shared/constants'
import type { Logger } from '../logger'

export function githubTokenReader(
  log: Logger,
): (mode: 'ask' | 'silent') => Promise<string | undefined> {
  return async (mode) => {
    try {
      const session = await vscode.authentication.getSession(
        GITHUB_AUTH_PROVIDER,
        [...GITHUB_AUTH_SCOPES],
        mode === 'ask' ? { createIfNone: true } : { silent: true },
      )
      return session?.accessToken
    } catch {
      // Declined or cancelled: VS Code rejects `createIfNone` then.
      // The provider's error name can itself identify an account.
      log.info('GitHub sign-in not given')
      return
    }
  }
}
