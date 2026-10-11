#!/usr/bin/env node
// M101 lane E launcher (C-M101-3, part A). This launcher never reads a
// credential and never carries one: the opt-in live run reads the ACP
// agent's existing operating system credential entry in its own process
// (test/e2e/evalLiveSupport.ts), and a key reaches that store only through
// `muse-spark-code-acp auth set`, from standard input. No key comes from
// arguments, the environment or a file; the legacy key variable is refused
// by the enabled test, never read or deleted. Standard input here is only
// inherited, never parsed for secrets.
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

/**
 * The counted live evaluation's call plan (M101 lane E R2). Base attempts
 * come from the fake pairs (test/unit/eval/evalRunner.test.ts: fourteen
 * small tasks at three attempts on every arm, two long-context tasks at
 * three on every arm but auto-compaction's six — one summary round trip
 * each). The printed plan is EXACTLY what the run may send: no probe, no
 * extra round, no headroom. The hard ceiling equals the plan; the wire
 * refuses past it, and a run that would exceed it stops and is
 * `incomplete`, never a pass. test/unit/eval/evalPlan.test.ts pins every
 * count below against EVAL_TASKS and EVAL_ARMS, so the plan cannot drift
 * from the frozen task set.
 */
const M101_EVAL_PLAN = {
  model: 'muse-spark-1.3-contributor',
  tasks: { total: 16, small: 14, longContext: 2 },
  arms: [
    { name: 'baseline', smallAttempts: 3, longAttempts: 3 },
    { name: 'packing', smallAttempts: 3, longAttempts: 3 },
    { name: 'auto-compaction', smallAttempts: 3, longAttempts: 6 },
    { name: 'strict-tools', smallAttempts: 3, longAttempts: 3 },
  ],
  liveAttemptsHere: 0,
  budgetUsd: 0.5,
  /** Model calls the plan sends: exactly what the live run may send. */
  plannedCalls: 198,
  /** Hard ceiling enforced by the trace wire (MUSE_EVAL_MAX_ATTEMPTS): the plan, exactly. */
  callCeiling: 198,
  m75: '16 tasks × 4 arms (baseline/packing/auto-compaction/strict-tools): 198 calls from the fake pairs, and the ceiling is that plan exactly — no headroom, no probe. The wire refuses past it and the run stops incomplete; the trace also stops future sends at its $0.50 estimate or on unknown usage, stopping incomplete the same way. This is not a reservation theorem.',
  autoCompaction:
    'The auto-compaction arm admits through the real shared D78 gate and settles every extra attempt against the run budget (src/core/eval/driver.ts, runner.ts); the report records the settled-admission count per task and requires at least one settled admission on every long-context task of that arm, beside the floors. Never flips the production latch from this launcher.',
  captures:
    'Record workspace, contributor model, every actual attempt, cached tokens, the settled-admission count per task, per-task terminal and stopped-early reasons. Store sanitized captures and passing paired report in docs/certification/m101-e.md.',
}

function main() {
  const mode = process.argv[2] ?? '--plan'
  if (!['--plan', '--fake', '--live-m75'].includes(mode) || process.argv.length > 3) {
    throw new Error('Use --plan, --fake or --live-m75')
  }
  // The plan prints BEFORE anything sends, in every mode.
  process.stdout.write(`${JSON.stringify(M101_EVAL_PLAN, null, 2)}\n`)
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
          ['test/unit/modelApiOverflow.test.ts'],
        ]
      : [['test/e2e/eval.live.e2e.test.ts']]
  const env = { ...process.env }
  if (mode === '--live-m75') {
    process.stderr.write(
      'OPT-IN LIVE M75: bills the existing OS-stored Model API key; subscription pays none. The printed plan above is what it may send.\n',
    )
    // The ceiling is the printed plan, exactly: a pre-set value never
    // survives, so the JSON above cannot disagree with the run. The
    // enabled test refuses a non-positive-integer value without sending.
    env['MUSE_LIVE_MODEL_API'] = '1'
    env['MUSE_EVAL_MAX_ATTEMPTS'] = String(M101_EVAL_PLAN.callCeiling)
    if (env['MUSE_EVAL_TASKS'] !== undefined && env['MUSE_EVAL_TASKS'] !== '') {
      process.stderr.write(
        `Selection: ${env['MUSE_EVAL_TASKS'] ?? ''} — a narrowed selection sends fewer than the printed plan and cannot pass: no long-context task means verdict incomplete, and any missing split does too.\n`,
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
      ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=3'],
      { stdio: 'inherit', env },
    )
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

main()
