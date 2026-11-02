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

import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
  AUTO_COMPACTION_PINNED_ARM,
  freezeEvalHarness,
  PINNED_EVAL_ARMS,
} from '../../src/core/eval/mechanisms'
import { runPairedEval } from '../../src/core/eval/runner'
import { EVAL_TASKS } from '../../src/core/eval/tasks'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { liveFetch } from '../../src/host/networkPosture'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  EVAL_REPORT_VERSION,
  MODEL_API_BASE_URL,
  SEARCH_WORKER_FILE,
} from '../../src/shared/constants'
import { readJobSource } from '../unit/helpers/jobSource'
import { filesUnder, removeFolder } from '../unit/helpers/temporaryFolders'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  liveToolIo,
  loadEvalLiveCredentials,
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
        const logged: string[] = []
        const log = stderrLogger((line) => {
          logged.push(line)
        }, 'trace')
        const leaks: string[] = []
        const storage = mkdtempSync(path.join(tmpdir(), 'muse-pinned-eval-storage-'))
        const searchWorker = path.join(storage, SEARCH_WORKER_FILE)
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
          writeFileSync(searchWorker, frozenHarness.searchWorker.code)
          result = await runPairedEval(PAIR_TASKS, PINNED_EVAL_ARMS, {
            frozenHarness,
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
                searchWorkerPath: searchWorker,
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
        const markdown = formatEvalReportMarkdown(report)
        if (logged.some((line) => credentials.contains(line))) {
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
