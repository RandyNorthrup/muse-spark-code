// The M75 arms beyond the baseline (PLAN.md D49): one per token-saving
// mechanism. Each is a change to the harness's own dependencies
// (`EvalHostChange`), so the two arms of a pair differ in that alone. M73
// adds observation packing; M74 adds its compaction with its own run; M101
// item 24 adds strict tool schemas for a capable selected model.
//
// `EVAL_ARMS` is the frozen set the counted run uses: arms before it run no
// counted model call, and `evalHarnessDigest` names the exact frozen bytes
// (each arm's name, mechanism and change source; every task id, split,
// prompt, file, verifier, long flag and resolved window; the verifier
// prelude, the window rule's source, the held-deps list and the frozen
// window and approval-mode defaults), so lane E's run proves it ran this
// set unchanged. Multi-edit
// (item 20) has no host seam to differ on — `edits[]` is always declared —
// so its pair is task-level: the frozen multi-edit tasks below, each-capable
// proof that one `edits[]` call and repeated single edits both fix them.

import { createHash } from 'node:crypto'
import type { ResponseAttemptGuard } from '../backends/modelapi/transport'
import { CONSERVATIVE_CAPABILITIES } from '../providers/capabilities'
import { FORMAT_QUIRKS } from '../providers/presets'
import {
  EVAL_APPROVAL_MODE,
  MODEL_API_CONTEXT_WINDOW,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
} from '../../shared/constants'
import { EVAL_HELD_DEPS } from './driver'
import type { EvalArm } from './runner'
import { EVAL_TASKS, EVAL_VERIFY_PRELUDE, evalWindowTokens } from './tasks'

/** The paired run's control: the harness as it ships, changed in nothing. */
export const BASELINE_ARM: EvalArm = { name: 'baseline' }

/**
 * Observation packing (M73): the eval host packs as the shipped host does
 * with the setting on. A tool result over the threshold rides whole for its
 * first requests, then as a placeholder the model pages back with
 * `recall_output`.
 */
export const OBSERVATION_PACKING_ARM: EvalArm = {
  name: 'packing',
  mechanism: `observation packing (M73): a tool result over ${String(OBS_PACK_THRESHOLD_CHARS)} characters rides whole for ${String(OBS_PACK_WHOLE_SENDS)} requests, then as a placeholder with its id, size and first and last lines; recall_output pages the original back`,
  change: (deps) => ({ ...deps, observationPacking: () => true }),
}

/**
 * Automatic compaction (M74): the eval host admits automatic compaction as
 * evaluated, prices the summary from the catalogue card and settles every
 * extra attempt through an evaluation admission that admits and settles
 * without charge. The window it compacts under is harness condition, not
 * part of this mechanism (M101 R2): the driver holds the same window on
 * both arms of the pair, so the pair isolates compaction alone — a window
 * override here would also move file-read truncation. Lane E's counted run
 * replaces the admission with the real shared D78 guard and ledger; test
 * doubles here cannot certify that integration.
 */
export const AUTO_COMPACTION_ARM: EvalArm = {
  name: 'auto-compaction',
  mechanism:
    'automatic compaction (M74): the eval host compacts at a settled tool boundary as evaluated, with an evaluation admission that admits and settles every extra attempt without charge',
  change: (deps) => ({
    ...deps,
    autoCompaction: () => true,
    autoCompactionEvaluated: () => true,
    admitAutoCompaction: () => {
      const guard: ResponseAttemptGuard = Object.assign(noop, {})
      return Promise.resolve({ guard, settle: noop })
    },
  }),
}

/**
 * Strict tool schemas (M101 item 24): the eval host declares the strict
 * subset as the shipped host does for a capable selected model. The
 * baseline declares the same tools non-strict.
 */
export const STRICT_TOOLS_ARM: EvalArm = {
  name: 'strict-tools',
  mechanism: 'M101 strict-subset schemas for a capable selected model',
  change: (deps) => ({
    ...deps,
    modelFacts: () => ({
      capabilities: { ...CONSERVATIVE_CAPABILITIES, supportsStrictTools: true },
      quirks: FORMAT_QUIRKS.responses,
    }),
  }),
}

/** A void callback for the evaluation admission: it admits and settles without charge. */
function noop(): void {
  // The admission's work is the allowance itself; nothing is tallied here.
}

/** The frozen arms, in run order: the control first, then one mechanism each. */
export const EVAL_ARMS: readonly [EvalArm, ...EvalArm[]] = [
  BASELINE_ARM,
  OBSERVATION_PACKING_ARM,
  AUTO_COMPACTION_ARM,
  STRICT_TOOLS_ARM,
]

/**
 * The frozen harness in one hash: every arm's name, mechanism and change
 * source with every task's id, split, title, prompt, files, verifier, long
 * flags and resolved window, in run order, beside the harness conditions
 * that decide a run's behaviour (the verifier prelude, the window rule's
 * source, the held-deps list and the frozen window and approval-mode
 * defaults). A run records it beside its report; a changed harness hashes
 * differently, so no counted run can silently run a different set. A
 * behaviour change that keeps every name and description (flipping the
 * arm's latch, narrowing strict tools, shrinking the window) still moves
 * this digest through the change source, the prelude, the rule source or
 * the resolved values.
 */
export function evalHarnessDigest(): string {
  const canonical = JSON.stringify({
    arms: EVAL_ARMS.map((arm) => ({
      name: arm.name,
      mechanism: arm.mechanism ?? null,
      change: arm.change?.toString() ?? null,
    })),
    tasks: EVAL_TASKS.map((task) => ({
      id: task.id,
      split: task.split,
      title: task.title,
      prompt: task.prompt,
      files: task.files,
      verify: task.verify,
      isLongOutput: task.isLongOutput ?? false,
      isLongContext: task.isLongContext ?? false,
      windowTokens: evalWindowTokens(task) ?? null,
    })),
    harness: {
      prelude: EVAL_VERIFY_PRELUDE,
      windowRule: evalWindowTokens.toString(),
      heldDeps: [...EVAL_HELD_DEPS],
      defaultWindowTokens: MODEL_API_CONTEXT_WINDOW,
      approvalMode: EVAL_APPROVAL_MODE,
    },
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
