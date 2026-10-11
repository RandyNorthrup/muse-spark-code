// Frozen M75 arms (PLAN.md M101): each pure program runs only inside the
// restricted child. Adapter and harness conditions are declared fixtures;
// production code under test remains outside the freeze.

import { createHash } from 'node:crypto'
import { MissingEvalAdmissionError } from '../paid/paidConsent'
import {
  EVAL_APPROVAL_MODE,
  MODEL_API_CONTEXT_WINDOW,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
} from '../../shared/constants'
import { buildSync } from 'esbuild'
import pin from './frozen.json'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  armRepoRoot,
  buildArmBundle,
  canonicalize,
  executeArmBundle,
  type ArmBundle,
  type ArmFixture,
} from './armSources'
import type { EvalHostChange } from './driver'
import { EVAL_HELD_DEPS } from './heldDeps'
import type { EvalArm } from './runner'
import { EVAL_TASKS, EVAL_VERIFY_PRELUDE, evalWindowTokens, type EvalTask } from './tasks'

const ARM_PROGRAM = 'src/core/eval/armDefinitions.ts'

/** The paired run's control: the harness as it ships, changed in nothing. */
export const BASELINE_ARM: EvalArm = { name: 'baseline', program: ARM_PROGRAM }

/**
 * Observation packing (M73): the eval host packs as the shipped host does
 * with the setting on. A tool result over the threshold rides whole for its
 * first requests, then as a placeholder the model pages back with
 * `recall_output`.
 */
export const OBSERVATION_PACKING_ARM: EvalArm = {
  name: 'packing',
  mechanism: `observation packing (M73): a tool result over ${String(OBS_PACK_THRESHOLD_CHARS)} characters rides whole for ${String(OBS_PACK_WHOLE_SENDS)} requests, then as a placeholder with its id, size and first and last lines; recall_output pages the original back`,
  program: ARM_PROGRAM,
  change: frozenChange('packing'),
}

/**
 * Automatic compaction (M74): the eval host admits automatic compaction as
 * evaluated, prices the summary from the catalogue card and settles every
 * extra attempt through the real shared D78 admission and the run's own
 * ledger, both bound by the parent (lane E). The window it compacts under
 * is harness condition, not part of this mechanism (M101 R2): the driver
 * holds the same window on both arms of the pair, so the pair isolates
 * compaction alone — a window override here would also move file-read
 * truncation.
 */
export const AUTO_COMPACTION_ARM: EvalArm = {
  name: 'auto-compaction',
  mechanism:
    'automatic compaction (M74): the eval host compacts at a settled tool boundary as evaluated, with an evaluation admission that reserves every extra attempt against the run budget and settles it there',
  program: ARM_PROGRAM,
  change: frozenChange('auto-compaction'),
}

/**
 * Strict tool schemas (M101 item 24): the eval host declares the strict
 * subset as the shipped host does for a capable selected model. The
 * baseline declares the same tools non-strict.
 */
export const STRICT_TOOLS_ARM: EvalArm = {
  name: 'strict-tools',
  mechanism: 'M101 strict-subset schemas for a capable selected model',
  program: ARM_PROGRAM,
  change: frozenChange('strict-tools'),
}

/** The frozen arms, in run order: the control first, then one mechanism each. */
export const EVAL_ARMS: readonly [EvalArm, ...EvalArm[]] = [
  BASELINE_ARM,
  OBSERVATION_PACKING_ARM,
  AUTO_COMPACTION_ARM,
  STRICT_TOOLS_ARM,
]

/** The only host options a frozen program may return; held dependencies are unrepresentable. */
const armOptionsSchema = z.strictObject({
  name: z.string(),
  observationPacking: z.optional(z.boolean()),
  autoCompaction: z.optional(z.boolean()),
  autoCompactionEvaluated: z.optional(z.boolean()),
  evaluationAdmission: z.optional(z.boolean()),
  modelFacts: z.optional(
    z.strictObject({
      capabilities: z.strictObject({
        toolCalling: z.boolean(),
        vision: z.boolean(),
        reasoning: z.boolean(),
        parallelToolCalls: z.boolean(),
        supportsStrictTools: z.optional(z.boolean()),
      }),
      quirks: z.strictObject({ cachedUsageFields: z.array(z.string()) }),
    }),
  ),
})

/** Execute the frozen snapshot, validate the child boundary, then adapt its data. */
export function frozenBundleChange(bundle: ArmBundle): EvalHostChange {
  const options = armOptionsSchema.parse(executeArmBundle(bundle))
  if (options.name !== bundle.name) throw new Error('the frozen arm returned a different name')
  return (deps) => ({
    ...deps,
    ...(options.observationPacking !== undefined && {
      observationPacking: () => options.observationPacking === true,
    }),
    ...(options.autoCompaction !== undefined && {
      autoCompaction: () => options.autoCompaction === true,
    }),
    ...(options.autoCompactionEvaluated !== undefined && {
      autoCompactionEvaluated: () => options.autoCompactionEvaluated === true,
    }),
    ...(options.evaluationAdmission === true && {
      // The frozen arm declares that it compacts; the spend authority is
      // the parent's real D78 admission, never a double built here. Without
      // one the arm fails closed with its reason, instead of compacting
      // for free or running uncompacted as if that were the mechanism
      // (the host rethrows this marker, so the turn fails).
      admitAutoCompaction: (request) => {
        const parent = deps.admitAutoCompaction
        if (parent === undefined)
          throw new MissingEvalAdmissionError(
            'the auto-compaction arm needs the evaluation admission its parent binds',
          )
        return parent(request)
      },
    }),
    ...(options.modelFacts !== undefined && { modelFacts: () => options.modelFacts }),
  })
}

/** Direct driver tests use the same restricted program; the paired runner owns its snapshot. */
function frozenChange(name: string): EvalHostChange {
  return (deps) =>
    frozenBundleChange(buildArmBundle(path.join(armRepoRoot(), ARM_PROGRAM), name))(deps)
}

export interface FrozenEvalHarness {
  readonly bundles: ReadonlyMap<string, ArmBundle>
  readonly sha256: string
  readonly sources: readonly string[]
}

/** The actual resolver graph, including the live verdict wrappers and launcher. */
export function evalHarnessSources(): string[] {
  const repo = armRepoRoot()
  const graph = buildSync({
    absWorkingDir: repo,
    entryPoints: [
      'test/e2e/eval.live.e2e.test.ts',
      'scripts/m101-e.mjs',
      ARM_PROGRAM,
      'src/host/backend/searchWorker.ts',
    ],
    outdir: 'eval-graph',
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'node',
    logLevel: 'silent',
  }).metafile
  // The expected digest is an output of the freeze, never its own input.
  // Lockfile and build recipe bind external packages and the search worker.
  return [
    ...new Set([
      ...Object.keys(graph.inputs).map((file) =>
        file.replaceAll('\\', '/').replace(/ with \{.*\}$/u, ''),
      ),
      'package-lock.json',
      'scripts/build.mjs',
    ]),
  ]
    .filter((file) => file !== 'src/core/eval/frozen.json')
    .toSorted((left, right) => Number(left > right) - Number(left < right))
}

/** Live launch and direct live-test execution refuse a mismatch before opening credentials. */
export function assertEvalHarnessDigest(expected: string = pin.sha256): string {
  const computed = evalHarnessDigest()
  if (computed !== expected)
    throw new Error(
      `Frozen harness mismatch: pinned ${expected}, computed ${computed}; no live call may run.`,
    )
  return computed
}

/** Freeze once before the run. Source adapters are explicit fixtures, never a discovered closure. */
export function freezeEvalHarness(
  arms: readonly EvalArm[] = EVAL_ARMS,
  tasks: readonly EvalTask[] = EVAL_TASKS,
): FrozenEvalHarness {
  const repo = armRepoRoot()
  const sources = evalHarnessSources()
  const sourceDigests = sources.map((file) => ({
    path: file,
    sha256: createHash('sha256')
      .update(readFileSync(path.join(repo, file), 'utf8').replaceAll('\r\n', '\n'), 'utf8')
      .digest('hex'),
  }))
  const fixtures: ArmFixture[] = ['armSources', 'mechanisms', 'runner', 'heldDeps', 'tasks'].map(
    (file) => ({
      path: `${file}.ts`,
      bytes: readFileSync(path.join(repo, 'src/core/eval', `${file}.ts`)),
    }),
  )
  const conditions = canonicalize(
    {
      tasks: tasks.map((task) => ({ ...task, windowTokens: evalWindowTokens(task) ?? null })),
      harness: {
        prelude: EVAL_VERIFY_PRELUDE,
        heldDeps: [...EVAL_HELD_DEPS],
        defaultWindowTokens: MODEL_API_CONTEXT_WINDOW,
        approvalMode: EVAL_APPROVAL_MODE,
      },
    },
    'evalHarnessDigest',
  )
  fixtures.push({ path: 'conditions.json', bytes: Buffer.from(JSON.stringify(conditions), 'utf8') })
  const bundles = new Map<string, ArmBundle>()
  for (const arm of arms) {
    const program =
      arm.program ??
      (arm.name === BASELINE_ARM.name && arm.change === undefined ? ARM_PROGRAM : undefined)
    if (program === undefined) continue // Unfrozen callbacks are fake-test seams; no frozen receipt.
    if (bundles.has(arm.name)) throw new Error(`repeated frozen evaluation arm: ${arm.name}`)
    bundles.set(arm.name, buildArmBundle(path.resolve(repo, program), arm.name, fixtures))
  }
  const receipt = arms.map((arm) => ({
    name: arm.name,
    mechanism: arm.mechanism ?? null,
    sha256: bundles.get(arm.name)?.sha256 ?? null,
  }))
  return {
    bundles,
    sources,
    sha256: createHash('sha256')
      .update(JSON.stringify({ receipt, sources: sourceDigests }), 'utf8')
      .digest('hex'),
  }
}

/** SHA-256 of exactly the bundle and declared fixture bytes the counted run executes. */
export function evalHarnessDigest(): string {
  return freezeEvalHarness().sha256
}
