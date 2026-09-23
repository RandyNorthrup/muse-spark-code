// "Sign in with your Meta account": run `muse login` where the user can see
// it (an integrated terminal), then watch for the CLI's credential file to
// be written. Pure orchestration over injected dependencies.
//
// Success is a credential file written after the login started (PLAN.md
// D25), never just one that exists: a stale file from an expired sign-in
// would otherwise count as signed in the moment the terminal opened.

export interface BrowserSignInDeps {
  /** Starts `muse login` in a visible terminal. */
  readonly runLogin: () => void
  /** The credential file's modification time (epoch ms); undefined when absent. */
  readonly credentialFileModifiedAt: () => number | undefined
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly pollIntervalMs: number
  readonly timeoutMs: number
}

export type BrowserSignInOutcome = 'signedIn' | 'timedOut'

export async function signInWithBrowser(deps: BrowserSignInDeps): Promise<BrowserSignInOutcome> {
  const before = deps.credentialFileModifiedAt()
  deps.runLogin()
  const deadline = deps.now() + deps.timeoutMs
  while (deps.now() < deadline) {
    const current = deps.credentialFileModifiedAt()
    if (current !== undefined && current !== before) {
      return 'signedIn'
    }
    await deps.sleep(deps.pollIntervalMs)
  }
  return 'timedOut'
}
