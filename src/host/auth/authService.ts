// Credential state for both backends, shared by every surface (PLAN.md D1,
// M7). The backend selection decides which credential counts: the Muse
// Code CLI's own sign-in (subscription) for the CLI backend, the pasted
// Model API key for the Model API backend; they are never mixed. `status`
// is the estimate from the credential facts (the CLI's from its credential
// file's structure, confirmed by the CLI when that is ambiguous, PLAN.md
// D26); a backend's own `authRequired` turn error overrides it through
// `markAuthRequired`. All VS Code interactions (terminals, input boxes) are
// injected so the flow is unit-tested end to end.

import { isCliSignInConsulted, selectBackend } from '../../core/backendSelection'
import type { BackendKind } from '../../core/agent/agentBackend'
import type { CliSignIn } from '../../core/backends/musecode/credentialFile'
import { wireWordForLog } from '../../core/logging'
import { unlessAborted } from '../../core/timeouts'
import {
  type BackendMode,
  MUSE_INSTALL_POLL_INTERVAL_MS,
  MUSE_INSTALL_TIMEOUT_MS,
  MUSE_LOGOUT_ARGS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { AuthStatus, HostToWebviewMessage, SignInMethod } from '../../shared/protocol'
import type { Logger } from '../logger'
import { isCliSignedIn } from './cliAccount'
import type { CapturedSignInEnding, DeviceSignInEnded, DeviceSignInOutcome } from './deviceSignIn'
import type { CredentialStore } from './credentialStore'

export interface AuthBackendFacts {
  /** The CLI path to run for `login` / `logout`, or the reason it is absent. */
  readonly resolveCli: () =>
    | { readonly ok: true; readonly cliPath: string }
    | { readonly ok: false; readonly reason: string }
  /**
   * The CLI's own sign-in: its credential file's structure, and the CLI's
   * `account/read` when that cannot say. With `isUserAction` macOS may ask
   * too (its host reads the Keychain); otherwise it does not.
   */
  readonly cliSignIn: (isUserAction: boolean) => Promise<CliSignIn>
  /**
   * Leaves an unanswered probe behind (Cancel): the next question asks
   * afresh, and a remembered answer stands.
   */
  readonly abandonCliProbe: () => void
  /**
   * Drops everything the CLI said, the remembered answer too (a sign-out, a
   * new sign-in, Check again): the next question asks afresh.
   */
  readonly forgetCliAnswers: () => void
  /** Where the CLI keeps its sign-in, named when the file stops it starting. */
  readonly credentialFilePath: () => string
  /** The credential file's modification time; undefined when there is none. */
  readonly credentialFileModifiedAt: () => number | undefined
  readonly hasEnvironmentKey: () => boolean
  /** `museSpark.backend`. */
  readonly getBackendMode: () => BackendMode
  /**
   * Stop the running hosts so the next turn spawns the right one afresh;
   * with `isConversationEnding` (sign-out) the conversations are not resumed.
   */
  readonly restartBackend: (isConversationEnding: boolean) => Promise<void>
  /**
   * The CLI's own sign-out, MSP `account/logout` on a short-lived host: true
   * only when `account/read` then gives the captured signed-out answer. A
   * host that could not start or refused, `envKey` (META_API_KEY hides the
   * stored lane), a stored credential or a state never captured is false.
   * Never rejects.
   */
  readonly logOutCli: () => Promise<boolean>
}

export interface AuthServiceDeps {
  readonly backend: AuthBackendFacts
  readonly credentials: CredentialStore
  /** Extension-private, credential-free state retained across activation. */
  readonly logoutHold: {
    readonly get: () => boolean
    readonly set: (isHeld: boolean) => PromiseLike<void>
  }
  readonly runInTerminal: (cliPath: string, args: readonly string[]) => void
  readonly installCommand: string
  readonly runInstallerInTerminal: () => void
  readonly runDeviceSignIn: (
    signal: AbortSignal,
    onCode: (url: string, code: string) => void,
  ) => Promise<DeviceSignInOutcome>
  /** Returns the pasted key, or undefined when the user dismissed the box. */
  readonly promptForApiKey: () => Promise<string | undefined>
  readonly broadcast: (message: HostToWebviewMessage) => void
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly log: Logger
}

export interface AuthSnapshot {
  readonly status: AuthStatus
  readonly detail: string | undefined
  /** The backend the window uses (known once the facts are in). */
  readonly backend?: BackendKind | undefined
  /** The sign-in paths the gate offers. */
  readonly methods?: readonly SignInMethod[] | undefined
  readonly verificationUrl?: string | undefined
  readonly userCode?: string | undefined
  readonly hasCli?: boolean | undefined
  readonly hasCliSession?: boolean | undefined
  readonly installState?: 'running' | 'failed' | undefined
}

/**
 * What a conversation needs from the service: the controller's dependency
 * type, so a test hands it a plain object with exactly these members.
 */
export type AuthPort = Pick<
  AuthService,
  | 'current'
  | 'backend'
  | 'toMessage'
  | 'signIn'
  | 'installMuseCode'
  | 'cancelSignIn'
  | 'signOut'
  | 'refresh'
  | 'checkAgain'
  | 'markAuthRequired'
  | 'markBackendError'
>

/**
 * The sign-in story for the log (M39): the state, the backend it chose and,
 * for an error, why (`loggedDetail`, which may stand in for a detail that
 * names a path). Written when the state or the backend changes.
 */
function signInLine(snapshot: AuthSnapshot, loggedDetail: string | undefined): string {
  const backend = snapshot.backend === undefined ? '' : ` on the ${snapshot.backend} backend`
  const why = loggedDetail !== undefined && snapshot.status === 'error' ? `: ${loggedDetail}` : ''
  return `Sign-in state: ${snapshot.status}${backend}${why}`
}

// What the log says in place of the unsupported-file message, which names
// the credential file's full path under the user's profile (the review of
// PR #49); the panel still shows the path.
const UNSUPPORTED_FILE_LOGGED =
  'the Muse Code credential file is in a format Muse Code cannot start with on this system'

/** The browser sign-in's pre-check found a file the sign-in host could not start with. */
const UNSUPPORTED_FILE = Symbol('unsupported credential file')

/**
 * Why a device sign-in the host ended did not sign in (read when shown, D33):
 * each captured ending in its own words, any other as Muse Code named it
 * (AGENTS.md rule 13).
 */
function endedSignInText(
  ending: Exclude<CapturedSignInEnding, 'cancelled'> | DeviceSignInEnded,
): string {
  switch (ending) {
    case 'expired': {
      return UI_TEXT.signInExpired
    }
    case 'denied': {
      return UI_TEXT.signInDenied
    }
    case 'failed': {
      return UI_TEXT.signInSaveFailed
    }
    default: {
      return fill(UI_TEXT.signInEnded, { outcome: ending.endedAs })
    }
  }
}

/** One browser sign-in, as its steps see it. */
interface CliSignInFlow {
  /** What the panel showed when the flow began. */
  readonly initial: AuthSnapshot
  readonly epoch: number
  readonly wasLogoutHeld: boolean
  /** Aborted by Cancel and by a sign-out. */
  readonly abort: AbortController
  /** Aborted when a sign-out starts; Cancel leaves it. */
  readonly signOut: AbortSignal
  /** The credential file's modification time when the flow began. */
  readonly fileBefore: number | undefined
  /** The device code was shown: the browser may have approved it. */
  isCodeShown: boolean
}

export class AuthService {
  private snapshot: AuthSnapshot = { status: 'checking', detail: undefined }
  /** The browser sign-in in flight: a second click joins it (PLAN.md D25). */
  private deviceSignIn: Promise<AuthSnapshot> | undefined
  private installPromise: Promise<AuthSnapshot> | undefined
  /** Every panel joins one sign-out; the hold cannot be released by an earlier caller. */
  private signOutPromise: Promise<AuthSnapshot> | undefined
  private deviceAbort: AbortController | undefined
  /**
   * A sign-out invalidates key prompts already open in any surface, and
   * refreshes begun before it ended (it moves on as it starts and ends).
   */
  private signOutEpoch = 0
  /** Aborted as a sign-out starts: a finishing sign-in stops waiting on the CLI. */
  private signOutStarts = new AbortController()
  /** Invalidates selectors across a same-kind sign-out/sign-in or key replacement. */
  private admissionGenerationValue = 0
  /** Sign-out waits for accepted key writes and backend restarts before ending sessions. */
  private readonly keyActivations = new Set<Promise<AuthSnapshot>>()
  /** Every Check again pressed while one runs joins it: one question to the CLI. */
  private checkingAgain: Promise<AuthSnapshot> | undefined
  private isLogoutHeld: boolean
  private isSigningOut = false
  private isLogoutPersistenceFailed = false
  /** The window is closing: no browser sign-in starts any more. */
  private isStopped = false
  /**
   * Every publication's place in time (the review of PR #49): a refresh
   * takes a ticket as it starts and publishes only if nothing that started
   * or was published after it has published first.
   */
  private tickets = 0
  private publishedTicket = 0
  /** The browser sign-in's code is on screen: a refresh leaves the panel to that flow. */
  private isDeviceFlowWaiting = false
  /**
   * The backend conversations were last admitted on: the backend of the
   * last signed-in state published, until a restart ends its conversations.
   * The panel may show another state meanwhile (a sign-in's code) while a
   * conversation still runs there.
   */
  private liveBackend: BackendKind | undefined
  /** Moves each time `liveBackend` is recorded: a restart clears only what it ended. */
  private liveVersion = 0
  /** Counts logout-hold writes: only the latest one's outcome is kept. */
  private holdWrites = 0

  public constructor(private readonly deps: AuthServiceDeps) {
    this.isLogoutHeld = deps.logoutHold.get()
  }

  private async setLogoutHold(isHeld: boolean): Promise<boolean> {
    this.isLogoutHeld = isHeld
    // Only the latest write says whether the hold is saved: an older one
    // that settles late speaks for a value that no longer holds (the review
    // of PR #49).
    this.holdWrites += 1
    const write = this.holdWrites
    try {
      await this.deps.logoutHold.set(isHeld)
      if (write === this.holdWrites) {
        this.isLogoutPersistenceFailed = false
      }
      return true
    } catch {
      if (write === this.holdWrites) {
        this.isLogoutPersistenceFailed = true
      }
      this.deps.log.warn('Muse Code sign-out state could not be saved')
      return false
    }
  }

  private logoutDetail(): string {
    return this.isLogoutPersistenceFailed ? UI_TEXT.signOutHoldFailed : UI_TEXT.signOutPending
  }

  /**
   * Whether a sign-out runs now: read afresh after an await, which the
   * compiler's narrowing of `isSigningOut` does not see.
   */
  private isSignOutRunning(): boolean {
    return this.isSigningOut
  }

  /**
   * Stops the running hosts; with `isConversationEnding` their conversations
   * end too, so none runs on any backend any more. Rejects as the restart
   * does.
   */
  private async restartHosts(isConversationEnding: boolean): Promise<void> {
    // Cleared after the restart, so a failed one leaves the record of the
    // conversations still running; and only if no signed-in state was
    // published meanwhile, whose conversations did not end (the review of
    // PR #49).
    const live = this.liveVersion
    await this.deps.backend.restartBackend(isConversationEnding)
    if (isConversationEnding && live === this.liveVersion) {
      this.liveBackend = undefined
    }
  }

  private async stopBackendForSignOut(): Promise<boolean> {
    try {
      await this.restartHosts(true)
      return true
    } catch {
      this.deps.log.warn('Muse Code backend could not stop during sign-out')
      return false
    }
  }

  /** Whether publishing `next` moves signed-in conversations to another backend. */
  private isBackendSwitch(next: AuthSnapshot): boolean {
    return (
      next.status === 'signedIn' &&
      this.liveBackend !== undefined &&
      next.backend !== this.liveBackend
    )
  }

  /**
   * The one way a state is published that may sign in on another backend
   * than conversations run on (the review of PR #49): new hosts are gated
   * and that backend's conversations end first, as a device sign-in's
   * success does, then `next` is published if it still may be (`isCurrent`,
   * and no newer publication meanwhile).
   */
  private async publishSelection(
    next: AuthSnapshot,
    ticket: number = this.nextTicket(),
    isCurrent: () => boolean = () => true,
  ): Promise<AuthSnapshot> {
    if (!this.isBackendSwitch(next)) {
      return this.set(next, ticket)
    }
    this.deps.log.info(
      `Conversations move from the ${String(this.liveBackend)} backend to the ${String(next.backend)} backend: ending them first`,
    )
    this.admissionGenerationValue += 1
    this.set(
      {
        ...this.snapshot,
        status: 'checking',
        detail: undefined,
        verificationUrl: undefined,
        userCode: undefined,
      },
      ticket,
    )
    try {
      await this.restartHosts(true)
    } catch {
      this.deps.log.warn('The running backend could not stop before switching backends')
      // The failure is published under the same guards as the success: a
      // newer state, or a sign-out, published meanwhile stands (Codex on
      // 86d63652).
      return ticket < this.publishedTicket || !isCurrent()
        ? this.snapshot
        : this.set(
            {
              ...this.snapshot,
              status: 'error',
              detail: UI_TEXT.signOutStopFailed,
              installState:
                this.snapshot.installState === 'running' ? 'failed' : this.snapshot.installState,
            },
            ticket,
          )
    }
    return ticket < this.publishedTicket || !isCurrent() ? this.snapshot : this.set(next, ticket)
  }

  private nextTicket(): number {
    this.tickets += 1
    return this.tickets
  }

  /**
   * A refresh's answer, unless something newer was published while it was
   * asked, or a browser sign-in's code is on screen: its facts may be older
   * than what the panel shows (the review of PR #49).
   */
  private async publishRefresh(
    ticket: number,
    epoch: number,
    snapshot: AuthSnapshot,
  ): Promise<AuthSnapshot> {
    return ticket < this.publishedTicket || this.isDeviceFlowWaiting
      ? this.snapshot
      : await this.publishSelection(snapshot, ticket, () => epoch === this.signOutEpoch)
  }

  private set(snapshot: AuthSnapshot, ticket = this.nextTicket()): AuthSnapshot {
    const previous = this.snapshot
    this.snapshot = snapshot
    this.publishedTicket = ticket
    if (snapshot.status === 'signedIn') {
      this.liveBackend = snapshot.backend
      this.liveVersion += 1
    }
    if (previous.status !== snapshot.status || previous.backend !== snapshot.backend) {
      const isUnsupportedFile =
        snapshot.detail !== undefined && snapshot.detail === this.unsupportedFileText()
      this.deps.log.info(
        signInLine(snapshot, isUnsupportedFile ? UNSUPPORTED_FILE_LOGGED : snapshot.detail),
      )
    }
    this.deps.broadcast(this.toMessage())
    return this.snapshot
  }

  /**
   * The CLI's own credential as the gate counts it: `META_API_KEY` in its
   * environment, or its sign-in, including one only the CLI could confirm.
   * With the key set no file is looked at: `muse serve` then starts even
   * with a version-2 file it refuses otherwise, and uses the key (captured
   * 2026-09-27, docs/certification/sign-in-detection.md).
   */
  private async cliCredential(
    isUserAction: boolean,
  ): Promise<{ readonly hasCliSession: boolean; readonly isUnsupportedFile: boolean }> {
    if (this.deps.backend.hasEnvironmentKey()) {
      return { hasCliSession: true, isUnsupportedFile: false }
    }
    const signIn = await this.deps.backend.cliSignIn(isUserAction)
    return {
      hasCliSession: isCliSignedIn(signIn),
      isUnsupportedFile: signIn === 'unsupportedHere',
    }
  }

  private async hasCliCredential(isUserAction: boolean): Promise<boolean> {
    const { hasCliSession } = await this.cliCredential(isUserAction)
    return hasCliSession
  }

  /**
   * The backend selection from the current facts. With the backend forced
   * to the Model API the CLI is not asked at all (Codex on 328efb52).
   */
  private async choose(isUserAction: boolean) {
    const cli = this.deps.backend.resolveCli()
    const setting = this.deps.backend.getBackendMode()
    const { hasCliSession, isUnsupportedFile } = isCliSignInConsulted(setting)
      ? await this.cliCredential(isUserAction)
      : { hasCliSession: false, isUnsupportedFile: false }
    return {
      cli,
      hasCliSession,
      isUnsupportedFile,
      choice: selectBackend({
        setting,
        hasCli: cli.ok,
        hasCliSession,
        hasStoredKey: (await this.deps.credentials.getApiKey()) !== undefined,
      }),
    }
  }

  /** A macOS credential file on Windows or Linux: `muse serve` exits at startup. */
  private unsupportedFileText(): string {
    return fill(UI_TEXT.cliCredentialUnsupported, {
      path: this.deps.backend.credentialFilePath(),
    })
  }

  /** One device-code sign-in process, however often the button is pressed (D25). */
  private async joinDeviceSignIn(): Promise<AuthSnapshot> {
    if (this.deviceSignIn !== undefined) {
      return await this.deviceSignIn
    }
    // A click whose pre-flight questions outlived the window starts no host
    // after the backends stopped (the review of PR #49).
    if (this.isStopped) {
      return this.snapshot
    }
    this.deviceSignIn = this.signInWithCli()
    try {
      return await this.deviceSignIn
    } finally {
      this.deviceSignIn = undefined
    }
  }

  /**
   * The flow's pre-check and the device runner, while the flow owns the
   * panel: a refresh meanwhile does not publish over its code (the review of
   * PR #49).
   */
  private async awaitDeviceRunner(
    flow: CliSignInFlow,
  ): Promise<DeviceSignInOutcome | typeof UNSUPPORTED_FILE> {
    const { abort } = flow
    this.isDeviceFlowWaiting = true
    try {
      // The sign-in host could not start with that file either. A probe the
      // CLI never answers must not hold Cancel or sign-out (the review of
      // PR #49): the look ends with the flow's own signal.
      const credential = await unlessAborted(this.cliCredential(false), abort.signal)
      if (credential?.isUnsupportedFile === true) {
        return UNSUPPORTED_FILE
      }
      // A cancel or sign-out during that look ends the flow before it starts.
      return abort.signal.aborted
        ? 'cancelled'
        : await this.deps.runDeviceSignIn(abort.signal, (url, code) => {
            if (abort.signal.aborted) {
              return
            }
            flow.isCodeShown = true
            this.set({ ...this.snapshot, verificationUrl: url, userCode: code })
          })
    } finally {
      this.isDeviceFlowWaiting = false
    }
  }

  private async signInWithCli(): Promise<AuthSnapshot> {
    const flow: CliSignInFlow = {
      initial: this.snapshot,
      epoch: this.signOutEpoch,
      wasLogoutHeld: this.isLogoutHeld,
      abort: new AbortController(),
      signOut: this.signOutStarts.signal,
      fileBefore: this.deps.backend.credentialFileModifiedAt(),
      isCodeShown: false,
    }
    const { abort } = flow
    const cli = this.deps.backend.resolveCli()
    if (!cli.ok) {
      return await this.finishFailedCliSignIn(flow, 'noCli', cli.reason, 'warning')
    }
    // Cancel and sign-out reach this flow from here on, before any await.
    this.deviceAbort = abort
    this.set({ ...this.snapshot, status: 'signingIn', detail: UI_TEXT.signInWaiting })
    try {
      const outcome = await this.awaitDeviceRunner(flow)
      if (outcome === UNSUPPORTED_FILE) {
        return await this.finishFailedCliSignIn(
          flow,
          'error',
          this.unsupportedFileText(),
          'warning',
        )
      }
      if (outcome === 'cancelled') {
        return await this.finishCancelledCliSignIn(flow)
      }
      if (outcome === 'timedOut') {
        return await this.finishFailedCliSignIn(
          flow,
          'signedOut',
          UI_TEXT.signInTimedOut,
          'warning',
        )
      }
      if (outcome !== 'signedIn') {
        return await this.finishFailedCliSignIn(
          flow,
          'signedOut',
          endedSignInText(outcome),
          'warning',
        )
      }
      if (this.isSigningOut) {
        return this.snapshot
      }
      // What the CLI said before this sign-in no longer holds, even where
      // the file did not change (a Keychain sign-in; the review of PR #49).
      this.deps.backend.forgetCliAnswers()
      return await this.confirmCliSignIn(flow)
    } catch (error: unknown) {
      this.deps.log.warn(
        `In-panel sign-in failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      )
      return await this.finishFailedCliSignIn(flow, 'error', UI_TEXT.signInFailed, 'warning')
    } finally {
      this.deviceAbort = undefined
    }
  }

  /**
   * The device runner saw the sign-in land. Every question to the CLI here
   * yields to the flow's signal, so a sign-out (or Cancel) never waits on
   * one (the review of PR #49).
   */
  private async confirmCliSignIn(flow: CliSignInFlow): Promise<AuthSnapshot> {
    const { abort } = flow
    // After a sign-out, only the CLI's own confirmation of the new sign-in
    // (the device runner's, then the file or `account/read` here) lifts the
    // hold, and never while a key would bill instead.
    if (flow.wasLogoutHeld) {
      const hasBillingKey =
        this.deps.backend.hasEnvironmentKey() ||
        (await this.deps.credentials.getApiKey()) !== undefined
      const confirmed = hasBillingKey
        ? undefined
        : await unlessAborted(this.deps.backend.cliSignIn(true), abort.signal)
      if (abort.signal.aborted) {
        return await this.finishCancelledCliSignIn(flow)
      }
      if (confirmed !== 'signedIn') {
        return await this.refreshUnlessCancelled(flow)
      }
    }
    this.admissionGenerationValue += 1
    // A restart that fails after a newer state was published (a refresh
    // meanwhile) leaves that state standing, rather than the flow's failure
    // (Codex on 86d63652).
    const published = this.publishedTicket
    try {
      await this.restartHosts(flow.initial.status === 'signedIn')
    } catch (error: unknown) {
      if (this.publishedTicket !== published) {
        this.deps.log.warn('The backend did not restart after sign-in; a newer state stands')
        return this.snapshot
      }
      throw error
    }
    if (abort.signal.aborted) {
      return await this.finishCancelledCliSignIn(flow)
    }
    if (flow.wasLogoutHeld) {
      if (this.signOutEpoch !== flow.epoch || this.deps.backend.hasEnvironmentKey()) {
        return await this.refreshUnlessCancelled(flow)
      }
      const isHoldSaved = await this.setLogoutHold(false)
      if (!isHoldSaved) {
        return this.set({ ...this.snapshot, status: 'error', detail: UI_TEXT.signOutHoldFailed })
      }
    }
    return await this.refreshUnlessCancelled(flow)
  }

  /** A user-action refresh that ends with the flow's signal. */
  private async refreshUnlessCancelled(flow: CliSignInFlow): Promise<AuthSnapshot> {
    const refreshed = await unlessAborted(this.refresh(true), flow.abort.signal)
    return refreshed ?? (await this.finishCancelledCliSignIn(flow))
  }

  /**
   * Cancel decides the flow, but not against what the CLI saved (the review
   * of PR #49). When the credential file changed since the flow began (the
   * browser approved as Cancel was pressed), the CLI's sign-in is read
   * afresh, a Cancel being a click that may ask it. When the code was shown
   * and the file did not change, the CLI is asked afresh too: on macOS an
   * approval may land in the Keychain alone, the pointer file as it was
   * (Codex on 55b9e24c).
   */
  private async finishCancelledCliSignIn(flow: CliSignInFlow): Promise<AuthSnapshot> {
    if (this.isSigningOut) {
      return this.snapshot
    }
    const isFileChanged = this.deps.backend.credentialFileModifiedAt() !== flow.fileBefore
    if (isFileChanged) {
      return (await unlessAborted(this.refresh(true), flow.signOut)) ?? this.snapshot
    }
    if (flow.isCodeShown) {
      this.deps.backend.forgetCliAnswers()
    }
    return await this.finishFailedCliSignIn(
      flow,
      'signedOut',
      UI_TEXT.signInCancelled,
      'info',
      flow.isCodeShown,
    )
  }

  /**
   * A flow that did not sign in: its state is published at once, then, with
   * the hold on, a Model API session, or `isAskingAfresh` (a Cancel after
   * the code was shown), a refresh reads the CLI's sign-in and publishes
   * what it finds through `publishSelection`'s guards, with the ending as a
   * notice.
   */
  private async finishFailedCliSignIn(
    flow: CliSignInFlow,
    status: 'noCli' | 'signedOut' | 'error',
    detail: string,
    noticeLevel: 'info' | 'warning',
    isAskingAfresh = false,
  ): Promise<AuthSnapshot> {
    // A sign-out that cancelled this sign-in publishes its own state.
    if (this.isSigningOut) {
      return this.snapshot
    }
    const { initial } = flow
    // The code leaves the panel at once, not after the refresh below, which
    // may wait on the CLI (the review of PR #49).
    const ended = this.set({
      ...this.snapshot,
      status,
      detail,
      verificationUrl: undefined,
      userCode: undefined,
    })
    if (
      isAskingAfresh ||
      this.isLogoutHeld ||
      (initial.status === 'signedIn' && initial.backend === 'modelApi')
    ) {
      // A sign-out that starts meanwhile publishes its own state, and does
      // not wait on the question this refresh may ask (the review of PR #49).
      const refreshed = await unlessAborted(this.refresh(true), flow.signOut)
      if (refreshed === undefined) {
        return this.snapshot
      }
      this.deps.broadcast({ type: 'notice', level: noticeLevel, text: detail })
      return refreshed
    }
    return ended
  }

  private async refreshAfterCliDiscovery(epoch: number): Promise<AuthSnapshot> {
    // Auto selection may cross backends: the refresh publishes through
    // `publishSelection`, which retires the Model API conversation first.
    return epoch === this.signOutEpoch ? await this.refresh(true) : this.snapshot
  }

  private async installWithCli(): Promise<AuthSnapshot> {
    const epoch = this.signOutEpoch
    if (this.deps.backend.resolveCli().ok) {
      return await this.refreshAfterCliDiscovery(epoch)
    }
    const shouldKeepModelApi =
      this.snapshot.status === 'signedIn' && this.snapshot.backend === 'modelApi'
    let status: AuthStatus = 'installing'
    let detail: string | undefined = UI_TEXT.installWaiting
    if (this.isLogoutHeld) {
      status = this.snapshot.status
      detail = this.snapshot.detail
    } else if (shouldKeepModelApi) {
      status = 'signedIn'
      detail = undefined
    }
    this.set({
      ...this.snapshot,
      status,
      detail,
      installState: 'running',
      hasCli: false,
    })
    try {
      this.deps.runInstallerInTerminal()
      const deadline = this.deps.now() + MUSE_INSTALL_TIMEOUT_MS
      while (this.deps.now() < deadline) {
        if (epoch !== this.signOutEpoch || this.isSigningOut) {
          return this.snapshot
        }
        if (this.deps.backend.resolveCli().ok) {
          return await this.refreshAfterCliDiscovery(epoch)
        }
        await this.deps.sleep(MUSE_INSTALL_POLL_INTERVAL_MS)
      }
      return await this.installFailed(UI_TEXT.installTimedOut, epoch)
    } catch (error: unknown) {
      this.deps.log.warn(
        `Muse Code installer terminal failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      )
      return await this.installFailed(UI_TEXT.installStartFailed, epoch)
    }
  }

  private async installFailed(detail: string, epoch: number): Promise<AuthSnapshot> {
    // The install's error path publishes what it asks here only if nothing
    // newer was published while it asked (Codex on 86d63652).
    const ticket = this.nextTicket()
    const selected = await this.selectedSnapshot(true)
    if (epoch !== this.signOutEpoch || this.isSigningOut || ticket < this.publishedTicket) {
      return this.snapshot
    }
    if (this.isLogoutHeld) {
      this.deps.broadcast({ type: 'notice', level: 'warning', text: detail })
      return this.set({
        ...this.snapshot,
        status: 'error',
        detail: this.logoutDetail(),
        installState: 'failed',
      })
    }
    // Either may sign in on another backend than conversations run on.
    if (selected.hasCli === true) {
      return await this.publishSelection(selected)
    }
    const failed = await this.publishSelection({
      ...selected,
      detail,
      installState: 'failed',
    })
    if (failed.status === 'signedIn' && failed.backend === 'modelApi') {
      this.deps.broadcast({ type: 'notice', level: 'warning', text: detail })
    }
    return failed
  }

  /** Derive from current CLI, setting and SecretStorage facts. */
  private async selectedSnapshot(isUserAction: boolean): Promise<AuthSnapshot> {
    const { cli, hasCliSession, isUnsupportedFile, choice } = await this.choose(isUserAction)
    if (choice.kind === undefined) {
      return {
        status: 'noCli',
        detail: cli.ok ? undefined : cli.reason,
        backend: undefined,
        methods: choice.methods,
        hasCli: cli.ok,
        hasCliSession,
      }
    }
    // Muse Code would be used but cannot start with its credential file:
    // said by name, not left to a host that exits at every message.
    const isBlocked = choice.kind === 'museCode' && cli.ok && isUnsupportedFile
    return {
      status: isBlocked ? 'error' : choice.status,
      detail: isBlocked ? this.unsupportedFileText() : undefined,
      backend: choice.kind,
      methods: choice.methods,
      hasCli: cli.ok,
      hasCliSession,
    }
  }

  private async activateApiKey(key: string, epoch: number): Promise<AuthSnapshot> {
    this.admissionGenerationValue += 1
    const previousKey = await this.deps.credentials.getApiKey()
    if (epoch !== this.signOutEpoch || this.isSigningOut) {
      return this.snapshot
    }
    const isReplacingActiveAccount =
      this.snapshot.status === 'signedIn' &&
      this.snapshot.backend === 'modelApi' &&
      previousKey !== key.trim()
    // Stop old turns while they still read the old key. A tool round must not
    // resume after SecretStorage begins returning the replacement key.
    if (isReplacingActiveAccount) {
      await this.restartHosts(true)
    }
    if (epoch !== this.signOutEpoch) {
      return this.snapshot
    }
    await this.deps.credentials.setApiKey(key)
    if (epoch !== this.signOutEpoch) {
      return this.snapshot
    }
    if (
      !isReplacingActiveAccount &&
      (this.snapshot.status !== 'signedIn' || this.snapshot.backend !== 'museCode')
    ) {
      await this.restartHosts(false)
    }
    const selected = await this.selectedSnapshot(true)
    // A key can move conversations off Muse Code (a CLI no longer signed in).
    return epoch === this.signOutEpoch
      ? await this.publishSelection(selected, undefined, () => epoch === this.signOutEpoch)
      : this.snapshot
  }

  /**
   * The CLI's own sign-out: `account/logout` on a short-lived host, else
   * `muse logout` in a terminal (confirmed later, by the file or the CLI).
   * Returns false when that terminal could not open.
   */
  private async logOutCli(cliPath: string): Promise<boolean> {
    const isConfirmed = await this.deps.backend.logOutCli()
    // What the CLI said before the logout no longer holds, even when the
    // file did not change (the review of PR #49).
    this.deps.backend.forgetCliAnswers()
    if (isConfirmed) {
      return true
    }
    // `account/logout` may have worked while META_API_KEY hid it from
    // `account/read` (`envKey`): the sign-in itself, read afresh, says
    // whether a terminal is still needed (the review of PR #49).
    if ((await this.deps.backend.cliSignIn(true)) === 'signedOut') {
      this.deps.log.info(
        'Muse Code did not confirm account/logout, but its sign-in now reads signed out; no terminal needed',
      )
      return true
    }
    this.deps.log.warn(
      'Muse Code still reads signed in after account/logout; running muse logout in a terminal',
    )
    try {
      this.deps.runInTerminal(cliPath, MUSE_LOGOUT_ARGS)
      return true
    } catch {
      this.deps.log.warn('Muse Code logout terminal could not open')
      return false
    }
  }

  private async performSignOut(): Promise<AuthSnapshot> {
    this.signOutEpoch += 1
    this.admissionGenerationValue += 1
    this.isSigningOut = true
    this.signOutStarts.abort()
    this.signOutStarts = new AbortController()
    this.set({
      ...this.snapshot,
      status: 'error',
      detail: UI_TEXT.signOutPending,
      verificationUrl: undefined,
      userCode: undefined,
    })
    this.cancelSignIn()
    // Cancel keeps a remembered answer; a sign-out must not decide on it: a
    // Keychain sign-in made since leaves the file as it was, and a stale
    // `signedOut` would skip `account/logout` (the review of PR #49).
    this.deps.backend.forgetCliAnswers()
    const hasPendingSignIn = this.deviceSignIn !== undefined || this.keyActivations.size > 0
    const stopping = this.stopBackendForSignOut()
    try {
      const isHoldSaved = await this.setLogoutHold(true)
      if (this.deviceSignIn !== undefined) {
        await this.deviceSignIn
      }
      await Promise.allSettled(this.keyActivations)
      let isHostStopped = await stopping
      if (hasPendingSignIn || !isHostStopped) {
        isHostStopped = await this.stopBackendForSignOut()
      }
      let isKeyClearFailed = false
      try {
        await this.deps.credentials.clearApiKey()
      } catch {
        isKeyClearFailed = true
        this.deps.log.warn('Stored Model API key could not be cleared during sign-out')
      }
      const cli = this.deps.backend.resolveCli()
      const isTerminalUnavailable =
        cli.ok &&
        isCliSignedIn(await this.deps.backend.cliSignIn(true)) &&
        !(await this.logOutCli(cli.cliPath))
      // `muse logout` rewrites the file rather than deleting it: what is in
      // it, or the CLI's own answer, says whether a sign-in remains.
      const hasCliCredential = await this.hasCliCredential(true)
      const hasStoredKey =
        isKeyClearFailed || (await this.deps.credentials.getApiKey()) !== undefined
      const shouldKeepHold = hasCliCredential || hasStoredKey || !isHostStopped
      const isReleaseSaved = shouldKeepHold || (await this.setLogoutHold(false))
      let detail: string | undefined
      if (!isHostStopped) {
        detail = UI_TEXT.signOutStopFailed
      } else if (isKeyClearFailed) {
        detail = UI_TEXT.signOutKeyClearFailed
      } else if (!isHoldSaved || !isReleaseSaved) {
        detail = UI_TEXT.signOutHoldFailed
      } else if (isTerminalUnavailable) {
        detail = UI_TEXT.signOutTerminalFailed
      } else if (shouldKeepHold) {
        detail = UI_TEXT.signOutPending
      }
      // Every detail asks for a step and a Check again, which the panel
      // offers on `error` only; `refresh` says `error` for the same state
      // (the review of PR #49).
      return this.set({
        ...this.snapshot,
        status: detail === undefined ? 'signedOut' : 'error',
        detail,
        verificationUrl: undefined,
        userCode: undefined,
        installState: undefined,
        hasCliSession: hasCliCredential,
      })
    } finally {
      this.isSigningOut = false
      // A refresh begun during the sign-out answers too late to publish (the
      // review of PR #49).
      this.signOutEpoch += 1
    }
  }

  public cancelSignIn(): void {
    this.deviceAbort?.abort()
    // Sign-out and the next sign-in ask afresh rather than wait on a probe
    // the CLI left unanswered; an answer already given stands, so what
    // Cancel shows needs no new question (the review of PR #49).
    this.deps.backend.abandonCliProbe()
  }

  /**
   * The window is closing: the browser sign-in is cancelled and waited
   * for, so its host is closed before the backends stop, and none starts
   * afterwards, not even from a click still in its pre-flight questions (the
   * review of PR #49). A flag rather than the window's signal joined to the
   * flow's connect: a stopped click then never publishes `signingIn`, asks
   * its pre-check or opens a key prompt, where a signal would reach it only
   * at the connect.
   */
  public async stopSignIn(): Promise<void> {
    this.isStopped = true
    this.cancelSignIn()
    const signingIn = this.deviceSignIn
    if (signingIn !== undefined) {
      await Promise.allSettled([signingIn])
    }
  }

  /**
   * Check again: the CLI is asked afresh, even about a sign-in it confirmed
   * before (a Keychain sign-in or sign-out leaves the file as it was; the
   * review of PR #49). Presses while one runs join it, so a second press does
   * not forget the probe the first started and start another host.
   */
  public async checkAgain(): Promise<AuthSnapshot> {
    if (this.checkingAgain !== undefined) {
      return await this.checkingAgain
    }
    this.deps.backend.forgetCliAnswers()
    const checking = this.refresh(true)
    this.checkingAgain = checking
    try {
      return await checking
    } finally {
      this.checkingAgain = undefined
    }
  }

  /** One visible installer terminal and one location watch per window. */
  public async installMuseCode(): Promise<AuthSnapshot> {
    if (this.isSigningOut) {
      return this.snapshot
    }
    if (this.installPromise !== undefined) {
      return await this.installPromise
    }
    this.installPromise = this.installWithCli()
    try {
      return await this.installPromise
    } finally {
      this.installPromise = undefined
    }
  }

  public get current(): AuthSnapshot {
    return this.snapshot
  }

  /** The backend the next conversation runs on; undefined without any credential. */
  public get backend(): BackendKind | undefined {
    return this.snapshot.status === 'signedIn' &&
      !this.isLogoutHeld &&
      !this.isSigningOut &&
      this.keyActivations.size === 0 &&
      !this.isLogoutPersistenceFailed
      ? this.snapshot.backend
      : undefined
  }

  public get admissionGeneration(): number {
    return this.admissionGenerationValue
  }

  public toMessage(): HostToWebviewMessage {
    return {
      type: 'authState',
      status: this.snapshot.status,
      ...(this.snapshot.detail !== undefined && { detail: this.snapshot.detail }),
      ...(this.snapshot.backend !== undefined && { backend: this.snapshot.backend }),
      ...(this.snapshot.methods !== undefined && { methods: [...this.snapshot.methods] }),
      ...(this.snapshot.verificationUrl !== undefined && {
        verificationUrl: this.snapshot.verificationUrl,
      }),
      ...(this.snapshot.userCode !== undefined && { userCode: this.snapshot.userCode }),
      installCommand: this.deps.installCommand,
      ...(this.snapshot.hasCli !== undefined && { hasCli: this.snapshot.hasCli }),
      ...(this.snapshot.hasCliSession !== undefined && {
        hasCliSession: this.snapshot.hasCliSession,
      }),
      ...(this.snapshot.installState !== undefined && { installState: this.snapshot.installState }),
    }
  }

  /**
   * Re-derive the status from the CLI, credential and setting facts, then
   * broadcast. `isUserAction` (Check again, a sign-in or sign-out) lets
   * macOS ask the CLI about a Keychain sign-in; opening a panel does not.
   */
  public async refresh(isUserAction = false): Promise<AuthSnapshot> {
    const epoch = this.signOutEpoch
    // Publications are ordered by when their questions began: a slower,
    // older refresh never overwrites a newer state (the review of PR #49).
    const ticket = this.nextTicket()
    const selected = await this.selectedSnapshot(isUserAction)
    // A refresh begun before a sign-out (its probe may answer long after)
    // never overwrites what the sign-out, or a later sign-in, published (the
    // review of PR #49).
    if (this.signOutEpoch !== epoch) {
      return this.snapshot
    }
    if (this.isSigningOut) {
      return await this.publishRefresh(ticket, epoch, {
        ...selected,
        status: 'error',
        detail: this.logoutDetail(),
      })
    }
    if (!this.isLogoutHeld) {
      return await this.publishRefresh(ticket, epoch, selected)
    }
    const hasCliCredential = await this.hasCliCredential(isUserAction)
    const hasStoredKey = (await this.deps.credentials.getApiKey()) !== undefined
    if (this.signOutEpoch !== epoch) {
      return this.snapshot
    }
    if (hasCliCredential || hasStoredKey) {
      return await this.publishRefresh(ticket, epoch, {
        ...selected,
        status: 'error',
        detail: this.logoutDetail(),
      })
    }
    const isHoldSaved = await this.setLogoutHold(false)
    if (!isHoldSaved) {
      return await this.publishRefresh(ticket, epoch, {
        ...selected,
        status: 'error',
        detail: UI_TEXT.signOutHoldFailed,
      })
    }
    const current = await this.selectedSnapshot(isUserAction)
    const hasCurrentCredential =
      (await this.hasCliCredential(isUserAction)) ||
      (await this.deps.credentials.getApiKey()) !== undefined
    if (this.signOutEpoch !== epoch) {
      // A sign-out raced this release: its state is its own, and so is the
      // hold. One still running holds it again; one that has ended decided
      // it, and a late answer must not put back a hold it released (the
      // review of PR #49).
      if (this.isSignOutRunning()) {
        await this.setLogoutHold(true)
      }
      return this.snapshot
    }
    if (hasCurrentCredential || current.status === 'signedIn') {
      await this.setLogoutHold(true)
      return await this.publishRefresh(ticket, epoch, {
        ...current,
        status: 'error',
        detail: this.logoutDetail(),
      })
    }
    return await this.publishRefresh(ticket, epoch, current)
  }

  public async signIn(method: SignInMethod): Promise<AuthSnapshot> {
    if (this.isSigningOut || this.isStopped) {
      return this.snapshot
    }
    const epoch = this.signOutEpoch
    if (this.isLogoutHeld) {
      // A sign-in the CLI still holds after sign-out can be replaced only by
      // an explicit new browser approval, with no key that would bill instead.
      const canRecoverCliSignIn =
        method === 'browser' &&
        !this.deps.backend.hasEnvironmentKey() &&
        isCliSignedIn(await this.deps.backend.cliSignIn(true)) &&
        (await this.deps.credentials.getApiKey()) === undefined
      if (epoch !== this.signOutEpoch) {
        return this.snapshot
      }
      if (!canRecoverCliSignIn) {
        const refreshed = await this.refresh(true)
        if (epoch !== this.signOutEpoch) {
          return this.snapshot
        }
        if (refreshed.status === 'error') {
          return refreshed
        }
      }
    }
    this.deps.log.info(`Sign-in started: ${method}`)
    if (method === 'apiKey') {
      const key = await this.deps.promptForApiKey()
      if (key === undefined) {
        this.deps.log.info('Sign-in with an API key cancelled')
        return this.snapshot
      }
      if (epoch !== this.signOutEpoch) {
        return this.snapshot
      }
      const activation = this.activateApiKey(key, epoch)
      this.keyActivations.add(activation)
      try {
        return await activation
      } finally {
        this.keyActivations.delete(activation)
      }
    }
    return await this.joinDeviceSignIn()
  }

  public async signOut(): Promise<AuthSnapshot> {
    const running = this.signOutPromise ?? this.performSignOut()
    this.signOutPromise = running
    try {
      return await running
    } finally {
      if (this.signOutPromise === running) {
        this.signOutPromise = undefined
      }
    }
  }

  /** The backend answered a turn with `authRequired`: the estimate was wrong. */
  public markAuthRequired(reason: string): AuthSnapshot {
    // The reason is the backend's own text: the panel shows it, and the log
    // names it only in the shape of a protocol word (the review of PR #49).
    this.deps.log.warn(`The backend reported authRequired: ${wireWordForLog(reason)}`)
    return this.set({ ...this.snapshot, status: 'signedOut', detail: reason })
  }

  public markBackendError(detail: string): AuthSnapshot {
    return this.set({ ...this.snapshot, status: 'error', detail })
  }
}
