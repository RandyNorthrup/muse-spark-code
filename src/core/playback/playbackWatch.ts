// Which turn a Plan-held `/playback` runs as, and whether it reached for a
// tool (D203), the same on every surface that holds one. It is armed before
// the turn is submitted: a backend can report the turn's items before its
// acknowledgement names the turn (Muse Code's `turn/start` notification may
// beat the command's answer), so a tool item seen while armed is kept by its
// turn and counted the moment the turn is known. Bookkeeping only: the
// surface stops the turn and says why.

export class PlaybackWatch {
  /** Armed: the turns that reached for a tool before the playback's turn was named. */
  private early: Set<string> | undefined
  private turnId: string | undefined
  private isStopped = false

  /** Before the submission: from now on a tool item is kept by its turn. */
  public arm(): void {
    this.early = new Set()
    this.turnId = undefined
    this.isStopped = false
  }

  /**
   * The submission named the playback's turn: true when that turn already
   * reached for a tool, so the surface stops it now.
   */
  public bind(turnId: string): boolean {
    const isEarly = this.early?.has(turnId) === true
    this.early = undefined
    this.turnId = turnId
    this.isStopped = isEarly
    return isEarly
  }

  /** A tool item of some turn: true when it is the playback turn's first, so the surface stops it now. */
  public sawTool(turnId: string): boolean {
    if (this.early !== undefined) {
      this.early.add(turnId)
      return false
    }
    if (this.isStopped || turnId !== this.turnId) {
      return false
    }
    this.isStopped = true
    return true
  }

  /** Whether `turnId` is the playback's own turn, watched until it ends. */
  public isWatching(turnId: string): boolean {
    return this.turnId === turnId
  }

  /** The turn ended, or no playback turn of its own runs: nothing is watched. */
  public clear(): void {
    this.early = undefined
    this.turnId = undefined
    this.isStopped = false
  }
}
