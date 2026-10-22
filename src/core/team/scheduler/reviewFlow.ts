import * as z from 'zod/mini'
import { REVIEW_SEVERITIES, type ReviewSeverity } from '../../../shared/constants'
import {
  knownSeverity,
  parseReviewFindings,
  type ReviewFinding,
} from '../../../shared/reviewFindings'
import { type TeamBoardTask } from '../../../shared/team'
import {
  decideReviewCarryOver,
  type CarryContext,
  type CarryFileDelta,
  type CarryFileVerdict,
} from './reviewCarryOver'

type ReviewClass = 'concurrency' | 'boundaries' | 'failurePaths'
const classes: readonly ReviewClass[] = ['concurrency', 'boundaries', 'failurePaths']
const responseSchema = z.strictObject({
  head: z.string().check(z.minLength(1)),
  groups: z.array(
    z.strictObject({
      reviewClass: z.enum(['concurrency', 'boundaries', 'failurePaths']),
      findingsJson: z.string(),
    }),
  ),
})
interface ClassifiedFinding {
  reviewClass: ReviewClass
  finding: ReviewFinding
}
const rank = (finding: ReviewFinding): number =>
  REVIEW_SEVERITIES.indexOf(knownSeverity(finding.severity) ?? 'critical')

export interface CheckClaim {
  command: string
  passed: boolean
}
export interface ExecutedCheck {
  command: string
  exitCode: number | null
}

function latestChecks(executed: readonly ExecutedCheck[]): readonly ExecutedCheck[] {
  const latest = new Map<string, ExecutedCheck>()
  for (const check of executed) latest.set(check.command.trim(), check)
  return Array.from(latest, ([, check]) => check)
}

export function checkClaims(
  claims: readonly CheckClaim[],
  executed: readonly ExecutedCheck[],
): readonly { claim: CheckClaim; verification: 'verified' | 'unverified' | 'contradicted' }[] {
  const latest = latestChecks(executed)
  return claims.map((claim) => {
    const match = latest.find((check) => check.command.trim() === claim.command.trim())
    let verification: 'verified' | 'unverified' | 'contradicted' = 'unverified'
    if (match && match.exitCode !== null)
      verification = (match.exitCode === 0) === claim.passed ? 'verified' : 'contradicted'
    return { claim, verification }
  })
}

export interface ReviewEntry {
  id: string
  modelId: string
  freeLanes: number
}
export interface ReviewRequest {
  taskId: string
  attempt: number
  head: string
  entry: ReviewEntry
  classes: readonly ReviewClass[]
  otherClasses: readonly ReviewClass[]
  claims: ReturnType<typeof checkClaims>
  isSameModel: boolean
  /**
  The changed files to review: carry-over scopes re-review to exactly
  these. Undefined reviews the whole change; a reviewer that cannot
  scope reviews more, never less.
  */
  files?: readonly string[]
}
export interface ReviewDependencies {
  head(taskId: string): string
  authors(taskId: string): readonly string[]
  reviewers(): readonly ReviewEntry[]
  sameModel(left: string, right: string): boolean
  claims(taskId: string, attempt: number): readonly CheckClaim[]
  executed(taskId: string, attempt: number): readonly ExecutedCheck[]
  isCurrent(taskId: string, attempt: number): boolean
  /** Atomic lane reservations plus named delegate authorization/paid consent. */
  admit(
    requests: readonly ReviewRequest[],
  ): { run(request: ReviewRequest): Promise<unknown>; release(): void } | undefined
  rework(
    taskId: string,
    findings: readonly ClassifiedFinding[],
    failedChecks: readonly ExecutedCheck[],
  ): Promise<boolean>
  enqueue(taskId: string, head: string, isReviewed: boolean): Promise<void>
  record(
    taskId: string,
    head: string,
    round: number,
    findings: readonly ClassifiedFinding[],
    isSameModel: boolean,
  ): Promise<void>
  redesign(
    taskId: string,
    findings: readonly ClassifiedFinding[],
    failedChecks: readonly ExecutedCheck[],
  ): void
  /**
  Exact per-file deltas at a head, computed from version control.
  Absent when the host cannot read them: the review runs whole-head.
  */
  readDeltas?(taskId: string, head: string): readonly CarryFileDelta[]
  /**
  Patch-ID hints narrowing the carry-over comparison; never the
  acceptance key. Absent compares every file by oid.
  */
  patchHints?(taskId: string, priorHead: string, head: string): CarryContext['patchHints']
  /**
  Files the integration changed between the heads. Absent means
  unknown, and an unknown context carries nothing.
  */
  integrationChanged?(
    taskId: string,
    sinceHead: string,
    head: string,
  ): readonly string[] | undefined
  /**
  What each changed file reads. Absent means unknown, and an unknown
  context carries nothing.
  */
  readSets?(taskId: string): ReadonlyMap<string, readonly string[]> | undefined
}

type ReviewOutcome =
  'manual' | 'waiting' | 'stale' | 'rework' | 'redesign' | 'reviewed' | 'notReviewed' | 'refused'
interface ReviewRecord {
  head: string
  attempt: number
  round: number
  isClean: boolean
  findings: readonly ClassifiedFinding[]
  failedChecks: readonly ExecutedCheck[]
  hasDispatched: boolean
  /**
  Per-file verdicts at this head: custody-local, like the record.
  A restart re-reviews rather than trusting a verdict it never read.
  */
  files?: readonly CarryFileVerdict<ClassifiedFinding>[]
}

/**
Per-file carry-over on exact deltas; whole-head when the host cannot
read deltas. A whitespace-only change is a changed delta too.
*/
export class ReviewFlow {
  private readonly records = new Map<string, ReviewRecord>()
  private readonly running = new Set<string>()
  constructor(
    private readonly deps: ReviewDependencies,
    private readonly config: {
      flow: 'full' | 'reviewAutomatically' | 'manual'
      loopBackSeverity: ReviewSeverity
      requiresDifferentModel: boolean
    },
  ) {}

  private async dispatch(taskId: string, record: ReviewRecord): Promise<ReviewOutcome> {
    if (record.hasDispatched) {
      return !record.isClean && this.config.flow === 'full' ? 'waiting' : 'reviewed'
    }
    if (this.config.flow === 'full') {
      if (!record.isClean) {
        if (!(await this.deps.rework(taskId, record.findings, record.failedChecks)))
          return 'waiting'
        record.hasDispatched = true
        return 'rework'
      }
      await this.deps.enqueue(taskId, record.head, true)
    }
    record.hasDispatched = true
    return 'reviewed'
  }

  private async guardedDispatch(taskId: string, record: ReviewRecord): Promise<ReviewOutcome> {
    this.running.add(taskId)
    try {
      return await this.dispatch(taskId, record)
    } finally {
      this.running.delete(taskId)
    }
  }

  reviewed(taskId: string): boolean {
    const record = this.records.get(taskId)
    return record?.isClean === true && record.head === this.deps.head(taskId)
  }

  /**
  The caller restores the journal's round count. Rounds continue until the
  change is clean or the person stops the work: no count of ours diverts
  to `redesign` (D121). The orchestrator dispatches a redesign through its
  own `redesign` implementation when the person asks for one.
  */
  async afterRetirement(
    task: TeamBoardTask,
    isWriting: boolean,
    isExplicit = false,
  ): Promise<ReviewOutcome> {
    if (!isWriting || (!isExplicit && this.config.flow === 'manual')) return 'manual'
    const attempt = task.attempts.at(-1)
    if (attempt?.state !== 'retired' || !this.deps.isCurrent(task.id, task.currentAttempt))
      return 'refused'
    if (this.running.has(task.id)) return 'waiting'
    const head = this.deps.head(task.id)
    const previous = this.records.get(task.id)
    if (previous?.head === head && previous.attempt === task.currentAttempt) {
      return await this.guardedDispatch(task.id, previous)
    }
    const deltas = this.deps.readDeltas?.(task.id, head)
    const decision =
      deltas === undefined || previous?.files === undefined
        ? undefined
        : decideReviewCarryOver(previous.files, deltas, {
            patchHints: this.deps.patchHints?.(task.id, previous.head, head),
            integrationChanged: this.deps.integrationChanged?.(task.id, previous.head, head),
            readSets: this.deps.readSets?.(task.id),
          })
    if (decision !== undefined && previous !== undefined && decision.reReview.length === 0) {
      // The review stands on unchanged deltas: move the record to the
      // new head and dispatch its standing verdict, with no new round.
      const carried: ReviewRecord = {
        ...previous,
        head,
        attempt: task.currentAttempt,
        files: decision.carried,
      }
      this.records.set(task.id, carried)
      return await this.guardedDispatch(task.id, carried)
    }
    const scope = decision?.reReview
    const round = Math.max(task.reviewRounds, previous?.round ?? 0) + 1
    const authors = this.deps.authors(task.id)
    const available = this.deps.reviewers().filter((entry) => entry.freeLanes > 0)
    const independent = available.filter((entry) =>
      authors.every((author) => !this.deps.sameModel(entry.modelId, author)),
    )
    const candidates = independent.length > 0 ? independent : available
    const isSameModel = independent.length === 0 && available.length > 0
    if (isSameModel && this.config.requiresDifferentModel) return 'refused'
    if (candidates.length === 0) {
      if (this.config.flow === 'full') await this.deps.enqueue(task.id, head, false)
      return 'notReviewed'
    }
    const claims = checkClaims(
      this.deps.claims(task.id, task.currentAttempt),
      this.deps.executed(task.id, task.currentAttempt),
    )
    const lanes = candidates.flatMap((entry) =>
      Array.from({ length: Math.min(entry.freeLanes, classes.length) }, () => entry),
    )
    const request = (entry: ReviewEntry, assigned: readonly ReviewClass[]): ReviewRequest => ({
      taskId: task.id,
      attempt: task.currentAttempt,
      head,
      entry,
      classes: assigned,
      otherClasses: classes.filter((reviewClass) => !assigned.includes(reviewClass)),
      claims,
      isSameModel,
      files: scope,
    })
    const first = candidates[0]
    if (!first) return 'waiting'
    const requests =
      lanes.length >= classes.length
        ? classes.map((reviewClass, index) => {
            const entry = lanes[index]
            if (!entry) throw new Error('team:reviewLane')
            return request(entry, [reviewClass])
          })
        : [request(first, classes)]
    const admission = this.deps.admit(requests)
    if (!admission) return 'waiting'
    this.running.add(task.id)
    try {
      const replies = await Promise.allSettled(
        requests.map(async (item) => {
          const response = responseSchema.parse(await admission.run(item))
          if (
            response.head !== head ||
            response.groups.length !== item.classes.length ||
            new Set(response.groups.map((group) => group.reviewClass)).size !== item.classes.length
          )
            throw new Error('team:reviewHeadOrClasses')
          return response.groups.flatMap((group) => {
            if (!item.classes.includes(group.reviewClass)) throw new Error('team:reviewClass')
            const findings = parseReviewFindings(group.findingsJson)
            if (!findings) throw new Error('team:reviewFindings')
            return findings.map((finding) => ({ reviewClass: group.reviewClass, finding }))
          })
        }),
      )
      if (this.deps.head(task.id) !== head || !this.deps.isCurrent(task.id, task.currentAttempt))
        return 'stale'
      const findings = new Map<string, ClassifiedFinding>()
      const completed = replies.flatMap((reply) => {
        if (reply.status === 'rejected') throw reply.reason
        return reply.value
      })
      for (const item of completed) {
        const key = JSON.stringify([item.finding.file, item.finding.line, item.reviewClass])
        const prior = findings.get(key)
        // Keep the more severe duplicate; an unknown severity conservatively loops back.

        if (!prior || rank(item.finding) < rank(prior.finding)) findings.set(key, item)
      }
      const merged = Array.from(findings, ([, item]) => item)
      const failedChecks = latestChecks(this.deps.executed(task.id, task.currentAttempt)).filter(
        (check) => check.exitCode !== null && check.exitCode !== 0,
      )
      const hasFailures =
        failedChecks.length > 0 ||
        merged.some(
          (item) =>
            REVIEW_SEVERITIES.indexOf(knownSeverity(item.finding.severity) ?? 'critical') <=
            REVIEW_SEVERITIES.indexOf(this.config.loopBackSeverity),
        )
      await this.deps.record(task.id, head, round, merged, isSameModel)
      if (this.deps.head(task.id) !== head || !this.deps.isCurrent(task.id, task.currentAttempt))
        return 'stale'
      // A round with findings records no verdict for the files it
      // re-reviewed: unattributed findings must not taint a file the
      // next round would otherwise carry. Clean files certify exactly
      // the files the round scoped.
      const carriedVerdicts = decision?.carried ?? []
      const scopedPaths = decision?.reReview ?? deltas?.map((delta) => delta.path) ?? []
      const freshClean: CarryFileVerdict<ClassifiedFinding>[] = []
      if (!hasFailures && deltas !== undefined) {
        for (const path of scopedPaths) {
          const delta = deltas.find((candidate) => candidate.path === path)
          if (delta !== undefined) freshClean.push({ delta, verdict: 'clean', findings: [] })
        }
      }
      const record: ReviewRecord = {
        head,
        attempt: task.currentAttempt,
        round,
        isClean: !hasFailures && carriedVerdicts.every((verdict) => verdict.verdict === 'clean'),
        findings: [...carriedVerdicts.flatMap((verdict) => verdict.findings), ...merged],
        failedChecks,
        hasDispatched: false,
        files: deltas === undefined ? undefined : [...carriedVerdicts, ...freshClean],
      }
      this.records.set(task.id, record)
      return await this.dispatch(task.id, record)
    } finally {
      admission.release()
      this.running.delete(task.id)
    }
  }
}
