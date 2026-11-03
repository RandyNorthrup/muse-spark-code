// The RLF-PINNED paired evaluation, live: automatic compaction as today
// against automatic compaction with verbatim constraint pinning, on the
// four side-constraint tasks and the two long-context tasks, at the same
// harness window on both arms. The report's per-split summaries carry the
// constraint-kept rate (each side-constraint verifier asserts its stated
// rule, so a pass kept the constraint through compaction); the ship
// verdict is read off that receipt by the fixed rule in
// docs/certification/h-constraint-pin.md, never by this file's pass/fail
// alone — this run only refuses to count as evidence when its pinned arm
// never compacted.
//
// Opt-in only, never in CI: it bills the owner's Model API key on the
// contributor model. It runs when MUSE_LIVE_PINNED_EVAL=1, reading the
// ACP agent's existing operating system credential entry in this process,
// exactly as the M75 live run does; the key is never printed, written, or
// handed to a shell command or a verifier, and the run checks that no log
// line, task folder or report holds it. Worst case, stated before the
// run: 6 tasks × 2 arms at the long-context call budget of 14, plus at
// most 12 summary attempts — 180 model attempts; MUSE_EVAL_MAX_ATTEMPTS
// is the wire's hard ceiling for the run.
//
//   MUSE_EVAL_REPORT      a path without extension for .json and .md
//   MUSE_EVAL_MAX_ATTEMPTS the run's hard call ceiling

import { describe, expect, it } from 'vitest'
import {
  assertEvalHarnessDigest,
  AUTO_COMPACTION_ARM,
  AUTO_COMPACTION_PINNED_ARM,
  freezeEvalHarness,
  PINNED_EVAL_ARMS,
} from '../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../src/core/eval/tasks'
import { EVAL_REPORT_VERSION } from '../../src/shared/constants'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  liveEvalLog,
  loadEvalLiveCredentials,
  publishLiveEvalReport,
  runLivePairedEval,
  withCompactionEngagement,
} from './evalLiveSupport'

const IS_ENABLED = process.env['MUSE_LIVE_PINNED_EVAL'] === '1'
assertNoLiveKeyEnvironment(process.env, IS_ENABLED)

// Room beyond each run's own limits for the harness to start and stop.
const RUN_MARGIN_MS = 60_000

/** The pair's fixed set: the side-constraint tasks and the two long-context ones. */
const PAIR_TASKS = EVAL_TASKS.filter(
  (task) =>
    task.isSideConstraint === true ||
    task.id === 'accept-long-compaction' ||
    task.id === 'heldout-long-compaction',
)

function maxAttemptsOf(): number | undefined {
  const ceiling = process.env['MUSE_EVAL_MAX_ATTEMPTS']
  if (ceiling === undefined) return undefined
  const maxAttempts = Number(ceiling)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('MUSE_EVAL_MAX_ATTEMPTS must be a positive integer.')
  }
  return maxAttempts
}

describe.skipIf(!IS_ENABLED)(
  'live pinned-constraint paired evaluation (MUSE_LIVE_PINNED_EVAL=1)',
  () => {
    it(
      'runs the six tasks on both arms of the pair and records the report',
      async () => {
        expect(PAIR_TASKS).toHaveLength(6)
        const maxAttempts = maxAttemptsOf()
        const reportPath = process.env['MUSE_EVAL_REPORT']
        const certified = freezeEvalHarness()
        const certifiedDigest = assertEvalHarnessDigest(undefined, certified)
        const frozenHarness = freezeEvalHarness(PINNED_EVAL_ARMS, PAIR_TASKS)
        const credentials = await loadEvalLiveCredentials(IS_ENABLED)
        const { logged, log } = liveEvalLog()
        const { result, leaks } = await runLivePairedEval({
          tasks: PAIR_TASKS,
          arms: PINNED_EVAL_ARMS,
          frozenHarness,
          credentials,
          log,
          maxAttempts,
          storagePrefix: 'muse-pinned-eval-storage-',
        })
        // The pinned arm must have compacted on every long-context task it
        // ran, or the pair proves nothing about pinning past compaction.
        const report = {
          ...withCompactionEngagement(
            result,
            AUTO_COMPACTION_PINNED_ARM.name,
            AUTO_COMPACTION_ARM.name,
            PAIR_TASKS,
          ),
          certifiedDigest,
          computedDigest: certifiedDigest,
        }
        leaks.push(...(await publishLiveEvalReport({ report, credentials, logged, reportPath })))
        expect(leaks).toEqual([])
        expect(
          report.version === EVAL_REPORT_VERSION
            ? report.compactionEngagement?.unengaged
            : undefined,
        ).toEqual([])
        // Both arms report a constraint-kept rate per split: the receipt the
        // ship rule reads, whichever way it falls.
        for (const arm of report.arms) {
          for (const summary of arm.summaries) {
            expect(summary.constraintTasks).toBe(2)
            expect(summary.constraintKeptRate).toBeDefined()
          }
        }
      },
      evalRunTimeoutMs(PAIR_TASKS.length, PINNED_EVAL_ARMS.length, RUN_MARGIN_MS),
    )
  },
)
