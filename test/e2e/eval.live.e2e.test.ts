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
// the same way, with an empty environment. Neither is a sandbox. Run
// `npm run build:dev` first: the search tool's worker is the built one.
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

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { format, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'
import {
  formatEvalReportJson,
  formatEvalReportMarkdown,
  type EvalReport,
} from '../../src/core/eval/report'
import {
  assertEvalHarnessDigest,
  AUTO_COMPACTION_ARM,
  BASELINE_ARM,
  EVAL_ARMS,
  OBSERVATION_PACKING_ARM,
} from '../../src/core/eval/mechanisms'
import { runPairedEval } from '../../src/core/eval/runner'
import { EVAL_TASKS } from '../../src/core/eval/tasks'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { createLogger } from '../../src/host/logger'
import { liveFetch } from '../../src/host/networkPosture'
import {
  EVAL_REPORT_VERSION,
  MODEL_API_BASE_URL,
  SEARCH_WORKER_FILE,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { readJobSource } from '../unit/helpers/jobSource'
import { logLines } from '../unit/helpers/logText'
import { filesUnder, removeFolder } from '../unit/helpers/temporaryFolders'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  liveEvalSelection,
  liveToolIo,
  loadEvalLiveCredentials,
  withCompactionEngagement,
  withPackingEngagement,
} from './evalLiveSupport'

const IS_ENABLED = process.env['MUSE_LIVE_MODEL_API'] === '1'
assertNoLiveKeyEnvironment(process.env, IS_ENABLED)

const SEARCH_WORKER = path.join(process.cwd(), 'dist', SEARCH_WORKER_FILE)
// Room beyond each run's own limits for the harness to start and stop.
const RUN_MARGIN_MS = 60_000

async function writeReport(result: EvalReport, target: string): Promise<void> {
  mkdirSync(path.dirname(target), { recursive: true })
  for (const [extension, parser, text] of [
    ['.json', 'json', formatEvalReportJson(result)],
    ['.md', 'markdown', formatEvalReportMarkdown(result)],
  ] as const) {
    const file = `${target}${extension}`
    const options = (await resolveConfig(file)) ?? {}
    writeFileSync(file, await format(text, { ...options, parser }))
  }
}

describe.skipIf(!IS_ENABLED)('live paired evaluation (MUSE_LIVE_MODEL_API=1)', () => {
  // The four frozen arms, in run order: the control first, then one mechanism each.
  const arms = EVAL_ARMS

  it(
    'runs the task set on the contributor model and records the report',
    async () => {
      const { tasks, reportPath, maxAttempts } = liveEvalSelection(process.env, IS_ENABLED)
      expect(existsSync(SEARCH_WORKER) ? 'built' : 'run npm run build:dev first').toBe('built')
      const certifiedDigest = assertEvalHarnessDigest()
      const credentials = await loadEvalLiveCredentials(IS_ENABLED)
      const channel = new FakeLogOutputChannel()
      const log = createLogger(channel)
      const leaks: string[] = []
      // Each Windows command in a job object of its own (M27), as in activate;
      // the helper is compiled once for the run, outside every task's folder.
      const storage = mkdtempSync(path.join(tmpdir(), 'muse-eval-storage-'))
      const jobAssembly =
        process.platform === 'win32'
          ? shellJobAssembly({
              readJobSource,
              storageDir: storage,
              systemRoot: process.env['SystemRoot'] ?? '',
              log: (message) => {
                log.warn(message)
              },
            })
          : undefined
      let result: EvalReport
      try {
        result = await runPairedEval(tasks, arms, {
          fetch: liveFetch,
          client: {
            baseUrl: MODEL_API_BASE_URL,
            apiKey: credentials.apiKey,
            sleep: (ms) => delay(ms),
            now: Date.now,
            random: Math.random,
            log,
          },
          toolIo: (workspace) =>
            liveToolIo({
              workspace,
              env: () => process.env,
              searchWorkerPath: SEARCH_WORKER,
              log: (message) => {
                log.warn(message)
              },
              shellJobAssembly: jobAssembly,
            }),
          contextIo: fileContextIo,
          platform: process.platform,
          accountId: credentials.accountId,
          log,
          now: Date.now,
          newId: () => randomUUID(),
          generatedAt: new Date().toISOString(),
          ...(maxAttempts !== undefined && { maxAttempts }),
          inspect: (root) => {
            for (const file of filesUnder(root)) {
              if (credentials.contains(readFileSync(file))) {
                leaks.push(path.relative(root, file))
              }
            }
            return Promise.resolve()
          },
        })
      } finally {
        await removeFolder(storage)
      }
      // Both mechanisms' acceptances go into the report before it is
      // printed or written, so neither artifact says pass for a run whose
      // packing arm never packed or whose auto-compaction arm never
      // compacted.
      const report = {
        ...withCompactionEngagement(
          withPackingEngagement(result, OBSERVATION_PACKING_ARM.name, tasks),
          AUTO_COMPACTION_ARM.name,
          BASELINE_ARM.name,
          tasks,
        ),
        certifiedDigest,
        computedDigest: certifiedDigest,
      }
      const markdown = formatEvalReportMarkdown(report)
      if (logLines(channel).some((line) => credentials.contains(line))) {
        leaks.push('the log')
      }
      if (credentials.contains(`${formatEvalReportJson(report)}${markdown}`)) {
        leaks.push('the report')
      }
      expect(leaks).toEqual([])
      process.stderr.write(`${credentials.redact(markdown)}\n`)
      if (reportPath !== undefined) {
        await writeReport(report, path.resolve(reportPath))
      }
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
    },
    // The selection is read inside the test, so the deadline allows the
    // whole task set: a run of fewer tasks ends sooner.
    evalRunTimeoutMs(EVAL_TASKS.length, arms.length, RUN_MARGIN_MS),
  )
})
