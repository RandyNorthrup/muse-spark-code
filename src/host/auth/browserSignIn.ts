// "Sign in with your Meta account": run `muse login` where the user can see
// it (an integrated terminal), then watch for the CLI's credential file to
// appear. Pure orchestration over injected dependencies.

export interface BrowserSignInDeps {
  /** Starts `muse login` in a visible terminal. */
  readonly runLogin: () => void
  readonly credentialFileExists: () => Promise<boolean>
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly pollIntervalMs: number
  readonly timeoutMs: number
}

export type BrowserSignInOutcome = 'signedIn' | 'timedOut'

export async function signInWithBrowser(deps: BrowserSignInDeps): Promise<BrowserSignInOutcome> {
  deps.runLogin()
  const deadline = deps.now() + deps.timeoutMs
  while (deps.now() < deadline) {
    if (await deps.credentialFileExists()) {
      return 'signedIn'
    }
    await deps.sleep(deps.pollIntervalMs)
  }
  return 'timedOut'
}
