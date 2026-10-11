import { EstimateDiagnosticError } from '../../core/estimator/diagnostic'
// The estimator snapshot binding's host side (M117 C-M117-1, PLAN.md D97.2):
// the workspace plan plus git merged-lane state plus `gh` PR/issue evidence,
// projected through the shared core adapter. Used by every host (the VS Code
// extension and the headless runtime) with its own root. Programs resolve by
// absolute path on absolute PATH entries only (PLAN.md D24), run with no
// credential in the environment, a timeout and no console window.
//
// Evidence reads are strict: failed or incomplete sources refuse by name.
// Reports admission is acquired on every estimate and rechecked at dispatch.
// Issue/label goals refuse before IO until their explicit associations exist.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { buildPlanSnapshot, checkPlan } from '../../core/estimator/planSnapshot'
import { resolveExecutable } from '../../core/executables'
import type { EstimateGoal } from '../../shared/estimate'
import type { UiText } from '../../shared/l10n/en'
import {
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_SOURCE_TIMEOUT_MS,
  GIT_OUTPUT_MAX_BYTES,
  GITHUB_API_BASE_URL,
  UI_TEXT,
} from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'

import {
  isReportNetworkAllowed,
  type ReportNetworkPolicy,
} from '../../core/reporting/sources/cache'

const runFile = promisify(execFile)

const ghPullSchema = z
  .array(
    z.strictObject({
      number: z.int().check(z.positive()),
      headRefName: z.string().check(z.minLength(1)),
      state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
      mergedAt: z.nullable(z.iso.datetime({ offset: true })),
    }),
  )
  .check(z.refine((pulls) => new Set(pulls.map((pull) => pull.number)).size === pulls.length))
  // A MERGED row without a merge timestamp is malformed evidence: accepting
  // it would record the pull as merely closed and silently drop completion.
  .check(
    z.refine((pulls) => pulls.every((pull) => pull.state !== 'MERGED' || pull.mergedAt !== null)),
  )

export interface PlanSnapshotSourceIo {
  /** The plan text; rejects when the plan cannot be read. */
  readonly readPlanFile: (file: string, signal?: AbortSignal) => Promise<string>
  /** A git invocation in the root; rejects when git is unavailable. */
  readonly runGit: (args: readonly string[], signal?: AbortSignal) => Promise<string>
  /** A `gh` invocation in the root; rejects when `gh` is unavailable. */
  readonly runGh: (args: readonly string[], signal?: AbortSignal) => Promise<string>
}

export interface PlanSnapshotSourceDeps {
  /** The workspace root holding PLAN.md; empty refuses every snapshot. */
  readonly root: string
  /** How the source reads; the default runs the machine's own git and `gh`. */
  readonly io?: PlanSnapshotSourceIo | undefined
  /** Fresh Reports policy; absent means no network. Rechecked before dispatch. */
  readonly networkPolicy?: (() => Promise<ReportNetworkPolicy>) | undefined
}

/** Installs the caller's language table in the snapshot bundle: each bundle
 * keeps its own installed-language state, so the lazy loader calls this
 * with its table before the first snapshot reads it. */
export function installPlanSnapshotText(table: UiText, locale: string): void {
  setUiText(table, locale)
}

function program(name: string): string | undefined {
  return resolveExecutable(name, {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
}

async function runProgram(
  file: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const { stdout } = await runFile(file, [...args], {
    cwd,
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    timeout: ESTIMATE_SOURCE_TIMEOUT_MS,
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
    windowsHide: true,
    ...(signal !== undefined && { signal }),
  })
  return stdout
}

function defaultIo(root: string): PlanSnapshotSourceIo {
  return {
    readPlanFile: (file, signal) =>
      readFile(file, signal === undefined ? 'utf8' : { encoding: 'utf8', signal }),
    runGit: async (args, signal) => {
      const git = program('git')
      if (git === undefined)
        throw new EstimateDiagnosticError('estimate-unavailable', UI_TEXT.estimateUnavailable)
      return await runProgram(git, args, root, signal)
    },
    runGh: async (args, signal) => {
      const gh = program('gh')
      if (gh === undefined)
        throw new EstimateDiagnosticError('estimate-unavailable', UI_TEXT.estimateUnavailable)
      return await runProgram(gh, args, root, signal)
    },
  }
}

function lines(output: string): string[] {
  return output
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function refuseSource(detail: string): never {
  throw new EstimateDiagnosticError(detail)
}

async function required(
  source: string,
  run: () => Promise<string>,
  signal: AbortSignal | undefined,
): Promise<string> {
  signal?.throwIfAborted()
  try {
    const output = await run()
    signal?.throwIfAborted()
    return output
  } catch {
    signal?.throwIfAborted()
    refuseSource(`source-unavailable: ${source}`)
  }
}

function pullState(pull: { mergedAt: string | null; state: string }): 'open' | 'closed' | 'merged' {
  if (pull.mergedAt !== null) return 'merged'
  return pull.state === 'OPEN' ? 'open' : 'closed'
}

/** The snapshot binding: the goal's snapshot from this root's plan. */
export function createPlanSnapshotSource(
  deps: PlanSnapshotSourceDeps,
): (goal: EstimateGoal, asOf: string, signal?: AbortSignal) => Promise<unknown> {
  const io = deps.io ?? defaultIo(deps.root)
  return async (goal, asOf, signal) => {
    if (deps.root === '') refuseMissingPlan(deps.root)
    // Issue and label goals need lane associations the plan source cannot
    // supply yet (M113 N's linkage is a later lane): refusing names the gap
    // instead of reporting a goal that exists as not found.
    if (goal.kind === 'issues' || goal.kind === 'label') {
      refuseSource(`missing-associations: ${goal.kind}`)
    }
    signal?.throwIfAborted()
    const planText = await readWorkspacePlan(io, deps.root, signal)
    signal?.throwIfAborted()
    const branchOutput = await required(
      'branches',
      () => io.runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], signal),
      signal,
    )
    const branches = lines(branchOutput)
    if (branches.length > ESTIMATE_MAX_ITEMS) refuseSource('source-incomplete: branches')
    const defaultOutput = await required(
      'default-branch',
      () => io.runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], signal),
      signal,
    )
    const defaultRef = defaultOutput.trim()
    if (!/^refs\/remotes\/origin\/[\w./-]+$/.test(defaultRef))
      refuseSource('source-unavailable: default-branch')
    const mergedOutput = await required(
      'merged-branches',
      () => io.runGit(['branch', '--merged', defaultRef, '--format=%(refname:short)'], signal),
      signal,
    )
    const mergedNames = lines(mergedOutput)
    if (mergedNames.length > ESTIMATE_MAX_ITEMS) refuseSource('source-incomplete: merged-branches')
    const merged = new Set(mergedNames)
    const branchEvidence = branches.map((name) => ({ name, merged: merged.has(name) }))
    signal?.throwIfAborted()
    const policy = await deps.networkPolicy?.()
    const context = {
      asOf,
      workspaceKey: deps.root,
      signal: signal ?? new AbortController().signal,
      options: {
        kind: 'estimate' as const,
        asOf,
        scope: deps.root,
        full: false,
        network: false,
        failOn: [],
      },
    }
    const isAdmitted =
      policy !== undefined &&
      isReportNetworkAllowed(policy, context, 'api.github.com') &&
      (await policy.allowEgress(GITHUB_API_BASE_URL, context.signal)) &&
      isReportNetworkAllowed(policy, context, 'api.github.com')
    signal?.throwIfAborted()
    let pulls: z.infer<typeof ghPullSchema> | null = null
    if (isAdmitted) {
      const output = await required(
        'pull-requests',
        () =>
          io.runGh(
            [
              'pr',
              'list',
              '--state',
              'all',
              '--limit',
              String(ESTIMATE_MAX_ITEMS),
              '--json',
              'number,headRefName,state,mergedAt',
            ],
            signal,
          ),
        signal,
      )
      const parsed = ghPullSchema.safeParse(safeJson(output))
      if (!parsed.success) refuseSource('source-unavailable: pull-requests')
      pulls = parsed.data
      // gh's capped list has no completeness receipt at the cap. Refuse all
      // goals rather than infer nonexistence or completion from partial data.
      if (pulls.length >= ESTIMATE_MAX_ITEMS) refuseSource('source-incomplete: pull-requests')
    }
    if (pulls === null && goal.kind === 'pullRequest')
      refuseSource('source-unavailable: pull-requests')
    signal?.throwIfAborted()
    return buildPlanSnapshot(planText, goal, asOf, {
      branches: branchEvidence,
      ...(pulls !== null && {
        pullRequests: pulls.map((pull) => ({
          branch: pull.headRefName,
          number: pull.number,
          state: pullState(pull),
        })),
      }),
    })
  }
}

export interface PlanCheckSourceDeps {
  /** The workspace root holding PLAN.md; empty refuses every check. */
  readonly root: string
  /** How the source reads; the default reads the machine's own PLAN.md. */
  readonly io?: Pick<PlanSnapshotSourceIo, 'readPlanFile'> | undefined
}

/** The whole plan's estimator problems, evidence-free: no git, no `gh`, no
 * network. Reports every duplicate, malformed Starts cell, unknown
 * prerequisite, unknown rig and unknown release member; empty means every
 * goal is forecastable. */
export function createPlanCheckSource(
  deps: PlanCheckSourceDeps,
): (signal?: AbortSignal) => Promise<string[]> {
  const io = deps.io ?? defaultIo(deps.root)
  return async (signal) => {
    if (deps.root === '') refuseMissingPlan(deps.root)
    signal?.throwIfAborted()
    return checkPlan(await readWorkspacePlan(io, deps.root, signal))
  }
}

/** This workspace's PLAN.md text, or a refusal naming the missing file. */
async function readWorkspacePlan(
  io: Pick<PlanSnapshotSourceIo, 'readPlanFile'>,
  root: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  try {
    return await io.readPlanFile(path.join(root, 'PLAN.md'), signal)
  } catch {
    signal?.throwIfAborted()
    refuseMissingPlan(path.join(root, 'PLAN.md'))
  }
}

function safeJson(output: string): unknown {
  try {
    return JSON.parse(output) as unknown
  } catch {
    return null
  }
}

function refuseMissingPlan(detail: string): never {
  refuseSource(`missing-plan: ${detail === '' ? 'workspace' : 'PLAN.md'}`)
}
