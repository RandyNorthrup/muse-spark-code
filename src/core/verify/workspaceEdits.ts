// Workspace write notices shared by live conversations and host-owned writers
// (M68, PLAN.md D49). Observers keep their own check state; this registry can
// exist before the lazy Model API backend loads.

import type { EditedFile } from './diagnosticsReport'

/** A captured live owner; invoking it never assigns an edit to a later session object. */
export type WorkspaceEditRecorder = (file: EditedFile) => void

interface WorkspaceEditObserver {
  beginEdit(file: EditedFile, names: readonly string[]): () => void
}

interface PendingEdit {
  readonly file: EditedFile
  readonly names: readonly string[]
}

/** One process/window's workspace writes, shared with its conversations and children. */
export class WorkspaceEdits {
  private readonly ledgers = new Set<WorkspaceEditObserver>()
  private readonly pending = new Set<
    PendingEdit & { readonly completions: Map<WorkspaceEditObserver, () => void> }
  >()

  /** A newly live session hears about every write still in progress. */
  public add(ledger: WorkspaceEditObserver): void {
    this.ledgers.add(ledger)
    for (const edit of this.pending) {
      edit.completions.set(ledger, ledger.beginEdit(edit.file, edit.names))
    }
  }

  /** A disposed session no longer receives notices or holds a pending write. */
  public delete(ledger: WorkspaceEditObserver): void {
    this.ledgers.delete(ledger)
    for (const edit of this.pending) {
      edit.completions.get(ledger)?.()
      edit.completions.delete(ledger)
    }
  }

  /** Notify synchronously before any write, then release in the caller's finally. */
  public beginEdit(file: EditedFile, names: readonly string[]): () => void {
    const completions = new Map(
      [...this.ledgers].map((ledger) => [ledger, ledger.beginEdit(file, names)]),
    )
    const edit = { file, names, completions }
    this.pending.add(edit)
    return () => {
      this.pending.delete(edit)
      for (const complete of completions.values()) {
        complete()
      }
    }
  }
}
