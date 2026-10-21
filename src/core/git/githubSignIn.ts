// One window's GitHub sign-in over D104's token sources (M123, PLAN.md
// D104 §2): the credential for each GitHub call, what the panel shows of it
// (a pending device-flow code, the source in use and the account's login),
// Cancel, and Sign out. Both conversation adapters (VS Code's Git
// extension route and the native route) and every surface's panel read
// the same object, so the sign-in card is the same everywhere.
//
// - A credential is resolved in D104's order: the first source that
//   already has a live one wins, silently; only when none has one, and the
//   call may ask, is one source asked (the user's pick, or the first).
// - A device-flow code reaches the panel only through `present`, which the
//   device-flow source is built with; nothing else can put a code on screen.
// - The account line names the source and the login, never the token. The
//   login comes from the source when it knows it (VS Code's session), else
//   from GitHub's `GET /user` (captured, src/core/git/github.ts), read once
//   per credential.
// - Cancel aborts every sign-in this window is waiting on. Sign out asks
//   every source to forget what it holds; only the device-flow source holds
//   anything of ours.
//
// Pure: the sources, the clock and the login read are injected.

import { GITHUB_AUTHORIZED_APP_URL, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { CoreLogger } from '../logging'
import { signInFailureText, type DeviceCodePrompt } from './deviceFlow'
import {
  isCredentialLive,
  orderedSources,
  resolveGitHubCredential,
  type GitHubCredential,
  type GitHubTokenSource,
  type GitHubTokenSourceKind,
} from './tokenSource'

/** What the panel shows of the sign-in; never a token. */
export interface GitHubSignInView {
  /** A device-flow code waiting for the user, with GitHub's address and its expiry. */
  readonly code?: DeviceCodePrompt
  /** The source the last GitHub call used, and the account's login when known. */
  readonly account?: { readonly source: GitHubTokenSourceKind; readonly login?: string }
}

export interface GitHubSignInDeps {
  /** D104's sources for this window, given the presenter the device flow shows its code through. */
  readonly sources: (present: (prompt: DeviceCodePrompt) => Promise<void>) => GitHubTokenSource[]
  readonly now: () => number
  /** The account's login for a credential (`GET /user`); undefined when it cannot be read. */
  readonly login: (credential: GitHubCredential, signal: AbortSignal) => Promise<string | undefined>
  readonly log: CoreLogger
}

/**
A source whose silent read fails (an unreadable secret store, say) counts
as having nothing, so it never keeps a later source's credential from
the call; an asked source's failure is the user's to see.
*/
function tolerant(source: GitHubTokenSource, log: CoreLogger): GitHubTokenSource {
  return {
    kind: source.kind,
    async credential(mode, signal) {
      if (mode === 'ask') {
        return await source.credential(mode, signal)
      }
      try {
        return await source.credential(mode, signal)
      } catch (error: unknown) {
        signal.throwIfAborted()
        log.warn(
          `The GitHub ${source.kind} sign-in could not be read: ${error instanceof Error ? error.name : 'unknown'}`,
        )
        return
      }
    },
    rejected: (credential) => source.rejected(credential),
    signOut: () => source.signOut(),
  }
}

export class GitHubSignIn {
  private readonly sources: readonly GitHubTokenSource[]
  private code: DeviceCodePrompt | undefined
  private account: { source: GitHubTokenSourceKind; login?: string; bearer: string } | undefined
  private readonly asking = new Set<AbortController>()
  /** The last credential each source issued, so a 401 for its token reaches that source. */
  private readonly issued = new Map<GitHubTokenSourceKind, GitHubCredential>()
  private readonly listeners = new Set<() => void>()

  public constructor(private readonly deps: GitHubSignInDeps) {
    this.sources = orderedSources(
      deps
        .sources((prompt) => {
          this.code = prompt
          this.changed()
          return Promise.resolve()
        })
        .map((source) => tolerant(source, deps.log)),
    )
  }

  private changed(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** The source and login the panel names; the login is read once per credential. */
  private async noteAccount(credential: GitHubCredential, signal: AbortSignal): Promise<void> {
    const known = this.account
    if (known?.source === credential.source && known.bearer === credential.bearer) {
      return
    }
    let login = credential.login
    if (login === undefined) {
      try {
        login = await this.deps.login(credential, signal)
      } catch {
        // Cancel still stops the call; any other failure only leaves the
        // account line naming the source alone, and the call goes on.
        signal.throwIfAborted()
        this.deps.log.info('The GitHub account’s login could not be read')
        login = undefined
      }
    }
    if (!isCredentialLive(credential, this.deps.now())) {
      return
    }
    this.account = {
      source: credential.source,
      bearer: credential.bearer,
      ...(login !== undefined && { login }),
    }
    this.changed()
  }

  /** The source kinds this window has, in D104's order. */
  public kinds(): readonly GitHubTokenSourceKind[] {
    return this.sources.map((source) => source.kind)
  }

  public view(): GitHubSignInView {
    const account =
      this.account === undefined
        ? undefined
        : {
            source: this.account.source,
            ...(this.account.login !== undefined && { login: this.account.login }),
          }
    return {
      ...(this.code !== undefined && { code: this.code }),
      ...(account !== undefined && { account }),
    }
  }

  /** Called whenever `view()` may have changed; returns the unsubscribe. */
  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
  The credential for one GitHub call. `askWith` is the source the user
  chose to sign in with (the first in order otherwise); a kind this
  window does not have asks nobody.
  */
  public async credential(
    mode: 'ask' | 'silent',
    signal: AbortSignal,
    askWith?: GitHubTokenSourceKind,
  ): Promise<GitHubCredential | undefined> {
    if (askWith !== undefined && !this.kinds().includes(askWith)) {
      return undefined
    }
    const own = new AbortController()
    this.asking.add(own)
    const combined = AbortSignal.any([signal, own.signal])
    try {
      const credential = await resolveGitHubCredential(this.sources, {
        mode,
        signal: combined,
        now: this.deps.now,
        ...(askWith !== undefined && { askWith }),
      })
      if (credential !== undefined) {
        this.issued.set(credential.source, credential)
        await this.noteAccount(credential, combined)
        // Cancel during the login read still stops this call.
        combined.throwIfAborted()
      }
      return credential
    } finally {
      this.asking.delete(own)
      if (this.asking.size === 0 && this.code !== undefined) {
        this.code = undefined
        this.changed()
      }
    }
  }

  /** GitHub answered 401 to `credential`: its source drops it, so the user signs in again. */
  public async rejected(credential: GitHubCredential): Promise<void> {
    await this.sources.find((source) => source.kind === credential.source)?.rejected(credential)
    if (this.account?.bearer !== credential.bearer) {
      return
    }
    this.account = undefined
    this.changed()
  }

  /** GitHub answered 401 to a call with `bearer`: the source that issued it drops it. */
  public async rejectedBearer(bearer: string): Promise<void> {
    let credential: GitHubCredential | undefined
    for (const issued of this.issued.values()) {
      if (issued.bearer === bearer) {
        credential = issued
        break
      }
    }
    if (credential === undefined) {
      return
    }
    this.issued.delete(credential.source)
    await this.rejected(credential)
  }

  /** Stops every sign-in this window is waiting on (the card's Cancel). */
  public cancel(): void {
    for (const controller of this.asking) {
      controller.abort()
    }
  }

  /**
  Sign out: every source forgets what it holds (the device-flow source
  deletes its token and opens the app's page on GitHub, where the grant
  is revoked). The editor's own sign-in and `gh` keep theirs.
  */
  public async signOut(): Promise<void> {
    this.cancel()
    for (const source of this.sources) {
      await source.signOut()
    }
    this.issued.clear()
    this.account = undefined
    this.changed()
  }

  /**
  The account line in the user's words (`GitHub: <login>, through <the
  source>`), or undefined before any GitHub call had a credential.
  */
  public accountText(): string | undefined {
    const account = this.view().account
    if (account === undefined) {
      return undefined
    }
    const source = UI_TEXT.gitHubSources[account.source]
    return account.login === undefined
      ? fill(UI_TEXT.gitHubAccountNoLogin, { source })
      : fill(UI_TEXT.gitHubAccount, { login: account.login, source })
  }

  /**
  A sign-in failure in the user's fixed words, or undefined for anything
  else. A method, so the failure is recognised by the module copy that
  threw it, whichever bundle asks.
  */
  public failureText(error: unknown): string | undefined {
    return signInFailureText(error)
  }

  /**
  A credential for one GitHub call, saying in fixed words why a sign-in
  did not finish (`isSaid`), so the caller adds nothing on top. Cancel
  and a closed conversation say only "cancelled", and only while the
  caller still waits.
  */
  public async credentialOrSaid(
    request: {
      readonly mode: 'ask' | 'silent'
      readonly signal: AbortSignal
      readonly askWith?: GitHubTokenSourceKind | undefined
    },
    notice: (text: string) => void,
  ): Promise<{ readonly credential: GitHubCredential | undefined; readonly isSaid: boolean }> {
    try {
      return {
        credential: await this.credential(request.mode, request.signal, request.askWith),
        isSaid: false,
      }
    } catch (error: unknown) {
      if (!request.signal.aborted) {
        notice(signInFailureText(error) ?? UI_TEXT.githubSignIn.cancelled)
      }
      return { credential: undefined, isSaid: true }
    }
  }

  /** Sign out, then say so: the token is gone, and GitHub's page for the app is where the grant is revoked. */
  public async signOutAndSay(
    notice: (level: 'info' | 'warning', text: string) => void,
  ): Promise<void> {
    try {
      await this.signOut()
    } catch {
      notice('warning', UI_TEXT.gitHubSignOutFailed)
      return
    }
    notice('info', fill(UI_TEXT.githubSignIn.signedOut, { url: GITHUB_AUTHORIZED_APP_URL }))
  }
}

/** The sign-in as the panel's Git state carries it: absent when there is nothing to show. */
export function githubStateOf(signIn: GitHubSignIn | undefined): {
  readonly github?: GitHubSignInView
} {
  const view = signIn?.view()
  return view === undefined || (view.code === undefined && view.account === undefined)
    ? {}
    : { github: view }
}
