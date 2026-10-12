// Frozen M75 arms (PLAN.md M101): each pure program runs only inside the
// restricted child. Adapter and harness conditions are declared fixtures;
// The fixed parent and production system under test contribute source provenance
// without gaining any additional arm execution permissions.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  EVAL_APPROVAL_MODE,
  MODEL_API_CONTEXT_WINDOW,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
} from '../../shared/constants'
import { buildSync } from 'esbuild'
import pin from './frozen.json'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import plan from './plan.json'
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

const EVAL_ADMISSION_ERROR_NAME = 'MissingEvalAdmissionError'

/**
 * The frozen evaluation arm ran without the admission its parent binds.
 * Harness-only: the shipped bundles carry none of this marker (bundle
 * diet pin), so the turn's driver — not the product — owns the fail-closed
 * verdict below. The arm fails closed, never as a normal turn that proves
 * nothing (M101 lane E R2).
 */
export class MissingEvalAdmissionError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = EVAL_ADMISSION_ERROR_NAME
  }
}

/** The frozen arm and the driver may carry separate copies of the class. */
export function isMissingEvalAdmissionError(error: unknown): error is MissingEvalAdmissionError {
  return error instanceof Error && error.name === EVAL_ADMISSION_ERROR_NAME
}

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
      // (the turn's driver records this marker, so the turn fails).
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
  readonly selection: string
  /** Fresh self-contained executable, whose exact bytes the live worker runs. */
  readonly searchWorker: { readonly code: string; readonly sha256: string }
}

/** Read the runner's real exported configuration, not a parallel list of setup/alias roots. */
function runnerConfigFiles(repo: string): string[] {
  const file = path.join(repo, plan.execution.config)
  const config = buildSync({
    absWorkingDir: repo,
    entryPoints: [file],
    bundle: true,
    write: false,
    packages: 'external',
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(file).href) },
  }).outputFiles[0]
  if (config === undefined) throw new Error('the evaluation runner configuration emitted no code')
  const code = `const require = module.require('node:module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
${config.text}
const configValue = module.exports.default;
process.stdout.write(JSON.stringify([
  configValue.test?.setupFiles ?? [], configValue.test?.globalSetup ?? [],
  Object.values(configValue.resolve?.alias ?? {}).map(value => typeof value === 'string' ? value : value.replacement),
].flat(2)));`
  const value: unknown = JSON.parse(
    execFileSync(process.execPath, ['-e', code], {
      cwd: repo,
      env: {},
      encoding: 'utf8',
      windowsHide: true,
    }),
  )
  return z
    .array(z.string())
    .parse(value)
    .map((file) => path.resolve(repo, file))
}

/** Include each resolver input's nearest compiler configuration and its extends chain. */
function compilerFiles(repo: string, inputs: readonly string[]): string[] {
  const files = new Set<string>()
  const include = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    const parsed = ts.readConfigFile(file, (name) => readFileSync(name, 'utf8'))
    if (parsed.error !== undefined)
      throw new Error('the evaluation compiler configuration cannot be read')
    const data = z
      .object({ extends: z.optional(z.union([z.string(), z.array(z.string())])) })
      .parse(parsed.config)
    for (const parent of [data.extends ?? []].flat()) {
      if (!parent.startsWith('.'))
        throw new Error('the evaluation compiler configuration needs a local extends path')
      include(path.resolve(path.dirname(file), parent))
    }
  }
  const findConfig = (dir: string): void => {
    const relative = path.relative(repo, dir).replaceAll('\\', '/')
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return
    const file = path.join(dir, 'tsconfig.json')
    if (existsSync(file)) include(file)
    else {
      const parent = path.dirname(dir)
      if (parent !== dir) findConfig(parent)
    }
  }
  for (const input of inputs) findConfig(path.dirname(path.resolve(repo, input)))
  return [...files].map((file) => path.relative(repo, file).replaceAll('\\', '/'))
}

/**
 * The digest's path form (M101 R6): repository-relative forward slashes
 * on every platform. Git lists forward slashes; Windows checkouts,
 * metafiles and directory walks use backslashes.
 */
export function canonicalDigestPath(file: string): string {
  return file.replaceAll('\\', '/')
}

/**
 * The digest's byte form (M101 R6): the bytes Git stores are LF, but a
 * checkout may convert line endings, so CRLF pairs and any lone CR fold
 * to LF before hashing. LF bytes hash unchanged.
 */
export function canonicalDigestText(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/**
 * The digest's order (M101 R6): UTF-8 byte order, the same on every
 * platform and locale. UTF-16 code-unit comparison agrees with it on
 * ASCII but disagrees past the Basic Multilingual Plane, so the hashed
 * list never relies on it. Relation comparison itself is already
 * locale-independent; this makes it byte-explicit.
 */
export function compareDigestPath(left: string, right: string): number {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'))
}

export interface FrozenSourceEntry {
  readonly path: string
  readonly text: string
}

/**
 * The hashed source list from raw entries: canonical paths, canonical
 * bytes, byte order. Pure, so tests feed it CRLF and LF trees and
 * backslash paths directly.
 */
export function frozenSourceDigests(
  entries: readonly FrozenSourceEntry[],
): { path: string; sha256: string }[] {
  return entries
    .map((entry) => ({
      path: canonicalDigestPath(entry.path),
      sha256: createHash('sha256').update(canonicalDigestText(entry.text), 'utf8').digest('hex'),
    }))
    .toSorted((left, right) => compareDigestPath(left.path, right.path))
}

/**
 * The committed source family under `src/` (M101 R6): the digest covers
 * committed content only, so the working-tree walk is intersected with
 * the files Git tracks. Untracked scratch, editor backups and merge
 * leftovers never move the digest; a file the run actually loads stays
 * hashed through the resolver graph, tracked or not.
 */
export function trackedSourceFamily(repo: string): Set<string> {
  const listed = execFileSync('git', ['-C', repo, 'ls-files', '-z', 'src'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return new Set(
    listed
      .split('\0')
      .filter((file) => file !== '')
      .map((file) => canonicalDigestPath(file)),
  )
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
      'scripts/build.mjs',
      plan.execution.config,
      ...runnerConfigFiles(repo),
    ],
    outdir: 'eval-graph',
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  }).metafile
  // Global setup's language builders also read UI entries and regional readers as data.
  // Bind the complete repository source family so those non-import reads cannot escape.
  // The walk is intersected with the files Git tracks: untracked scratch,
  // editor backups and merge leftovers never move the digest on one machine.
  const tracked = trackedSourceFamily(repo)
  const dataInputs = readdirSync(path.join(repo, 'src'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      canonicalDigestPath(path.relative(repo, path.join(entry.parentPath, entry.name))),
    )
    .filter((file) => tracked.has(file))
  const inputs = Object.keys(graph.inputs).map((file) =>
    canonicalDigestPath(file).replace(/ with \{.*\}$/u, ''),
  )
  // The expected digest is an output of the freeze, never its own input.
  // Lockfile and build recipe bind external packages and the search worker.
  return [
    ...new Set([
      ...inputs,
      ...dataInputs,
      ...compilerFiles(repo, [...inputs, ...dataInputs]),
      'package.json',
      'package-lock.json',
      'native/windows/MuseSparkJob.cs',
      'native/windows/MuseSparkMcpJob.cs',
      'native/windows/MuseSparkMcpLauncher.cs',
    ]),
  ]
    .filter((file) => file !== 'src/core/eval/frozen.json')
    .toSorted(compareDigestPath)
}

/** Live launch and direct live-test execution refuse a mismatch before opening credentials. */
export function assertEvalHarnessDigest(
  expected: string = pin.sha256,
  frozen: FrozenEvalHarness = freezeEvalHarness(),
): string {
  const computed = evalHarnessDigest(frozen)
  if (computed !== expected)
    throw new Error(
      `Frozen harness mismatch: pinned ${expected}, computed ${computed}; no live call may run.`,
    )
  return computed
}

/** Freeze arm execution snapshots and the complete parent source provenance before the run. */
export function freezeEvalHarness(
  arms: readonly EvalArm[] = EVAL_ARMS,
  tasks: readonly EvalTask[] = EVAL_TASKS,
): FrozenEvalHarness {
  const repo = armRepoRoot()
  // Layout-independent bytes (M101 R7): without minification esbuild
  // separates bundled modules with `// <path>` comments whose text is the
  // dependency folder's path relative to this checkout (a nested worktree
  // resolving a hoisted node_modules emits `// ../../../node_modules/…`
  // where a root checkout emits `// node_modules/…`), so the frozen text
  // moved with the machine. Whitespace minification emits no path
  // comments; identifiers and syntax are untouched.
  const worker = buildSync({
    absWorkingDir: repo,
    entryPoints: ['src/host/backend/searchWorker.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    minifyWhitespace: true,
    legalComments: 'none',
    logLevel: 'silent',
  }).outputFiles[0]
  if (worker === undefined) throw new Error('the frozen search worker emitted no code')
  const searchWorker = {
    code: worker.text,
    sha256: createHash('sha256').update(worker.contents).digest('hex'),
  }
  const sources = evalHarnessSources()
  const sourceDigests = frozenSourceDigests(
    sources.map((file) => ({ path: file, text: readFileSync(path.join(repo, file), 'utf8') })),
  )
  const fixtures: ArmFixture[] = ['armSources', 'mechanisms', 'runner', 'heldDeps', 'tasks'].map(
    (file) => ({
      path: `${file}.ts`,
      bytes: Buffer.from(
        canonicalDigestText(readFileSync(path.join(repo, 'src/core/eval', `${file}.ts`), 'utf8')),
        'utf8',
      ),
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
    searchWorker,
    selection: JSON.stringify({ arms: arms.map((arm) => arm.name), tasks }),
    sha256: createHash('sha256')
      .update(
        JSON.stringify({ receipt, sources: sourceDigests, searchWorker: searchWorker.sha256 }),
        'utf8',
      )
      .digest('hex'),
  }
}

/** SHA-256 of exactly the bundle and declared fixture bytes the counted run executes. */
export function evalHarnessDigest(frozen: FrozenEvalHarness = freezeEvalHarness()): string {
  return frozen.sha256
}
