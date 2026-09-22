// Pure decision: is there any credential the Muse Code CLI could use?
//
// The CLI's precedence is META_API_KEY → stored API key → browser session
// (dev.meta.ai/docs/muse-code/auth). The extension mirrors it: a key in secret
// storage (injected as META_API_KEY), a key already in the environment, or the
// CLI's own credential file. This is a *presence* check only; the authoritative
// answer is the host's `authRequired` turn error, which the controller maps
// back to `signedOut`.

export type AuthStatus = 'signedIn' | 'signedOut'

export interface AuthEvidence {
  readonly hasStoredKey: boolean
  readonly hasEnvironmentKey: boolean
  readonly credentialFileExists: boolean
}

export function deriveAuthStatus(evidence: AuthEvidence): AuthStatus {
  return evidence.hasStoredKey || evidence.hasEnvironmentKey || evidence.credentialFileExists
    ? 'signedIn'
    : 'signedOut'
}
