// The M75 paired evaluation, live (PLAN.md D49): the task set on the
// extension's own Model API harness (`runPairedEval` over a `ModelApiHost`)
// against Meta's real API, each task in a fresh temporary workspace holding
// only its fixture files, every model call on the contributor model. The
// trace counts each request sent; the verifier judges the files the turn
// left. The arms are the four frozen ones (M101 lane E): the baseline,
// observation packing (M73), automatic compaction through the real shared
// D78 admission and the run's own ledger (M74), and strict tool schemas for
// a capable selected model (M101 item 24). A packing run must also have
// packed on every long-output task it ran, and the auto-compaction run
// must have compacted on every long-context task it ran, or the run proves
// nothing about that mechanism: each acceptance is recorded in the report,
// whose verdict it fails, before the report is printed or written.
//
// Opt-in only, never in CI: it bills the owner's Model API key. It runs
// when MUSE_LIVE_MODEL_API=1, reading the ACP agent's existing operating
// system credential entry in this process, inside the enabled test. The
// legacy key environment variable is refused when the run is enabled, never read or deleted. Neither
// a shell command the model runs nor a verifier receives the stored key; it is never
// printed or written, and the run checks that no log line, task folder or
// report holds it. A shell command the model runs is allowed once, in the
// task's folder, as the owner's user, as in the sweep, with the environment
// less every credential variable; the verifier runs the code the model wrote
// the same way, with an empty environment. Neither is a sandbox. The
// worker is freshly bundled from certified inputs before credentials.
// Run `node scripts/m101-e.mjs --plan` first: it prints the planned model
// calls and the hard call ceiling this run stops at.
//
//   MUSE_EVAL_TASKS   comma-separated task ids; every task when unset
//   MUSE_EVAL_REPORT  a path without extension: the report goes to
//                     <path>.json and <path>.md, prettier-formatted; the
//                     Markdown is printed either way
//   MUSE_EVAL_MAX_ATTEMPTS
//                     hard ceiling for model calls sent; the wire refuses
//                     past it. The lane E launcher sets it from its plan.
//
// All three are read inside the enabled test only (`liveEvalSelection`).

import { describe, expect, it } from 'vitest'
import {
  assertEvalHarnessDigest,
  freezeEvalHarness,
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
  STRICT_TOOLS_ARM,
} from '../../src/core/eval/mechanisms'
import { EVAL_TASKS } from '../../src/core/eval/tasks'
import { EVAL_REPORT_VERSION } from '../../src/shared/constants'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  liveEvalLog,
  liveEvalSelection,
  loadEvalLiveCredentials,
  publishLiveEvalReport,
  runLivePairedEval,
  withCompactionEngagement,
  withPackingEngagement,
  withStrictToolsEngagement,
} from './evalLiveSupport'

const IS_ENABLED = process.env['MUSE_LIVE_MODEL_API'] === '1'
assertNoLiveKeyEnvironment(process.env, IS_ENABLED)

// Room beyond each run's own limits for the harness to start and stop.
const RUN_MARGIN_MS = 60_000

describe.skipIf(!IS_ENABLED)('live paired evaluation (MUSE_LIVE_MODEL_API=1)', () => {
  // The four frozen arms, in run order: the control first, then one mechanism each.
  const arms = EVAL_ARMS

  it(
    'runs the task set on the contributor model and records the report',
    async () => {
      const { tasks, reportPath, maxAttempts } = liveEvalSelection(process.env, IS_ENABLED)
      const certified = freezeEvalHarness()
      const certifiedDigest = assertEvalHarnessDigest(undefined, certified)
      const frozenHarness =
        tasks.length === EVAL_TASKS.length ? certified : freezeEvalHarness(arms, tasks)
      const credentials = await loadEvalLiveCredentials(IS_ENABLED)
      const { logged, log } = liveEvalLog()
      const { result, leaks } = await runLivePairedEval({
        tasks,
        arms,
        frozenHarness,
        credentials,
        log,
        maxAttempts,
        storagePrefix: 'muse-eval-storage-',
      })
      // Every mechanism's acceptance goes into the report before it
      // is printed or written, so no artifact says pass for a run whose
      // packing arm never packed, whose auto-compaction arm never
      // compacted, or whose strict-tools arm never sent strict schemas.
      const report = {
        ...withStrictToolsEngagement(
          withCompactionEngagement(
            withPackingEngagement(result, OBSERVATION_PACKING_ARM.name, tasks),
            AUTO_COMPACTION_ARM.name,
            BASELINE_ARM.name,
            tasks,
          ),
          STRICT_TOOLS_ARM.name,
          tasks,
        ),
        certifiedDigest,
        computedDigest: certifiedDigest,
      }
      leaks.push(...(await publishLiveEvalReport({ report, credentials, logged, reportPath })))
      expect(leaks).toEqual([])
      // Only `pass` counts: a narrowed selection is `incomplete` (R2),
      // and a truncated run stops `incomplete` too — neither may arm the latch.
      const isSmoke = process.env['MUSE_EVAL_SMOKE'] === '1'
      expect(report.verdict).toBe(isSmoke ? 'incomplete' : 'pass')
      if (isSmoke) {
        expect(
          report.version === EVAL_REPORT_VERSION ? report.incompleteReasons : undefined,
        ).toContain('narrowed selection')
        expect(
          report.version === EVAL_REPORT_VERSION ? report.stoppedEarly : undefined,
        ).toBeUndefined()
        expect(report.arms.every((arm) => arm.results.every((task) => task.passed))).toBe(true)
        return
      }
      expect(
        report.version === EVAL_REPORT_VERSION ? report.packingEngagement?.unengaged : undefined,
      ).toEqual([])
      expect(
        report.version === EVAL_REPORT_VERSION ? report.compactionEngagement?.unengaged : undefined,
      ).toEqual([])
      expect(
        report.version === EVAL_REPORT_VERSION
          ? report.strictToolsEngagement?.unengaged
          : undefined,
      ).toEqual([])
    },
    // The selection is read inside the test, so the deadline allows the
    // whole task set: a run of fewer tasks ends sooner.
    evalRunTimeoutMs(EVAL_TASKS.length, arms.length, RUN_MARGIN_MS),
  )
})
