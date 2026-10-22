// The estimator history's concrete sources (M117 C-M117-2, PLAN.md D97.4):
// git lane branches (first implementation commit to integration merge),
// M116's FilePlaybookJournal (complete lane rounds, strikes, redesigns) and
// M113's CI check runs (summed job-hours, never elapsed wall time).
// No clock, model, network or payment. Missing measurements stay missing: a
// source returns undefined and buildHistory excludes the lane with its
// reason. Malformed source data fails loudly, never a silent fallback.
// M96c's board owns the active-agent-time source when it merges; until then
// the board port stays absent and git elapsed time covers durations.

import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import * as z from 'zod/mini'
import { withoutCredentials } from '../../credentialEnvironment'
import { resolveExecutable } from '../../execGuard'
import { NO_WORKSPACE } from '../../executables'
import {
  ESTIMATE_MAX_ITEMS,
  ESTIMATE_SOURCE_TIMEOUT_MS,
  GIT_OUTPUT_MAX_BYTES,
  MILLISECONDS_PER_HOUR,
} from '../../../shared/constants'
import { validatedRecords } from '../../orchestration/playbook/journal'
import { knownFindingClass } from '../../../shared/playbook'
import { branchLane, outputLines } from '../planSnapshot'
import { calibrationFailure } from './records'

const runFile = promisify(execFile)

const shaPattern = /^[a-f\d]+$/i
const branchPattern = /^[\w./-]+$/

/** The machine git ran and exited nonzero: no repository, no ref, no
ancestry. A missing binary or a broken probe rethrows for buildHistory to
report with its cause. */
function isGitProbeFailure(error: unknown): error is { code: number } {
  return (
    error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
  )
}

/** A git invocation with no credential in the environment, a timeout and no console window. */
export function historyGitIo(root: string): {
  runGit: (args: readonly string[]) => Promise<string>
} {
  return {
    runGit: async (args) => {
      const git = resolveExecutable('git', {
        platform: process.platform,
        pathVariable: process.env['PATH'],
        fileExists: existsSync,
        scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
      })
      if (git === undefined) throw calibrationFailure('historySourceUnavailable')
      const { stdout } = await runFile(git, [...args], {
        cwd: root,
        encoding: 'utf8',
        env: withoutCredentials(process.env),
        timeout: ESTIMATE_SOURCE_TIMEOUT_MS,
        maxBuffer: GIT_OUTPUT_MAX_BYTES,
        windowsHide: true,
      })
      return stdout
    },
  }
}

function splitLaneId(laneId: string): { prefix: string; short: string } | undefined {
  const separator = laneId.indexOf(':')
  return separator < 1 || separator === laneId.length - 1
    ? undefined
    : { prefix: laneId.slice(0, separator).toLowerCase(), short: laneId.slice(separator + 1) }
}

/** The lane's unique branch under M113's convention; none or ambiguous stays missing. */
function matchLaneBranch(branches: readonly string[], laneId: string): string | undefined {
  const split = splitLaneId(laneId)
  if (split === undefined) return undefined
  const hits = branches.filter(
    (branch) =>
      branchPattern.test(branch) && branchLane(branch, split.prefix, [split.short]) !== null,
  )
  return hits.length === 1 ? hits[0] : undefined
}

async function laneTip(
  runGit: (args: readonly string[]) => Promise<string>,
  branch: string,
): Promise<string | undefined> {
  const tip = outputLines(await runGit(['rev-parse', '--verify', '--quiet', branch]))[0]
  return tip !== undefined && shaPattern.test(tip) ? tip : undefined
}

/** Measured instants ride through for the builders' schemas to validate: garbage
reaches buildHistory as invalidHistorySource, never a silent exclusion. */
function canonicalInstant(value: string): string {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
}

export interface HistoryGitDeps {
  /** The repository holding the lane branches. */
  readonly root: string
  /** A git invocation; the default runs the machine's own git. */
  readonly runGit?: ((args: readonly string[]) => Promise<string>) | undefined
  /** The lane's build machine class; unknown stays unknown, never guessed. */
  readonly machineClassFor: (laneId: string) => string | undefined
}

/** Git elapsed time: the lane branch's first commit to its integration merge.
Squash-merged, rebased-away and deleted branches stay missing: merge-subject
guessing would attribute another lane's history. */
export function gitDurationSource(deps: HistoryGitDeps): {
  duration: (laneId: string, asOf: string) => Promise<unknown>
} {
  const runGit = deps.runGit ?? historyGitIo(deps.root).runGit
  return {
    duration: async (laneId) => {
      let branches: string[]
      try {
        branches = outputLines(
          await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
        )
      } catch (error) {
        if (isGitProbeFailure(error)) return
        throw error
      }
      if (branches.length > ESTIMATE_MAX_ITEMS) throw calibrationFailure('invalidHistorySource')
      const branch = matchLaneBranch(branches, laneId)
      if (branch === undefined) return
      let defaultRef: string
      let tip: string | undefined
      try {
        defaultRef =
          outputLines(await runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']))[0] ??
          ''
        tip = await laneTip(runGit, branch)
      } catch (error) {
        if (isGitProbeFailure(error)) return
        throw error
      }
      if (tip === undefined || !/^refs\/remotes\/origin\/[\w./-]+$/.test(defaultRef)) return
      const machineClassId = deps.machineClassFor(laneId)
      if (machineClassId === undefined) return
      // A merged branch is an ancestor of the default, so merge-base names
      // the tip itself and cannot find the fork point. The lane's commits
      // are the ones the integration merge brought in: reachable from the
      // tip but not from the merge's first parent.
      let mergeCommit: string | undefined
      let merged: string | undefined
      let first: string | undefined
      try {
        const merge = outputLines(
          await runGit([
            'log',
            '-1',
            '--merges',
            '--format=%H %cI',
            '--ancestry-path',
            `${tip}..${defaultRef}`,
          ]),
        )[0]
        mergeCommit = merge?.split(' ', 1)[0]
        merged = merge?.split(' ').slice(1).join(' ')
        first =
          mergeCommit === undefined
            ? undefined
            : outputLines(
                await runGit([
                  'log',
                  '-1',
                  '--format=%cI',
                  '--reverse',
                  `${mergeCommit}^1..${tip}`,
                ]),
              )[0]
      } catch (error) {
        if (isGitProbeFailure(error)) return
        throw error
      }
      return first === undefined ||
        merged === undefined ||
        mergeCommit === undefined ||
        !shaPattern.test(mergeCommit)
        ? undefined
        : {
            machineClassId,
            startedAt: canonicalInstant(first),
            finishedAt: canonicalInstant(merged),
          }
    },
  }
}

export interface HistoryPlaybookDeps {
  /** M116's journal read; validated and scrubbed before projection. */
  readonly read: () => readonly unknown[]
  /** Maps an estimator lane to its playbook lane id; defaults to identity. */
  readonly playbookLaneIdFor?: ((laneId: string) => string) | undefined
}

/** Review state from M116's record: complete rounds once per lane, strikes
per module family and finding class, one redesign event per family round.
Observed lower bounds, never representative projections: rounds without a
lease lane stay unattributed and unknown. */
export function playbookReviewSource(deps: HistoryPlaybookDeps): {
  review: (laneId: string, asOf: string) => Promise<unknown>
} {
  return {
    review: (laneId, asOf) => {
      let records: ReturnType<typeof validatedRecords>
      try {
        records = validatedRecords(deps.read())
      } catch (error) {
        return Promise.reject(calibrationFailure('historySourceUnavailable', error))
      }
      const target = deps.playbookLaneIdFor?.(laneId) ?? laneId
      const asOfMs = Date.parse(asOf)
      const rounds = records
        .flatMap((record) => (record.kind === 'round' ? [record.value] : []))
        .filter((round) => round.lease?.laneId === target && round.at <= asOfMs)
        .toSorted((left, right) => left.round - right.round || left.at - right.at)
      if (rounds.length === 0) return Promise.resolve({ status: 'unknown' })
      const count = Math.max(...rounds.map((round) => round.round))
      const modules = new Map<
        string,
        { strikes: number; classes: Map<string, number>; redesigns: { afterRound: number }[] }
      >()
      for (const round of rounds) {
        // A finding with any disposition is settled; only unanswered ones strike.
        const answered = new Set(round.answers.map((entry) => entry.findingId))
        const open = round.findings.filter((finding) => !answered.has(finding.id))
        if (open.length === 0) continue
        const module = modules.get(round.module.id) ?? {
          strikes: 0,
          classes: new Map<string, number>(),
          redesigns: [],
        }
        module.strikes += 1
        const classes = new Set<string>()
        for (const finding of open) {
          const known = reviewClassFor(finding.class)
          if (known !== undefined) classes.add(known)
        }
        const scoped = reviewClassFor(round.class)
        if (scoped !== undefined) classes.add(scoped)
        for (const entry of classes) module.classes.set(entry, (module.classes.get(entry) ?? 0) + 1)
        modules.set(round.module.id, module)
      }
      const redesigns: {
        moduleFamilyId: string
        afterRound: number
        outcome: 'caught' | 'remains'
      }[] = []
      const seen = new Set<string>()
      for (const round of rounds) {
        if (round.phase !== 'redesign') continue
        const key = `${round.module.id}:${String(round.round)}`
        if (seen.has(key)) continue
        seen.add(key)
        const answered = new Set(round.answers.map((entry) => entry.findingId))
        redesigns.push({
          moduleFamilyId: round.module.id,
          afterRound: round.round,
          outcome: round.findings.some((finding) => !answered.has(finding.id))
            ? 'remains'
            : 'caught',
        })
      }
      // Families under review but never struck still qualify their rounds.
      for (const round of rounds)
        if (!modules.has(round.module.id))
          modules.set(round.module.id, { strikes: 0, classes: new Map(), redesigns: [] })
      return Promise.resolve({
        status: 'known',
        rounds: count,
        modules: Array.from(modules, ([familyId, module]) => ({
          familyId,
          strikes: module.strikes,
          classes: Array.from(module.classes, ([entry, strikes]) => ({
            class: entry,
            strikes,
          })),
        })),
        redesigns,
      })
    },
  }
}

/** M116's finding classes fold into the estimate's review classes. */
const REVIEW_CLASS_FOR_PLAYBOOK_CLASS: Record<string, string> = {
  validation: 'validationSecurity',
  security: 'validationSecurity',
  failure: 'failureHonesty',
  honesty: 'failureHonesty',
  concurrency: 'concurrencyLifecycle',
  lifecycle: 'concurrencyLifecycle',
  tests: 'testsGates',
  docs: 'docs',
}

function reviewClassFor(value: string | undefined): string | undefined {
  const known = knownFindingClass(value)
  return known === undefined ? undefined : REVIEW_CLASS_FOR_PLAYBOOK_CLASS[known]
}

const checkRunSchema = z.strictObject({
  check: z.string().check(z.minLength(1)),
  outcome: z.enum(['passed', 'failed', 'cancelled', 'skipped']),
  durationMs: z.number().check(
    z.nonnegative(),
    z.refine((value) => Number.isFinite(value)),
  ),
  commit: z.string().check(z.minLength(1)),
  at: z.string().check(z.minLength(1)),
})

export interface HistoryCiDeps {
  /** The repository holding the lane branches. */
  readonly root: string
  /** A git invocation; the default runs the machine's own git. */
  readonly runGit?: ((args: readonly string[]) => Promise<string>) | undefined
  /** M113's check runs: measured per-check durations, never wall time. */
  readonly readCheckRuns: () => readonly unknown[]
}

/** CI job-hours for the lane branch: summed measured check durations whose
commit is the lane tip's ancestor, never concurrent wall time. */
export function ciDurationSource(deps: HistoryCiDeps): {
  duration: (laneId: string, asOf: string) => Promise<unknown>
} {
  const runGit = deps.runGit ?? historyGitIo(deps.root).runGit
  return {
    duration: async (laneId, asOf) => {
      const parsed = z.array(checkRunSchema).safeParse(deps.readCheckRuns())
      if (!parsed.success) throw calibrationFailure('invalidHistorySource')
      if (parsed.data.length > ESTIMATE_MAX_ITEMS) throw calibrationFailure('invalidHistorySource')
      const asOfMs = Date.parse(asOf)
      const runs = parsed.data.filter((run) => {
        const at = Date.parse(run.at)
        if (!Number.isFinite(at)) throw calibrationFailure('invalidHistorySource')
        return at <= asOfMs
      })
      if (runs.length === 0) return
      let branches: string[]
      try {
        branches = outputLines(
          await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
        )
      } catch (error) {
        if (isGitProbeFailure(error)) return
        throw error
      }
      const branch = matchLaneBranch(branches, laneId)
      if (branch === undefined) return
      let tip: string | undefined
      try {
        tip = await laneTip(runGit, branch)
      } catch (error) {
        if (isGitProbeFailure(error)) return
        throw error
      }
      if (tip === undefined) return
      let totalMs = 0
      let isMatched = false
      for (const run of runs) {
        if (!shaPattern.test(run.commit)) throw calibrationFailure('invalidHistorySource')
        let isAncestor: boolean
        try {
          await runGit(['merge-base', '--is-ancestor', run.commit, tip])
          isAncestor = true
        } catch (error: unknown) {
          if (isGitProbeFailure(error) && error.code === 1) {
            isAncestor = false
          } else {
            throw error
          }
        }
        if (!isAncestor) continue
        isMatched = true
        totalMs += run.durationMs
      }
      if (!isMatched) return
      return { ciHours: totalMs / MILLISECONDS_PER_HOUR }
    },
  }
}
