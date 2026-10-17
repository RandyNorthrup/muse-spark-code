// One owner per extension window. Injected into every surface's runner;
// never shared through module state or across accounts/windows.

import type { BestOfNRun } from '../../shared/bestOfN'

export class BestOfNCoordinator {
  private owner: object | undefined
  private readonly runs = new Map<object, BestOfNRun>()
  private readonly openers = new Map<object, (attemptId: string, runId: string) => Promise<void>>()

  public acquire(owner: object): boolean {
    if (this.owner === owner) {
      return true
    }
    if (this.owner !== undefined) {
      return false
    }
    this.owner = owner
    return true
  }

  public release(owner: object): void {
    if (this.owner === owner) {
      this.owner = undefined
    }
  }

  public update(
    owner: object,
    run: BestOfNRun,
    open?: (attemptId: string, runId: string) => Promise<void>,
  ): void {
    this.runs.set(owner, run)
    if (open !== undefined) this.openers.set(owner, open)
  }

  public forget(owner: object): void {
    this.runs.delete(owner)
    this.openers.delete(owner)
  }

  public snapshots(): readonly BestOfNRun[] {
    const snapshots: BestOfNRun[] = []
    this.runs.forEach((run) => {
      snapshots.push(run)
    })
    return snapshots
  }

  /** Board activation opens an ephemeral attempt's owned worktree. */
  public async openSession(sessionId: string): Promise<boolean> {
    for (const [owner, run] of this.runs) {
      const attempt = run.runAttempts.find((entry) => entry.sessionId === sessionId)
      const open = this.openers.get(owner)
      if (attempt !== undefined && open !== undefined) {
        await open(attempt.attemptId, run.runId)
        return true
      }
    }
    return false
  }
}
