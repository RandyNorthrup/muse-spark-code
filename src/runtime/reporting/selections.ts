import type { UiText } from '../../shared/l10n/en'
import * as z from 'zod/mini'
import { GIT_METADATA_OPTIONS, REPORT_GIT_MAX_COMMITS } from '../../shared/constants'
import type { ReportOptions } from '../../shared/reportSchema'
import type { ReportSelectionPorts } from '../../core/reporting/collect/repository'
import type {
  GitFacts,
  PlanFacts,
  SourceResult,
  SourceSnapshot,
} from '../../core/reporting/sources/types'
import type { ReportGitIo } from '../../core/reporting/sources/git'
import { sourceReason } from '../../core/reporting/sources/local'
import { readPlan } from '../../core/reporting/plan/reader'

const commitsSchema = z
  .array(z.string().check(z.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)))
  .check(z.maxLength(REPORT_GIT_MAX_COMMITS + 1))
function result<T>(
  id: string,
  data: T,
  asOf: string,
  reportText: UiText,
  isPartial = false,
): SourceResult<T> {
  return {
    data,
    record: {
      id,
      observedAt: asOf,
      freshness: { state: 'fresh', ageMs: 0 },
      ...(isPartial
        ? { status: 'partial' as const, reason: sourceReason('limit', reportText) }
        : { status: 'ok' as const, reason: null }),
    },
  }
}
function unavailable(id: string, reportText: UiText): SourceResult<never> {
  return {
    data: null,
    record: {
      id,
      status: 'unavailable',
      reason: sourceReason('unbound', reportText),
      observedAt: null,
      freshness: { state: 'unknown', ageMs: null },
    },
  }
}

/**
Bounded ancestry proves ranges and lane membership; timestamps never stand
in for a graph. The caller's signal (the person's cancel) is the only end of
these git reads: no deadline of ours abandons them (D121/D208).
*/
export async function readReportSelections(
  snapshot: SourceSnapshot,
  options: ReportOptions,
  io: ReportGitIo,
  signal: AbortSignal,
  reportText: UiText,
): Promise<ReportSelectionPorts> {
  const git = snapshot.sources.git.data
  const latestTag = git?.tags.toSorted(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.name < b.name ? -1 : 1),
  )[0]
  const run = async (args: readonly string[]) => {
    const value = await io.run([...GIT_METADATA_OPTIONS, ...args], signal)
    if (value.code !== 0) throw new Error('report/selectionUnavailable')
    return value.stdout
  }
  const commits = async (args: readonly string[]) => {
    const stdout = await run([
      'rev-list',
      `--max-count=${String(REPORT_GIT_MAX_COMMITS + 1)}`,
      ...args,
      '--',
    ])
    return commitsSchema.parse(stdout.trim().split('\n').filter(Boolean))
  }
  let changes: SourceResult<GitFacts['commits']> = unavailable('gitRange', reportText)
  let memberships: ReturnType<ReportSelectionPorts['changeBranches']> = unavailable(
    'gitMembership',
    reportText,
  )
  let risks: SourceResult<Pick<PlanFacts, 'risks' | 'residuals'>> = unavailable(
    'planRevision',
    reportText,
  )
  if (git !== null && options.kind === 'changes') {
    try {
      let args: readonly string[]
      if (/^\d{4}-\d{2}-\d{2}$/.test(options.scope) && Number.isFinite(Date.parse(options.scope)))
        args = [`--since=${options.scope}T00:00:00+00:00`, git.head]
      else {
        const base =
          options.scope === '' || options.scope === 'latest'
            ? latestTag?.commit
            : (git.tags.find((tag) => tag.name === options.scope)?.commit ??
              git.branches.find((branch) => branch.name === options.scope)?.commit)
        if (base === undefined) throw new Error('report/selectionUnavailable')
        args = [`${base}..${git.head}`]
      }
      const selected = await commits(args)
      const shas = new Set(selected)
      const known = git.commits.filter((commit) => shas.has(commit.sha))
      changes = result(
        'gitRange',
        known,
        snapshot.asOf,
        reportText,
        selected.length > REPORT_GIT_MAX_COMMITS || known.length !== selected.length,
      )
      const defaultBranch = git.branches.find((branch) => branch.name === git.defaultBranch)
      if (defaultBranch === undefined) throw new Error('report/selectionUnavailable')
      const byCommit = new Map<string, string[]>(known.map((commit) => [commit.sha, []]))
      let isPartial = false
      for (const branch of git.branches) {
        signal.throwIfAborted()
        const forkText = await run(['merge-base', defaultBranch.commit, branch.commit])
        const fork = forkText.trim()
        commitsSchema.parse([fork])
        const reachable = await commits([branch.commit, `^${fork}`])
        isPartial ||= reachable.length > REPORT_GIT_MAX_COMMITS
        for (const sha of reachable) byCommit.get(sha)?.push(branch.name)
      }
      memberships = result(
        'gitMembership',
        Array.from(byCommit, ([commit, branches]) => ({ commit, branches })),
        snapshot.asOf,
        reportText,
        isPartial,
      )
    } catch {
      /* A missing ref, bounded graph or cancelled read remains unavailable evidence. */
    }
  }
  if (
    latestTag !== undefined &&
    snapshot.sources.plan.data !== null &&
    (options.kind === 'release' || options.kind === 'project')
  ) {
    try {
      const prior = readPlan(await run(['show', `${latestTag.commit}:PLAN.md`])).facts
      if (prior.format === 'none' || prior.drift.length > 0)
        throw new Error('report/selectionUnavailable')
      const current = snapshot.sources.plan.data
      const oldRisks = new Set(prior.risks.map((entry) => JSON.stringify(entry)))
      const oldResiduals = new Set(prior.residuals.map((entry) => JSON.stringify(entry)))
      risks = result(
        'planRevision',
        {
          risks: current.risks.filter((entry) => !oldRisks.has(JSON.stringify(entry))),
          residuals: current.residuals.filter((entry) => !oldResiduals.has(JSON.stringify(entry))),
        },
        snapshot.asOf,
        reportText,
      )
    } catch {
      /* Revision evidence is unavailable; do not infer dates from prose. */
    }
  }
  return {
    changes: () => changes,
    changeBranches: () => memberships,
    risksSinceRelease: () => risks,
  }
}
