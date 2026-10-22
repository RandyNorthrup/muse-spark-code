// The estimator history's host side (M117 C-M117-2, PLAN.md D97.4): the
// journal in the agent data folder, shared by every workspace's lanes so a
// lane kind calibrates across workspaces. The caller supplies trusted
// application storage, never a workspace or a credential directory. History
// records hold lane ids, hours and counts, never content.
import { EstimateHistoryJournal } from '../../core/estimator/calibration/journal'

export { estimateHistoryDirectory } from './historyDirectory'

export interface FileHistoryPorts {
  /** The journal's records for calibration. */
  history: () => Promise<unknown>
  /** The journal's per-list skip diagnostics for the honesty block. */
  skipped: () => Promise<unknown>
}

/** File-backed history ports over one journal instance: the skipped snapshot
belongs to the same listing the records came from. */
export function fileHistoryPorts(directory: string): FileHistoryPorts {
  const journal = new EstimateHistoryJournal(directory)
  return {
    history: () => journal.list(),
    skipped: () => Promise.resolve(journal.skippedRecords),
  }
}
