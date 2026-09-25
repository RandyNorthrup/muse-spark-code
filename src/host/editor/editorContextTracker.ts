// Follows the active text editor and its selection for the composer's
// file chip (M5): the host feeds it snapshots, it keeps the latest one for the
// next send and broadcasts the label to every surface after a short quiet gap
// (selections change on every arrow key). No `vscode` import; the extension
// entry point maps editor events onto `update`. It hands over a reader, not
// a snapshot (M39): the selected text is read once the selection has settled
// and at send time, not on every arrow key.

import { type EditorContext, editorContextSummary } from '../../core/editorContext'
import { EDITOR_CONTEXT_DEBOUNCE_MS } from '../../shared/constants'
import type { EditorContextSummary } from '../../shared/protocol'

export interface EditorContextTrackerDeps {
  readonly broadcast: (context: EditorContextSummary | undefined) => void
}

function isSameSummary(
  a: EditorContextSummary | undefined,
  b: EditorContextSummary | undefined,
): boolean {
  return a === undefined || b === undefined
    ? a === b
    : a.relativePath === b.relativePath &&
        a.startLine === b.startLine &&
        a.endLine === b.endLine &&
        a.isEmpty === b.isEmpty
}

export class EditorContextTracker {
  private read: (() => EditorContext | undefined) | undefined
  private announced: EditorContextSummary | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  public constructor(private readonly deps: EditorContextTrackerDeps) {}

  private clearTimer(): void {
    if (this.timer === undefined) {
      return
    }
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private announce(): void {
    this.timer = undefined
    const next = this.summary
    if (isSameSummary(next, this.announced)) {
      return
    }
    this.announced = next
    this.deps.broadcast(next)
  }

  /** The editor state now, for the message being sent now. */
  public get active(): EditorContext | undefined {
    return this.read?.()
  }

  /** The label now, for a surface that has just opened. */
  public get summary(): EditorContextSummary | undefined {
    const current = this.active
    return current === undefined ? undefined : editorContextSummary(current)
  }

  /** The editor changed: `read` gives its state whenever it is needed. */
  public update(read: () => EditorContext | undefined): void {
    this.read = read
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.announce()
    }, EDITOR_CONTEXT_DEBOUNCE_MS)
  }

  public dispose(): void {
    this.clearTimer()
  }
}
