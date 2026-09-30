// The M75 paired evaluation, live (PLAN.md D49): the task set on the
// extension's own Model API harness (`runPairedEval` over a `ModelApiHost`)
// against Meta's real API, each task in a fresh temporary workspace holding
// only its fixture files, every model call on the contributor model. The
// trace counts each request sent; the verifier judges the files the turn
// left. The arms here are the baseline alone: M73 and M74 add their own arm
// with their runs (D49's "Measured first").
//
// Opt-in only, never in CI: it bills the owner's Model API key. It runs
// when MUSE_LIVE_MODEL_API=1 with the key in MUSE_LIVE_MODEL_API_KEY, which
// is taken out of the environment when this file loads, so neither a shell
// command the model runs nor a verifier inherits it; the key is never
// printed or written, and the run checks that no log line, task folder or
// report holds it. A shell command the model runs is allowed once, in the
// task's folder, as the owner's user, as in the sweep; the verifier runs
// the code the model wrote the same way, with an empty environment. Neither
// is a sandbox. Run `npm run build:dev` first: the search tool's worker is
// the built one.
//
//   MUSE_EVAL_TASKS   comma-separated task ids; every task when unset
//   MUSE_EVAL_REPORT  a path without extension: the report goes to
//                     <path>.json and <path>.md, prettier-formatted; the
//                     Markdown is printed either way

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { format, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  formatEvalReportJson,
  formatEvalReportMarkdown,
  type EvalReport,
} from '../../src/core/eval/report'
import { runPairedEval } from '../../src/core/eval/runner'
import { EVAL_TASKS, type EvalTask } from '../../src/core/eval/tasks'
import { listWorkspaceFiles } from '../../src/core/eval/workspace'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { createToolIo } from '../../src/host/backend/toolIo'
import { createLogger } from '../../src/host/logger'
import { liveFetch } from '../../src/host/networkPosture'
import {
  EVAL_TURN_TIMEOUT_MS,
  EVAL_VERIFY_TIMEOUT_MS,
  MODEL_API_BASE_URL,
  SEARCH_WORKER_FILE,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { readJobSource } from '../unit/helpers/jobSource'
import { logLines } from '../unit/helpers/logText'
import { filesUnder, removeFolder } from '../unit/helpers/temporaryFolders'

const IS_ENABLED = process.env['MUSE_LIVE_MODEL_API'] === '1'
const KEY_VARIABLE = 'MUSE_LIVE_MODEL_API_KEY'
const LIVE_KEY = process.env[KEY_VARIABLE] ?? ''
// Nothing this file starts inherits the key (AGENTS.md rule 8).
Reflect.deleteProperty(process.env, KEY_VARIABLE)

const selectionSchema = z.object({
  MUSE_EVAL_TASKS: z.optional(z.string()),
  MUSE_EVAL_REPORT: z.optional(z.string()),
})
const selection = selectionSchema.parse({
  MUSE_EVAL_TASKS: process.env['MUSE_EVAL_TASKS'],
  MUSE_EVAL_REPORT: process.env['MUSE_EVAL_REPORT'],
})
const SEARCH_WORKER = path.join(process.cwd(), 'dist', SEARCH_WORKER_FILE)
// Room beyond each run's own limits for the harness to start and stop.
const RUN_MARGIN_MS = 60_000

/** The tasks MUSE_EVAL_TASKS names, in task-set order; an unknown id stops the run. */
function selectedTasks(): readonly EvalTask[] {
  const wanted = (selection.MUSE_EVAL_TASKS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const unknown = wanted.filter((id) => EVAL_TASKS.every((task) => task.id !== id))
  if (unknown.length > 0) {
    throw new Error(`unknown eval tasks: ${unknown.join(', ')}`)
  }
  return wanted.length === 0 ? EVAL_TASKS : EVAL_TASKS.filter((task) => wanted.includes(task.id))
}

/** Anything this file prints goes through here: the key never reaches the output. */
function report(text: string): void {
  process.stderr.write(`${LIVE_KEY === '' ? text : text.replaceAll(LIVE_KEY, '[key]')}\n`)
}

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
  const tasks = selectedTasks()

  it(
    'runs the task set on the contributor model and records the report',
    async () => {
      expect(LIVE_KEY === '' ? 'no key in the environment' : 'key present').toBe('key present')
      expect(existsSync(SEARCH_WORKER) ? 'built' : 'run npm run build:dev first').toBe('built')
      const channel = new FakeLogOutputChannel()
      const log = createLogger(channel)
      const leaks: string[] = []
      const needle = Buffer.from(LIVE_KEY)
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
        result = await runPairedEval(tasks, [{ name: 'baseline' }], {
          fetch: liveFetch,
          client: {
            baseUrl: MODEL_API_BASE_URL,
            apiKey: () => Promise.resolve(LIVE_KEY),
            sleep: (ms) => delay(ms),
            now: Date.now,
            random: Math.random,
            log,
          },
          toolIo: (workspace) =>
            createToolIo({
              platform: process.platform,
              listFiles: () => listWorkspaceFiles(workspace),
              systemRoot: process.env['SystemRoot'],
              env: () => process.env,
              searchWorkerPath: SEARCH_WORKER,
              log: (message) => {
                log.warn(message)
              },
              unsavedFiles: () => [],
              shellJobAssembly: jobAssembly,
            }),
          contextIo: fileContextIo,
          platform: process.platform,
          accountId: createHash('sha256').update(LIVE_KEY).digest('hex'),
          log,
          now: Date.now,
          newId: () => randomUUID(),
          generatedAt: new Date().toISOString(),
          inspect: (root) => {
            for (const file of filesUnder(root)) {
              if (readFileSync(file).includes(needle)) {
                leaks.push(path.relative(root, file))
              }
            }
            return Promise.resolve()
          },
        })
      } finally {
        await removeFolder(storage)
      }
      const markdown = formatEvalReportMarkdown(result)
      if (logLines(channel).some((line) => line.includes(LIVE_KEY))) {
        leaks.push('the log')
      }
      if (`${formatEvalReportJson(result)}${markdown}`.includes(LIVE_KEY)) {
        leaks.push('the report')
      }
      expect(leaks).toEqual([])
      report(markdown)
      if (selection.MUSE_EVAL_REPORT !== undefined) {
        await writeReport(result, path.resolve(selection.MUSE_EVAL_REPORT))
      }
      expect(result.verdict).not.toBe('fail')
    },
    tasks.length * (EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS) + RUN_MARGIN_MS,
  )
})
