// The worktree records every window shares (M71, core/worktreeConversations.ts),
// in the extension's global state, and this window's hold on someone
// else's pull request.

import {
  parseWorktreeRegistry,
  recordFor,
  withRecord,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../core/worktreeConversations'
import { isSamePath } from '../../core/paths'
import { GLOBAL_STATE_KEYS } from '../../shared/constants'

/** `vscode.Memento`'s two methods this reads and writes. */
export interface RegistryMemento {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void>
}

export class WorktreeRegistry {
  private pendingWrite: Promise<void> = Promise.resolve()
  public constructor(
    private readonly memento: RegistryMemento,
    private readonly platform: NodeJS.Platform,
    /** Whether a folder is still there: a removed worktree's record is dropped. */
    private readonly isFolderPresent: (folder: string) => boolean,
  ) {}

  /** Pending publication records persist before their folders exist. */
  private stored(): readonly WorktreeRecord[] {
    return parseWorktreeRegistry(this.memento.get(GLOBAL_STATE_KEYS.worktreeConversations))
  }

  private write<T>(update: () => Promise<T>): Promise<T> {
    const previous = this.pendingWrite
    const write = (async () => {
      await previous
      return await update()
    })()
    this.pendingWrite = this.settled(write)
    return write
  }

  private async settled(write: Promise<unknown>): Promise<void> {
    try {
      await write
    } catch {
      // The original caller receives failure; a later owned update can retry.
    }
  }

  /** The records whose worktree still exists. */
  public records(): readonly WorktreeRecord[] {
    return this.stored().filter((record) => this.isFolderPresent(record.folder))
  }

  public recordFor(folder: string): WorktreeRecord | undefined {
    return recordFor(this.records(), folder, this.platform)
  }

  /** Returns the replaced record, including a checkout that has not made its folder yet. */
  public put(record: WorktreeRecord): Promise<WorktreeRecord | undefined> {
    return this.write(async () => {
      const records = this.stored()
      const previous = recordFor(records, record.folder, this.platform)
      await this.memento.update(
        GLOBAL_STATE_KEYS.worktreeConversations,
        withRecord(records, record, this.platform),
      )
      return previous
    })
  }

  /** A failed publication rolls back only its own record, preserving a concurrent checkout. */
  public remove(folder: string, createdAt?: number, previous?: WorktreeRecord): Promise<void> {
    return this.write(async () => {
      const records = this.stored()
      if (
        createdAt !== undefined &&
        recordFor(records, folder, this.platform)?.createdAt !== createdAt
      ) {
        return
      }
      const remaining = records.filter(
        (record) => !isSamePath(record.folder, folder, this.platform),
      )
      await this.memento.update(
        GLOBAL_STATE_KEYS.worktreeConversations,
        previous === undefined ? remaining : withRecord(remaining, previous, this.platform),
      )
    })
  }
}

/**
 * This window's hold, decided at activation (`holdFor`) and let go only by
 * the user's confirmation in the held-worktree card.
 */
export class WindowHold {
  private hold: WorktreeHold | undefined

  public constructor(hold: WorktreeHold | undefined) {
    this.hold = hold
  }

  public get current(): WorktreeHold | undefined {
    return this.hold
  }

  public get isHeld(): boolean {
    return this.hold !== undefined
  }

  /**
   * Whether the project's own configuration may load: its rules, skills,
   * hooks and MCP servers, Muse Code's `--trust-workspace`, the backends'
   * workspace shell. VS Code must trust the folder, and the window must not
   * be held: a held window stays without them whatever VS Code says (M71).
   */
  public allowsProjectConfiguration(isVsCodeTrusted: boolean): boolean {
    return isVsCodeTrusted && !this.isHeld
  }

  public release(): void {
    this.hold = undefined
  }
}
