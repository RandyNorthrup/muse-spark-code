// Where the estimator history lives (M117 C-M117-2, PLAN.md D97.4), apart
// from the journal itself: the activation bundle names the directory, and
// the journal and its record rules load with dist/estimator.js on the first
// estimate (PLAN.md D6).
import path from 'node:path'
import { ESTIMATE_HISTORY_DIRECTORY } from '../../shared/constants'

/** The journal directory under a host's agent data folder. */
export function estimateHistoryDirectory(dataFolder: string): string {
  return path.join(dataFolder, ESTIMATE_HISTORY_DIRECTORY)
}
