// A workspace's bookmarks (M88, PLAN.md D67, lane B): the records behind
// `BookmarkPort`. Every workspace's list lives in `globalState` under one
// state key, filed under the digest of the workspace file's URI (else the
// first folder's URI), so Settings Sync can carry it and no path is
// stored. The same key serves with sync on and off, so flipping the
// setting moves nothing. Each workspace's list is validated on its own: a
// damaged list is reported and kept as found, and the other workspaces'
// bytes pass through every write untouched.

import * as z from 'zod/mini'
import { workspaceKey } from '../../runtime/dataFolder'
import { BOOKMARK_SYNC_KEY, UI_TEXT } from '../../shared/constants'
import { bookmarkRecordSchema, type BookmarkRecord } from '../../shared/protocol'

/** The `globalState` surface the store reads and writes (VS Code's Memento). */
export interface BookmarkState {
  get(key: string): Promise<unknown>
  update(key: string, value: unknown): Promise<void>
}

const bookmarkStoreSchema = z.object({
  version: z.literal(1),
  // Each workspace's bytes stay opaque here: its list is validated on its
  // own when read, so one damaged list never hides the others.
  workspaces: z.record(z.string(), z.unknown()),
})
const bookmarkListSchema = z.array(bookmarkRecordSchema)

export class BookmarkStore {
  public constructor(
    private readonly state: BookmarkState,
    /** The workspace file's URI, else the first folder's; undefined without a folder. */
    private readonly workspaceUri: string | undefined,
    private readonly now: () => number,
  ) {}

  private digest(): string | undefined {
    return this.workspaceUri === undefined ? undefined : workspaceKey(this.workspaceUri)
  }

  private async readOwn(): Promise<{
    readonly workspaces: Record<string, unknown>
    readonly own: BookmarkRecord[]
  }> {
    const digest = this.digest()
    if (digest === undefined) {
      return { workspaces: {}, own: [] }
    }
    const stored = await this.state.get(BOOKMARK_SYNC_KEY)
    if (stored === undefined) {
      return { workspaces: {}, own: [] }
    }
    const envelope = bookmarkStoreSchema.safeParse(stored)
    if (!envelope.success) {
      throw new Error(UI_TEXT.bookmarksUnavailable)
    }
    const raw = envelope.data.workspaces[digest]
    if (raw === undefined) {
      return { workspaces: { ...envelope.data.workspaces }, own: [] }
    }
    const own = bookmarkListSchema.safeParse(raw)
    if (!own.success) {
      throw new Error(UI_TEXT.bookmarksUnavailable)
    }
    return { workspaces: { ...envelope.data.workspaces }, own: [...own.data] }
  }

  private async writeOwn(
    workspaces: Record<string, unknown>,
    digest: string,
    own: readonly BookmarkRecord[],
  ): Promise<void> {
    await this.state.update(BOOKMARK_SYNC_KEY, {
      version: 1,
      workspaces: { ...workspaces, [digest]: [...own] },
    })
  }

  /** Every record filed under this workspace, oldest first; none without a folder. */
  public async list(): Promise<readonly BookmarkRecord[]> {
    const { own } = await this.readOwn()
    return own
  }

  /** Whether the session is bookmarked in this workspace; false without a folder. */
  public async has(backend: BookmarkRecord['backend'], sessionId: string): Promise<boolean> {
    const { own } = await this.readOwn()
    return own.some((record) => record.backend === backend && record.sessionId === sessionId)
  }

  /**
  Set or remove one bookmark; answers the workspace's records after. A
  window without a folder refuses; a damaged list is kept as found. An
  unchanged write is skipped, so opening History never churns sync.
  */
  public async set(input: {
    readonly backend: BookmarkRecord['backend']
    readonly sessionId: string
    readonly title: string
    readonly isBookmarked: boolean
  }): Promise<readonly BookmarkRecord[]> {
    const digest = this.digest()
    if (digest === undefined) {
      throw new Error(UI_TEXT.bookmarkNoWorkspace)
    }
    const { workspaces, own } = await this.readOwn()
    const at = own.findIndex(
      (record) => record.backend === input.backend && record.sessionId === input.sessionId,
    )
    if (input.isBookmarked) {
      const previous = at === -1 ? undefined : own[at]
      if (previous === undefined) {
        own.push({
          backend: input.backend,
          sessionId: input.sessionId,
          title: input.title,
          bookmarkedAtMs: this.now(),
        })
      } else if (previous.title === input.title) {
        return own
      } else {
        own[at] = { ...previous, title: input.title }
      }
    } else if (at === -1) {
      return own
    } else {
      own.splice(at, 1)
    }
    await this.writeOwn(workspaces, digest, own)
    return own
  }

  /**
  Refresh stored titles from listed rows; answers the records after. A
  session the list no longer names keeps its stored title, and an
  unchanged refresh writes nothing.
  */
  public async refreshTitles(
    rows: readonly { readonly sessionId: string; readonly title: string }[],
  ): Promise<readonly BookmarkRecord[]> {
    const digest = this.digest()
    if (digest === undefined) {
      return []
    }
    const { workspaces, own } = await this.readOwn()
    let isChanged = false
    for (const [index, record] of own.entries()) {
      const row = rows.find((candidate) => candidate.sessionId === record.sessionId)
      if (row === undefined || row.title === record.title) {
        continue
      }
      own[index] = { ...record, title: row.title }
      isChanged = true
    }
    if (isChanged) {
      await this.writeOwn(workspaces, digest, own)
    }
    return own
  }
}
