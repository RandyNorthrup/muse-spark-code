// Sending a message as the user's own outside the composer (M88, PLAN.md
// D67, lane P): the prompt sequence runner drives the conversation through
// this, and only while the session can take a message. The controller
// implements it; a run's own id keeps its steps from counting as busy.

/** Why the session cannot take a message right now, in fixed words. */
export type DeferredSendVerdict = 'ok' | 'busy' | 'notLoaded'

/** A turn's end, as the runner reads it: only `completed` advances a run. */
export interface TurnSettled {
  readonly turnId: string
  /** Open on the wire; anything but `completed` ends a run. */
  readonly terminal: string
}

export interface DeferredSend {
  /**
  Whether the session can take a message now: loaded, with no turn running,
  no turn queued, and no other sequence run going. `exceptRunId` is the
  caller's own run, which never blocks its own steps.
  */
  canSendNow(sessionId: string, exceptRunId?: string): DeferredSendVerdict
  /**
  Submit as the composer's Send does, only while `canSendNow` holds for
  the run's session; otherwise refuse with that verdict and send nothing.
  */
  sendAsUser(
    text: string,
    run: { readonly sessionId: string; readonly runId: string },
  ): Promise<{ readonly verdict: DeferredSendVerdict; readonly turnId?: string }>
  /** Every own-session turn's end, so a waiting step can go. */
  onTurnSettled(listener: (settled: TurnSettled) => void): () => void
}
