#!/usr/bin/env node
// M101 lane E launcher (C-M101-3, part A). This launcher never reads a
// credential and never carries one: the opt-in live run reads the ACP
// agent's existing operating system credential entry in its own process
// (test/e2e/evalLiveSupport.ts), and a key reaches that store only through
// `muse-spark-code-acp auth set`, from standard input. No key comes from
// arguments, the environment or a file; the legacy key variable is refused
// by the enabled test, never read or deleted. Standard input here is only
// inherited, never parsed for secrets.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import frozenPlan from '../src/core/eval/plan.json' with { type: 'json' }
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Each task/arm owns an independent measured allowance. The global ceiling
// is their sum, only a backstop; local overruns fail their task and continue.

function planFor(selection = '') {
  const wanted = selection
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const unknown = wanted.filter((id) => frozenPlan.tasks.every((task) => task.id !== id))
  if (unknown.length > 0) throw new Error(`unknown eval tasks: ${unknown.join(', ')}`)
  const tasks = frozenPlan.tasks.filter((task) => wanted.length === 0 || wanted.includes(task.id))
  const plannedCalls = tasks.reduce(
    (sum, task) => sum + task.callBudget * frozenPlan.arms.length,
    0,
  )
  return {
    ...frozenPlan,
    tasks,
    plannedCalls,
    callCeiling: plannedCalls,
    measuredCostEstimateUsd:
      (plannedCalls * frozenPlan.measurement.costUsd) / frozenPlan.measurement.attempts,
    liveAttemptsHere: 0,
    selection: tasks.length === frozenPlan.tasks.length ? 'full frozen set' : 'narrowed selection',
    accounting:
      'An independent call budget per task/arm; local overrun fails the task and continues. Global ceiling, $0.50 spend or unknown usage stops are incomplete. The measured average-cost projection is not a reservation theorem.',
    engagement:
      'Both packing tasks must pack; both compaction tasks must replace history with an accepted summary whose admission settled. Every arm must hold both 0.75 floors. A narrowed selection is incomplete.',
  }
}

/** Execute only the reviewed freeze adapter, offline; no arm source executes in this process. */
function digestOffline(isChecking = false) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const scratch = mkdtempSync(path.join(tmpdir(), 'm101-freeze-'))
  try {
    const target = path.join(scratch, 'freeze.cjs')
    const built = buildSync({
      entryPoints: [path.join(root, 'src/core/eval/mechanisms.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      external: ['esbuild'],
      banner: {
        js: `var require = require('node:module').createRequire(${JSON.stringify(import.meta.url)});`,
      },
    })
    const output = built.outputFiles[0]
    if (output === undefined) throw new Error('The freeze adapter emitted no code.')
    writeFileSync(target, output.contents)
    const adapter = createRequire(import.meta.url)(target)
    const digest = isChecking ? adapter.assertEvalHarnessDigest() : adapter.evalHarnessDigest()
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error('The freeze adapter returned an invalid digest.')
    return digest
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function main() {
  const mode = process.argv[2] ?? '--plan'
  if (
    !['--plan', '--fake', '--live-m75', '--smoke-m75', '--freeze', '--check-freeze'].includes(
      mode,
    ) ||
    process.argv.length > 3
  ) {
    throw new Error('Use --plan, --fake, --live-m75, --smoke-m75, --freeze or --check-freeze')
  }
  if (mode === '--check-freeze') {
    process.stdout.write(`${digestOffline(true)}\n`)
    return
  }
  if (mode === '--freeze') {
    const sha256 = digestOffline()
    writeFileSync(
      new URL('../src/core/eval/frozen.json', import.meta.url),
      `${JSON.stringify({ sha256 }, null, 2)}\n`,
    )
    process.stdout.write(`${sha256}\n`)
    return
  }
  const isSmoke = mode === '--smoke-m75'
  const selection = process.env['MUSE_EVAL_TASKS'] ?? (isSmoke ? 'accept-off-by-one' : undefined)
  const plan = planFor(selection)
  // The plan prints BEFORE anything sends, in every mode.
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  if (mode === '--plan') process.exit(0)
  // At most three files per batch: RAM is shared with other lanes' runs.
  const batches =
    mode === '--fake'
      ? [
          [
            'test/unit/modelApiGoldenRequests.test.ts',
            'test/unit/metaRequestGoldens.test.ts',
            'test/unit/modelApiPrefix.test.ts',
          ],
          [
            'test/unit/eval/evalRunner.test.ts',
            'test/unit/eval/evalDriver.test.ts',
            'test/unit/eval/evalPacking.test.ts',
          ],
          [
            'test/unit/eval/evalFrozen.test.ts',
            'test/unit/eval/evalAdmission.test.ts',
            'test/unit/eval/evalPlan.test.ts',
          ],
          [
            'test/unit/eval/evalLiveSupport.test.ts',
            'test/unit/eval/evalReport.test.ts',
            'test/unit/eval/evalCompaction.test.ts',
          ],
          [
            'test/unit/autoCompact.test.ts',
            'test/unit/autoCompactionAdmission.test.ts',
            'test/unit/modelApiAutoCompact.test.ts',
          ],
          [
            'test/unit/eval/evalArmSources.test.ts',
            'test/unit/eval/evalTasks.test.ts',
            'test/unit/eval/evalWorkspacePrivacy.test.ts',
          ],
          ['test/unit/eval/evalMultiEdit.test.ts', 'test/unit/eval/evalWire.test.ts'],
          ['test/unit/modelApiOverflow.test.ts'],
        ]
      : [['test/e2e/eval.live.e2e.test.ts']]
  const allowedEnvironment = new Set(frozenPlan.execution.environment)
  // Filter names before reading values: undeclared credential variables are never copied.
  const inheritedNames = Object.keys(process.env).filter((name) =>
    allowedEnvironment.has(name.toUpperCase()),
  )
  const env = Object.fromEntries(inheritedNames.map((name) => [name, process.env[name]]))
  if ((mode === '--live-m75' || isSmoke) && Object.hasOwn(process.env, 'MUSE_LIVE_MODEL_API_KEY'))
    throw new Error(
      'MUSE_LIVE_MODEL_API_KEY is not supported; use the operating system credential store.',
    )
  if (mode === '--live-m75' || isSmoke) {
    const computed = digestOffline(true)
    const pinned = JSON.parse(
      readFileSync(new URL('../src/core/eval/frozen.json', import.meta.url), 'utf8'),
    ).sha256
    if (computed !== pinned)
      throw new Error(
        `Frozen harness mismatch: pinned ${String(pinned)}, computed ${computed}; no live call may run.`,
      )
    process.stderr.write(`Frozen harness: pinned ${String(pinned)}, computed ${computed}\n`)
    process.stderr.write(
      'OPT-IN LIVE M75: bills the existing OS-stored Model API key; subscription pays none. The printed plan above is what it may send.\n',
    )
    // The ceiling is the printed plan, exactly: a pre-set value never
    // survives, so the JSON above cannot disagree with the run. The
    // enabled test refuses a non-positive-integer value without sending.
    env['MUSE_LIVE_MODEL_API'] = '1'
    if (selection !== undefined) env['MUSE_EVAL_TASKS'] = selection
    if (isSmoke) {
      if (plan.selection !== 'narrowed selection')
        throw new Error('Smoke mode requires a narrowed selection.')
      env['MUSE_EVAL_SMOKE'] = '1'
    } else {
      delete env['MUSE_EVAL_SMOKE']
    }
    env['MUSE_EVAL_MAX_ATTEMPTS'] = String(plan.callCeiling)
    if (env['MUSE_EVAL_TASKS'] !== undefined && env['MUSE_EVAL_TASKS'] !== '') {
      process.stderr.write(
        `Selection: ${env['MUSE_EVAL_TASKS'] ?? ''} — narrowed plan printed above; expected verdict incomplete (narrowed selection), never pass.\n`,
      )
    }
    // Scrubbed receipts beside the report: the run masks workspace paths,
    // scans every folder and both artifacts for the key before writing,
    // and fails instead of writing a receipt that holds it.
    env['MUSE_EVAL_REPORT'] ??= path.join(tmpdir(), 'm101-e', 'report')
    process.stderr.write(
      `Call ceiling: ${env['MUSE_EVAL_MAX_ATTEMPTS'] ?? ''} model calls. Receipts: ${env['MUSE_EVAL_REPORT'] ?? ''}.json/.md\n`,
    )
  } else {
    env['MUSE_LIVE_MODEL_API'] = '0'
  }
  // Repository timeouts throughout: a slow test is a bug, and hosted CI
  // runs the repo default, so this launcher never overrides them.
  for (const files of batches) {
    const result = spawnSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', ...frozenPlan.execution.arguments, ...files],
      { stdio: 'inherit', env },
    )
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

main()
