// M96d cross-branch advisories (PLAN.md D75): the files each window
// has changed so far, compared continuously with the landing's own
// merge routine, so another window of the same repository on another
// branch gets an advisory as soon as a conflict appears. Only
// conflicts the routine proves are reported: an unknown base, a
// refused merge, and paths a single window changed stay silent.
// Advisories never serialize: this engine has no lease channel, only
// the notification callback, so nothing here can block any window.

import { mergeFile, type MergeRoutineDeps, type MergeVersion } from '../mergeRoutine'
import { type SharedFiles } from '../sharedFiles'

/** What one window changed so far: current bytes per path, null when deleted. */
export interface CrossBranchWindowReport {
  readonly windowId: string
  readonly repository: string
  readonly branch: string
  readonly files: ReadonlyMap<string, MergeVersion | null>
}

export interface CrossBranchAdvisory {
  readonly repository: string
  readonly windowId: string
  readonly otherWindowId: string
  readonly branch: string
  readonly otherBranch: string
  readonly path: string
}

export interface CrossBranchAdvisorDeps {
  /**
  The base version of a path shared by two branches: what the merge
  routine diffs both windows against. Undefined when the host cannot
  establish one; the path is then skipped, never guessed.
  */
  readonly base: (
    repository: string,
    branches: readonly [string, string],
    path: string,
  ) => Promise<MergeVersion | null | undefined>
  /** The landing's merge dispatch and file merges, shared with landing. */
  readonly routine: MergeRoutineDeps
  /** The shared-file table landing merges by; unlisted paths merge as text. */
  readonly shared: SharedFiles
  readonly onAdvisory: (advisory: CrossBranchAdvisory) => void
  /** The owner's error record: every poll failure is posted here. */
  readonly report: (error: unknown) => void
}

/** Pairwise cross-window comparison; the coordinator polls it as reports arrive. */
export class CrossBranchAdvisor {
  private seen = new Set<string>()

  public constructor(private readonly deps: CrossBranchAdvisorDeps) {}

  private async comparePair(
    left: CrossBranchWindowReport,
    right: CrossBranchWindowReport,
    next: Set<string>,
  ): Promise<void> {
    for (const [path, ours] of left.files) {
      if (!right.files.has(path)) continue
      const theirs = right.files.get(path) ?? null
      const base = await this.deps.base(left.repository, [left.branch, right.branch], path)
      if (base === undefined) continue
      const result = await mergeFile(
        { path, kind: this.deps.shared.kind(path) ?? 'text', base, ours, theirs },
        this.deps.routine,
      )
      if (result.status !== 'conflict') continue
      const advisory: CrossBranchAdvisory = {
        repository: left.repository,
        windowId: left.windowId,
        otherWindowId: right.windowId,
        branch: left.branch,
        otherBranch: right.branch,
        path,
      }
      const identity = JSON.stringify([left.repository, left.windowId, right.windowId, path])
      next.add(identity)
      if (!this.seen.has(identity)) this.deps.onAdvisory(advisory)
    }
  }

  public async poll(reports: readonly CrossBranchWindowReport[]): Promise<void> {
    // One report per window: a repeated windowId supersedes its earlier one.
    const latest = new Map<string, CrossBranchWindowReport>()
    for (const report of reports) latest.set(report.windowId, report)
    const byRepository = new Map<string, CrossBranchWindowReport[]>()
    // Map.groupBy does not resolve under this repo's TS lib (as with
    // Iterator.toArray); the explicit loop stays. PLAN.md §8 logs this.
    // eslint-disable-next-line unicorn/prefer-group-by
    for (const report of latest.values()) {
      const group = byRepository.get(report.repository) ?? []
      group.push(report)
      byRepository.set(report.repository, group)
    }
    const next = new Set<string>()
    for (const group of byRepository.values()) {
      const ordered = group.toSorted((left, right) => left.windowId.localeCompare(right.windowId))
      for (const [index, report] of ordered.entries()) {
        const others = ordered.slice(index + 1)
        for (const other of others) {
          // Another window of the same repository on another branch.
          if (report.branch === other.branch) continue
          await this.comparePair(report, other, next)
        }
      }
    }
    this.seen = next
  }

  /** One guarded poll: every failure is posted to the owner's record. */
  public async pollGuarded(reports: readonly CrossBranchWindowReport[]): Promise<void> {
    try {
      await this.poll(reports)
    } catch (error: unknown) {
      this.deps.report(error)
    }
  }
}
