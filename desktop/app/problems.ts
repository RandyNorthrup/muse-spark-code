// Muse Desktop (M111, D91.13) lane BP: the Problems store. The main
// process holds the workspace's diagnostics (M68's shapes over the
// bridge); suppliers (ED's check runs) replace the whole list, and the
// renderer re-reads it on every change event. Until a supplier publishes,
// the list is honestly empty.

import {
  problemsChangedSchema,
  type PanelProblem,
  type ProblemsChanged,
} from '../../src/shared/desktop/bridge'

export class ProblemsStore {
  private problems: readonly PanelProblem[] = []

  public constructor(private readonly onChanged: (snapshot: ProblemsChanged) => void) {}

  /** Replaces the list; a malformed list is refused by name to the caller. */
  public replace(problems: readonly PanelProblem[]): void {
    const parsed = problemsChangedSchema.parse({ problems: [...problems] })
    this.problems = parsed.problems
    this.onChanged({ problems: [...this.problems] })
  }

  public snapshot(): ProblemsChanged {
    return { problems: [...this.problems] }
  }
}
