// Follows the active text editor and its selection for the composer's
// file chip (M5): the host feeds it snapshots, it keeps the latest one for the
// next send and broadcasts the label to every surface after a short quiet gap
// (selections change on every arrow key). No `vscode` import; the extension
// entry point maps editor events onto `update`.

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
  private current: EditorContext | undefined
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

  /** The latest editor state, for the message being sent now. */
  public get active(): EditorContext | undefined {
    return this.current
  }

  /** The label as last broadcast, for a surface that has just opened. */
  public get summary(): EditorContextSummary | undefined {
    return this.current === undefined ? undefined : editorContextSummary(this.current)
  }

  public update(snapshot: EditorContext | undefined): void {
    this.current = snapshot
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.announce()
    }, EDITOR_CONTEXT_DEBOUNCE_MS)
  }

  public dispose(): void {
    this.clearTimer()
  }
}
