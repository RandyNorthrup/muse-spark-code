// Which pull request each conversation opened (M71, PLAN.md D49): kept in
// the extension's own workspace state by session id, so the conversation
// shows its pull request's status again when it is resumed. The link names
// the pull request only; its status is read from GitHub each time.

import * as z from 'zod/mini'
import { PULL_REQUEST_LINKS_KEPT, WORKSPACE_STATE_KEYS } from '../../shared/constants'

const linkSchema = z.object({
  repository: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  /** Epoch ms, for dropping the oldest past the limit. */
  linkedAt: z.number(),
})
export type PullRequestLink = z.infer<typeof linkSchema>

const linksSchema = z.record(z.string(), linkSchema)

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
    const parsed = linksSchema.safeParse(
      this.memento.get(WORKSPACE_STATE_KEYS.pullRequestLinks) ?? {},
    )
    return parsed.success ? parsed.data : {}
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
      const kept = Object.entries({ ...this.all(), [sessionId]: link })
        .toSorted(([, left], [, right]) => right.linkedAt - left.linkedAt)
        .slice(0, PULL_REQUEST_LINKS_KEPT)
      await this.memento.update(WORKSPACE_STATE_KEYS.pullRequestLinks, Object.fromEntries(kept))
    })()
    // A failed caller still receives its rejection; later saves can retry.
    this.pendingWrite = settled(write)
    return write
  }
}
