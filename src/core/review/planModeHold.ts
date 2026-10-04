// A review turn on Muse Code (M70, PLAN.md D49). The diff under review is
// untrusted content, and Muse Code has no read-only reviewer the extension
// can pick, so the turn runs in Plan mode (MSP `denyUnmatched`) and the mode
// the user had comes back once that turn ends. Muse Code's Plan mode applies
// its own allow rules, so the review is not claimed strictly read-only
// (D46). The user choosing a mode meanwhile, or the session going, releases
// the hold: nothing is put back over the user's choice or on a dead session.

import type { TurnPart, TurnSubmission } from '../agent/agentBackend'
import { UI_TEXT } from '../../shared/constants'

/** What the hold needs of a session: the mode and the turn. */
export interface PlanModeSession {
  setApprovalMode(mode: string): Promise<void>
  sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission>
}

/**
 * The mode put back, or why not. `isAfterTurn` is false when the review turn
 * never started (its send failed after Plan mode was set).
 */
export type PlanModeRestore =
  | { readonly ok: true; readonly isAfterTurn: boolean }
  | { readonly ok: false; readonly isAfterTurn: boolean; readonly error: unknown }

export interface PlanModeHoldDeps {
  /** MSP's Plan mode. */
  readonly planMode: string
  /** The mode to put back, asked when the turn ends (a revoked Bypass is not put back). */
  readonly restoreMode: () => string
  /** The mode was put back, or could not be; never called once released. */
  readonly onRestored: (outcome: PlanModeRestore) => void
}

export class PlanModeHold {
  private session: PlanModeSession | undefined
  private turnId: string | undefined
  /** Turns that ended before the review turn's id was known (a fast turn's end beats its ack). */
  private readonly endedEarly = new Set<string>()
  private isReleased = false
  private isRestoring = false
  private modeChange: Promise<void> | undefined
  /** Includes any corrective restore, so a user's choice cannot overtake it. */
  private restoration: Promise<void> | undefined

  public constructor(private readonly deps: PlanModeHoldDeps) {}

  private async setMode(session: PlanModeSession, mode: string): Promise<void> {
    const changing = session.setApprovalMode(mode)
    this.modeChange = changing
    try {
      await changing
    } finally {
      if (this.modeChange === changing) {
        this.modeChange = undefined
      }
    }
  }

  private restore(isAfterTurn: boolean): Promise<void> {
    const { session } = this
    if (session === undefined || this.isRestoring || this.isReleased) {
      return Promise.resolve()
    }
    this.isRestoring = true
    const restoring = this.restoreMode(session, isAfterTurn)
    this.restoration = restoring
    return restoring
  }

  private async restoreMode(session: PlanModeSession, isAfterTurn: boolean): Promise<void> {
    let outcome: PlanModeRestore
    try {
      let mode = this.deps.restoreMode()
      await this.setMode(session, mode)
      // Bypass can be revoked while its restore is in flight. Correct the
      // actual backend before reporting restoration; a released hold leaves
      // the final choice to the user waiting on this whole operation.
      while (!this.hasBeenReleased()) {
        const current = this.deps.restoreMode()
        if (current === mode) {
          break
        }
        mode = current
        await this.setMode(session, mode)
      }
      outcome = { ok: true, isAfterTurn }
    } catch (error: unknown) {
      outcome = { ok: false, isAfterTurn, error }
    }
    // The user may have chosen a mode while the restore was on its way.
    if (this.hasBeenReleased()) {
      return
    }
    this.isReleased = true
    this.deps.onRestored(outcome)
  }

  /** Read afresh after an await: a release can land while the mode is set. */
  private hasBeenReleased(): boolean {
    return this.isReleased
  }

  /** A user-selected mode follows this hold's outstanding request, including a failed one. */
  public async waitForModeChange(): Promise<void> {
    try {
      await (this.restoration ?? this.modeChange)
    } catch {
      // send/restore owns the failure; waiting only orders the user's next mode request.
    }
  }

  /**
   * Plan mode, then the review turn. A send that fails puts the mode back
   * before it rethrows; `isCurrent` false after the mode change stops the
   * send (the session went meanwhile).
   */
  public async send(
    session: PlanModeSession,
    parts: readonly TurnPart[],
    displayText: string,
    isCurrent: () => boolean,
  ): Promise<TurnSubmission> {
    this.session = session
    await this.setMode(session, this.deps.planMode)
    let submission: TurnSubmission
    try {
      if (!isCurrent()) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      if (this.hasBeenReleased()) {
        throw new Error(UI_TEXT.reviewCancelled)
      }
      submission = await session.sendTurn(parts, displayText)
    } catch (error: unknown) {
      await this.restore(false)
      throw error
    }
    this.turnId = submission.turnId
    if (this.endedEarly.has(submission.turnId)) {
      await this.restore(true)
    }
    this.endedEarly.clear()
    return submission
  }

  /** A turn ended (completed, failed, cancelled or withdrawn): the review's own puts the mode back. */
  public turnEnded(turnId: string): void {
    if (this.turnId === undefined) {
      this.endedEarly.add(turnId)
      return
    }
    if (turnId === this.turnId) {
      void this.restore(true)
    }
  }

  /** The user chose a mode, or the session went: nothing is put back. */
  public release(): void {
    this.isReleased = true
  }
}
