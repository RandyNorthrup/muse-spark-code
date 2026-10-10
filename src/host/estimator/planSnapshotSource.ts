// The estimator snapshot binding's host side (M117 C-M117-1, PLAN.md D97.2):
// the workspace plan plus git merged-lane state plus `gh` PR/issue evidence,
// projected through the shared core adapter. Used by every host (the VS Code
// extension and the headless runtime) with its own root. Programs resolve by
// absolute path on absolute PATH entries only (PLAN.md D24), run with no
// credential in the environment, a timeout and no console window.
//
// Evidence gaps stay conservative, never invented: a git or `gh` failure
// leaves that evidence empty, so lanes count as planned rather than merged
// (an overestimate, never done-ness from nothing). Only an unreadable plan
// refuses the read: there is nothing to estimate without it. Issue evidence
// carries no lane linkage yet (M113 N's association is a later lane), so
// label and issue goals resolve once callers supply associated evidence.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { buildPlanSnapshot, type PlanSnapshotEvidence } from '../../core/estimator/planSnapshot'
import { resolveExecutable } from '../../core/executables'
import type { EstimateGoal } from '../../shared/estimate'
import {
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_SOURCE_TIMEOUT_MS,
  GIT_OUTPUT_MAX_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

const runFile = promisify(execFile)

const ghPullSchema = z.array(
  z.strictObject({
    number: z.number().check(z.positive()),
    headRefName: z.string(),
    state: z.string(),
    mergedAt: z.nullable(z.string()),
  }),
)
const ghIssueSchema = z.array(
  z.strictObject({
    number: z.number().check(z.positive()),
    labels: z.array(z.union([z.string(), z.strictObject({ name: z.string() })])),
  }),
)

export interface PlanSnapshotSourceIo {
  /** The plan text; rejects when the plan cannot be read. */
  readonly readPlanFile: (file: string) => Promise<string>
  /** A git invocation in the root; rejects when git is unavailable. */
  readonly runGit: (args: readonly string[]) => Promise<string>
  /** A `gh` invocation in the root; rejects when `gh` is unavailable. */
  readonly runGh: (args: readonly string[]) => Promise<string>
}

export interface PlanSnapshotSourceDeps {
  /** The workspace root holding PLAN.md; empty refuses every snapshot. */
  readonly root: string
  /** How the source reads; the default runs the machine's own git and `gh`. */
  readonly io?: PlanSnapshotSourceIo | undefined
}

function program(name: string): string | undefined {
  return resolveExecutable(name, {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
}

async function runProgram(file: string, args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await runFile(file, [...args], {
    cwd,
    encoding: 'utf8',
    env: withoutCredentials(process.env),
    timeout: ESTIMATE_SOURCE_TIMEOUT_MS,
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
    windowsHide: true,
  })
  return stdout
}

function defaultIo(root: string): PlanSnapshotSourceIo {
  return {
    readPlanFile: (file) => readFile(file, 'utf8'),
    runGit: async (args) => {
      const git = program('git')
      if (git === undefined) throw new Error(UI_TEXT.estimateUnavailable)
      return await runProgram(git, args, root)
    },
    runGh: async (args) => {
      const gh = program('gh')
      if (gh === undefined) throw new Error(UI_TEXT.estimateUnavailable)
      return await runProgram(gh, args, root)
    },
  }
}

function lines(output: string): string[] {
  return output
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, ESTIMATE_MAX_ITEMS)
}

/** A failed evidence read degrades to nothing; only the plan itself refuses. */
async function optional<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch {
    return null
  }
}

function pullState(pull: { mergedAt: string | null; state: string }): 'open' | 'closed' | 'merged' {
  if (pull.mergedAt !== null) return 'merged'
  return pull.state === 'OPEN' ? 'open' : 'closed'
}

/** The snapshot binding: the goal's snapshot from this root's plan. */
export function createPlanSnapshotSource(
  deps: PlanSnapshotSourceDeps,
): (goal: EstimateGoal, asOf: string) => Promise<unknown> {
  const io = deps.io ?? defaultIo(deps.root)
  return async (goal, asOf) => {
    if (deps.root === '') refuseMissingPlan(deps.root)
    let planText: string
    try {
      planText = await io.readPlanFile(path.join(deps.root, 'PLAN.md'))
    } catch {
      refuseMissingPlan(path.join(deps.root, 'PLAN.md'))
    }
    const branchOutput = await optional(() =>
      io.runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    )
    let branchEvidence: PlanSnapshotEvidence['branches']
    if (branchOutput !== null) {
      const mergedOutput = await optional(() =>
        io.runGit(['branch', '--merged', 'HEAD', '--format=%(refname:short)']),
      )
      const merged = new Set(mergedOutput === null ? [] : lines(mergedOutput))
      branchEvidence = lines(branchOutput).map((name) => ({ name, merged: merged.has(name) }))
    }
    const pullOutput = await optional(() =>
      io.runGh([
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        String(ESTIMATE_MAX_ITEMS),
        '--json',
        'number,headRefName,state,mergedAt',
      ]),
    )
    const parsedPulls = pullOutput === null ? null : ghPullSchema.safeParse(safeJson(pullOutput))
    const pulls = parsedPulls?.success === true ? parsedPulls.data : null
    const issueOutput = await optional(() =>
      io.runGh([
        'issue',
        'list',
        '--state',
        'all',
        '--limit',
        String(ESTIMATE_MAX_ITEMS),
        '--json',
        'number,labels',
      ]),
    )
    const parsedIssues =
      issueOutput === null ? null : ghIssueSchema.safeParse(safeJson(issueOutput))
    const found = parsedIssues?.success === true ? parsedIssues.data : null
    return buildPlanSnapshot(planText, goal, asOf, {
      ...(branchEvidence !== undefined && { branches: branchEvidence }),
      ...(pulls !== null && {
        pullRequests: pulls.map((pull) => ({
          branch: pull.headRefName,
          number: pull.number,
          state: pullState(pull),
        })),
      }),
      ...(found !== null && {
        issues: found.map((issue) => ({
          number: issue.number,
          labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name)),
          laneIds: [],
        })),
      }),
    })
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
  throw new Error(fill(UI_TEXT.estimateFailed, { detail: `missing-plan: ${detail}` }))
}
