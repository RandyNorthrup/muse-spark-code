#!/usr/bin/env node
// Lane E owns live receipts. This launcher never reads a credential; the
// opt-in live M75 test reads the existing OS entry in its own process.
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const mode = process.argv[2] ?? '--plan'
if (!['--plan', '--fake', '--live-m75'].includes(mode) || process.argv.length > 3) {
  throw new Error('Use --plan, --fake or --live-m75')
}
const plan = {
  model: 'muse-spark-1.3-contributor',
  liveAttemptsHere: 0,
  cacheProbe:
    'In an empty workspace, capture one /compact and one token-budgeted goal round, comparing instructions/tools/key and cached_tokens. About 4 calls; allow 8 for bounded retries/fallback and record every actual POST.',
  m75: '10 tasks × 2 arms (baseline/packing), typically 5–10 calls per task/arm: estimate 100–200 calls. Existing trace stops future sends at its $0.50 estimate or unknown usage; this is not a reservation theorem.',
  autoCompaction:
    'E must bind the explicit evaluation admission/settlement port and add its paired arm, prove it actually compacted, then capture overflow/cut-short frames. Estimate another 50–100 ordinary calls plus 1–2 summary calls per compaction, retries counted. Never flip the production latch from this launcher.',
  captures:
    'Record workspace, contributor model, every actual attempt, cached tokens, summary fallback, overflow kind and incomplete call status. Store sanitized captures and passing paired report in docs/certification/m101-e.md.',
}
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
if (mode === '--plan') process.exit(0)
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
          'test/unit/autoCompact.test.ts',
          'test/unit/modelApiAutoCompact.test.ts',
          'test/unit/modelApiOverflow.test.ts',
        ],
      ]
    : [['test/e2e/eval.live.e2e.test.ts']]
if (mode === '--live-m75')
  process.stderr.write(
    'OPT-IN LIVE M75: bills the existing OS-stored Model API key; subscription pays none. Read the printed estimate first.\n',
  )
for (const files of batches) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', ...files, '--maxWorkers=3', '--testTimeout=120000'],
    {
      stdio: 'inherit',
      env: { ...process.env, MUSE_LIVE_MODEL_API: mode === '--live-m75' ? '1' : '0' },
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
