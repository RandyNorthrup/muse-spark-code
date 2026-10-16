// Which pull request each conversation opened (M71, PLAN.md D49): kept in
// the extension's own workspace state by session id, so the conversation
// shows its pull request's status again when it is resumed. The link names
// the pull request only; its status is read from GitHub each time.

import { WORKSPACE_STATE_KEYS } from '../../shared/constants'
import {
  parsePullRequestLinkRecords,
  prunePullRequestLinks,
  type PullRequestLinkRecord,
} from '../../core/git/pullRequestLinksStore'

export type PullRequestLink = PullRequestLinkRecord

/** `vscode.Memento`'s two methods this reads and writes. */
export interface LinkMemento {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void>
}

/** A failed save rejects its caller while the next save still waits for it to finish. */
async function settled(write: Promise<void>): Promise<void> {
  try {
    await write
  } catch {
    // The original caller receives this failure; subsequent saves may retry.
  }
}

export class PullRequestLinks {
  private pendingWrite: Promise<void> = Promise.resolve()
  public constructor(private readonly memento: LinkMemento) {}

  /** The stored links; a value that does not validate reads as none. */
  private all(): Readonly<Record<string, PullRequestLink>> {
    return parsePullRequestLinkRecords(
      this.memento.get(WORKSPACE_STATE_KEYS.pullRequestLinks) ?? {},
    )
  }

  public get(sessionId: string): PullRequestLink | undefined {
    const links = this.all()
    return Object.hasOwn(links, sessionId) ? links[sessionId] : undefined
  }

  /** Links `sessionId` to `link`, keeping the newest PULL_REQUEST_LINKS_KEPT. */
  public set(sessionId: string, link: PullRequestLink): Promise<void> {
    const previous = this.pendingWrite
    const write = (async () => {
      await previous
      const kept = prunePullRequestLinks({ ...this.all(), [sessionId]: link })
      await this.memento.update(WORKSPACE_STATE_KEYS.pullRequestLinks, kept)
    })()
    // A failed caller still receives its rejection; later saves can retry.
    this.pendingWrite = settled(write)
    return write
  }
}
