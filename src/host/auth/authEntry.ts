// The sign-in gate's bundle (dist/auth.js, PLAN.md D6): AuthService and the
// three-valued credential read load the first time a credential, money or
// consent path needs them; activation keeps only this entry's dynamic
// import. The bundle keeps its own installed-language state, so the factory
// installs the caller's table from its deps before anything reads it.

import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { AuthService, type AuthServiceDeps } from './authService'

export { getApiKey, hasStoredKey, readModelApiCredential } from './credentialRead'

/** AuthService in the calling deps' display language. */
export function createAuthService(
  deps: AuthServiceDeps & { readonly l10n?: { readonly table: UiText; readonly locale: string } },
): AuthService {
  const { l10n, ...rest } = deps
  if (l10n !== undefined) setUiText(l10n.table, l10n.locale)
  return new AuthService(rest)
}
