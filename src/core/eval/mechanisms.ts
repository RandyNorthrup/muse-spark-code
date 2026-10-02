// The M75 arms beyond the baseline (PLAN.md D49): one per token-saving
// mechanism. Each is a change to the harness's own dependencies
// (`EvalHostChange`), so the two arms of a pair differ in that alone. M73
// adds observation packing; M74 adds its compaction with its own run.

import { OBS_PACK_THRESHOLD_CHARS, OBS_PACK_WHOLE_SENDS } from '../../shared/constants'
import type { EvalArm } from './runner'

/**
 * Observation packing (M73): the eval host packs as the shipped host does
 * with the setting on. A tool result over the threshold rides whole for its
 * first requests, then as a placeholder the model pages back with
 * `recall_output`.
 */
export const OBSERVATION_PACKING_ARM: EvalArm = {
  name: 'packing',
  mechanism: `observation packing (M73): a tool result over ${String(OBS_PACK_THRESHOLD_CHARS)} characters rides whole for ${String(OBS_PACK_WHOLE_SENDS)} requests, then as a placeholder with its id, size and first and last lines; recall_output pages the original back`,
  change: (deps) => ({ ...deps, observationPacking: true }),
}
