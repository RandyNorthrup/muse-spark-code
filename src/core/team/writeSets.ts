import type * as z from 'zod/mini'
import { teamRetirementSchema, type TeamWriteSetLease } from '../../shared/team'
import {
  canonicalTeamPath,
  splitDeclaredRegion,
  type SharedFiles,
  teamPathMatcher,
} from './sharedFiles'

type Attempt = TeamWriteSetLease['holder']
export interface PlannedWriteSet {
  readonly paths: readonly string[]
  readonly patterns: readonly string[]
  readonly writePaths: readonly string[] | undefined
  readonly exclusiveWriter: boolean
  readonly isCaseInsensitive: boolean
}

function prefix(pattern: string): string {
  return pattern.split(/[*?{[]/, 1)[0] ?? ''
}
function canOverlap(left: string, right: string, isCaseInsensitive: boolean): boolean {
  if (!/[*?{[]/.test(left)) return teamPathMatcher(right, isCaseInsensitive)(left)
  return /[*?{[]/.test(right)
    ? prefix(left).startsWith(prefix(right)) || prefix(right).startsWith(prefix(left))
    : teamPathMatcher(left, isCaseInsensitive)(right)
}

/** Whole-file work overlaps every region; two regions overlap only when named alike. */
function isRegionOverlap(
  left: string | undefined,
  right: string | undefined,
  isCaseInsensitive: boolean,
): boolean {
  if (left === undefined || right === undefined) return true
  return isCaseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Path overlap with validated region splits; unvalidated patterns stay whole. */
function canPatternsOverlap(a: string, b: string, shared: SharedFiles): boolean {
  const left = splitDeclaredRegion(a, shared)
  const right = splitDeclaredRegion(b, shared)
  return (
    canOverlap(left.path, right.path, shared.isCaseInsensitive) &&
    isRegionOverlap(left.region, right.region, shared.isCaseInsensitive)
  )
}

function canWrite(set: PlannedWriteSet, path: string): boolean {
  return (
    set.writePaths === undefined ||
    set.writePaths.some((pattern) => teamPathMatcher(pattern, set.isCaseInsensitive)(path))
  )
}

/** A declared region writes its file; permits never carry regions. */
function canWriteRegion(set: PlannedWriteSet, path: string, shared: SharedFiles): boolean {
  if (set.writePaths === undefined) return true
  const file = splitDeclaredRegion(path, shared).path
  return set.writePaths.some((pattern) => teamPathMatcher(pattern, set.isCaseInsensitive)(file))
}

export function expandWriteSet(
  writes: readonly string[] | undefined,
  baseFiles: readonly string[],
  writePaths?: readonly string[],
  isInPlace = false,
  isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin',
  shared?: SharedFiles,
): PlannedWriteSet {
  const allowed = writePaths?.map((path) => canonicalTeamPath(path, isCaseInsensitive))
  const isPermitted = (pattern: string, permit: string): boolean =>
    shared === undefined
      ? canOverlap(pattern, permit, isCaseInsensitive)
      : canPatternsOverlap(pattern, permit, shared)
  const patterns = (writes ?? [])
    .map((path) => canonicalTeamPath(path, isCaseInsensitive))
    .filter(
      (pattern) => allowed === undefined || allowed.some((permit) => isPermitted(pattern, permit)),
    )
  const set: PlannedWriteSet = {
    patterns,
    paths: [],
    writePaths: allowed,
    isCaseInsensitive,
    exclusiveWriter:
      isInPlace ||
      (patterns.some((pattern) => pattern === '**' || pattern === '**/*') &&
        (allowed === undefined ||
          allowed.some((pattern) => pattern === '**' || pattern === '**/*'))),
  }
  const files = new Set([
    ...baseFiles.map((path) => canonicalTeamPath(path, isCaseInsensitive)),
    ...patterns.filter((pattern) => !/[*?{[]/.test(pattern)),
  ])
  // Without a table there are no regions: M96c's matching runs exactly.
  const isWritable = (path: string): boolean =>
    shared === undefined ? canWrite(set, path) : canWriteRegion(set, path, shared)
  const isCovered = (path: string): boolean =>
    patterns.some((pattern) =>
      shared === undefined
        ? teamPathMatcher(pattern, isCaseInsensitive)(path)
        : canPatternsOverlap(pattern, path, shared),
    )
  return {
    ...set,
    paths: [...files].filter((path) => isWritable(path) && isCovered(path)),
  }
}

export function writeSetOverlap(
  left: PlannedWriteSet,
  right: PlannedWriteSet,
  shared: SharedFiles,
): string[] {
  if (left.exclusiveWriter || right.exclusiveWriter) return ['**']
  const paths = new Set([...left.paths, ...right.paths])
  const overlap = [...paths].filter((path) => {
    // The file's own rule governs: regions lease under it, never past it.
    const file = splitDeclaredRegion(path, shared).path
    return (
      shared.shouldSerialize(file) &&
      canWriteRegion(left, path, shared) &&
      canWriteRegion(right, path, shared) &&
      left.patterns.some((pattern) => canPatternsOverlap(pattern, path, shared)) &&
      right.patterns.some((pattern) => canPatternsOverlap(pattern, path, shared))
    )
  })
  for (const a of left.patterns) {
    if (!shared.shouldSerializePattern(splitDeclaredRegion(a, shared).path)) continue
    for (const b of right.patterns) {
      if (
        !shared.shouldSerializePattern(splitDeclaredRegion(b, shared).path) ||
        !canPatternsOverlap(a, b, shared)
      )
        continue
      const leftPermits = left.writePaths ?? ['**']
      const rightPermits = right.writePaths ?? ['**']
      for (const permitA of leftPermits) {
        for (const permitB of rightPermits) {
          const constraints = [a, b, permitA, permitB]
          if (
            constraints.every((pattern) =>
              constraints.every((other) => canPatternsOverlap(pattern, other, shared)),
            )
          )
            overlap.push(prefix(a).length >= prefix(b).length ? a : b)
        }
      }
    }
  }
  return [...new Set(overlap)]
}

interface Held {
  lease: TeamWriteSetLease
  set: PlannedWriteSet
  family: string
}
export type LeaseResult =
  | { kind: 'acquired'; lease: TeamWriteSetLease }
  | { kind: 'wait'; holder: Attempt; paths: string[] }
  | { kind: 'stale' }
type GrowthResult =
  Exclude<LeaseResult, { kind: 'wait' }> | { kind: 'conflict'; holder: Attempt; paths: string[] }

function key(attempt: Attempt): string {
  return JSON.stringify([attempt.taskId, attempt.attempt])
}
function isSame(left: Attempt, right: Attempt): boolean {
  return key(left) === key(right)
}

/** One instance per window. Empty plans are observed as writers but lease
no paths. S supplies retirement proof; hints never release a lease. */
export class WriteSetLeases {
  private readonly held = new Map<string, Held>()
  private readonly latest = new Map<string, number>()
  private readonly families = new Map<string, string>()

  constructor(
    private readonly workspaceId: string,
    private readonly shared: SharedFiles,
  ) {}

  acquire(
    holder: Attempt,
    set: PlannedWriteSet,
    overlap: 'serialize' | 'allow' = 'serialize',
    inheritedFrom?: Attempt,
    inheritance: 'child' | 'pipeline' = 'child',
  ): LeaseResult {
    const existing = this.held.get(holder.taskId)
    if (existing !== undefined && isSame(existing.lease.holder, holder))
      return { kind: 'acquired', lease: existing.lease }
    if (existing !== undefined || holder.attempt <= (this.latest.get(holder.taskId) ?? 0))
      return { kind: 'stale' }
    const parent = inheritedFrom === undefined ? undefined : this.held.get(inheritedFrom.taskId)
    let parentFamily: string | undefined
    if (inheritedFrom !== undefined) {
      if (parent !== undefined && isSame(parent.lease.holder, inheritedFrom))
        parentFamily = parent.family
      else if (
        inheritance === 'pipeline' &&
        this.latest.get(inheritedFrom.taskId) === inheritedFrom.attempt
      )
        parentFamily = this.families.get(inheritedFrom.taskId)
    }
    if (inheritedFrom !== undefined && parentFamily === undefined) return { kind: 'stale' }
    const family = parentFamily ?? key(holder)
    for (const held of this.held.values()) {
      if (held.family === family) continue
      const paths = writeSetOverlap(set, held.set, this.shared)
      if (
        paths.length > 0 &&
        (overlap === 'serialize' || set.exclusiveWriter || held.set.exclusiveWriter)
      )
        return { kind: 'wait', holder: held.lease.holder, paths }
    }
    const lease: TeamWriteSetLease = {
      workspaceId: this.workspaceId,
      holder,
      paths: [...set.paths],
      exclusiveWriter: set.exclusiveWriter,
      ...(inheritedFrom !== undefined && { inheritedFrom }),
    }
    this.held.set(holder.taskId, { lease, set, family })
    this.latest.set(holder.taskId, holder.attempt)
    this.families.set(holder.taskId, family)
    return { kind: 'acquired', lease }
  }

  grow(holder: Attempt, path: string): GrowthResult {
    const held = this.held.get(holder.taskId)
    if (held === undefined || !isSame(held.lease.holder, holder)) return { kind: 'stale' }
    const normalized = canonicalTeamPath(path, held.set.isCaseInsensitive)
    if (!canWriteRegion(held.set, normalized, this.shared)) throw new RangeError('write-paths')
    for (const other of this.held.values()) {
      if (
        other.family !== held.family &&
        writeSetOverlap(
          { ...held.set, paths: [normalized], patterns: [normalized] },
          other.set,
          this.shared,
        ).length > 0
      )
        return { kind: 'conflict', holder: other.lease.holder, paths: [normalized] }
    }
    held.set = {
      ...held.set,
      paths: [...new Set([...held.set.paths, normalized])],
      patterns: [...new Set([...held.set.patterns, normalized])],
    }
    held.lease = { ...held.lease, paths: [...held.set.paths] }
    return { kind: 'acquired', lease: held.lease }
  }

  /** The scheduler withdraws only a reservation whose worker was never invoked. */
  withdraw(holder: Attempt): boolean {
    const held = this.held.get(holder.taskId)
    if (held === undefined || !isSame(held.lease.holder, holder)) return false
    this.held.delete(holder.taskId)
    this.latest.delete(holder.taskId)
    this.families.delete(holder.taskId)
    return true
  }

  release(holder: Attempt, retirement: z.infer<typeof teamRetirementSchema>): boolean {
    teamRetirementSchema.parse(retirement)
    const held = this.held.get(holder.taskId)
    return (
      held !== undefined && isSame(held.lease.holder, holder) && this.held.delete(holder.taskId)
    )
  }

  transfer(holder: Attempt, replacement: Attempt): boolean {
    const held = this.held.get(holder.taskId)
    if (
      held === undefined ||
      !isSame(held.lease.holder, holder) ||
      replacement.taskId !== holder.taskId ||
      replacement.attempt <= holder.attempt
    )
      return false
    held.lease = { ...held.lease, holder: replacement }
    this.latest.set(replacement.taskId, replacement.attempt)
    return true
  }

  snapshot(): TeamWriteSetLease[] {
    const leases: TeamWriteSetLease[] = []
    for (const held of this.held.values()) {
      if (held.set.patterns.length === 0 && !held.set.exclusiveWriter) continue
      leases.push({ ...held.lease, holder: { ...held.lease.holder }, paths: [...held.lease.paths] })
    }
    return leases
  }
}

export interface FreshFileHint {
  windowInstanceId: string
  repository: string
  paths: readonly string[]
}
export interface FileHintQuestion {
  ownWindow: string
  hint: FreshFileHint
  paths: string[]
  answer?: 'continue' | 'wait' | 'open'
}

/** K supplies only fresh, canonical repository hints. Collision answers have
no authority over trust, paid consent, caps, or the local execution leases. */
export class FileHintQuestions {
  private readonly answers = new Map<
    string,
    { question: FileHintQuestion; answer: 'continue' | 'wait' | 'open' }
  >()

  private key(question: FileHintQuestion, path: string): string {
    return JSON.stringify([
      question.ownWindow,
      question.hint.windowInstanceId,
      question.hint.repository,
      path,
    ])
  }
  questions(
    repository: string,
    ownWindow: string,
    set: PlannedWriteSet,
    hints: readonly FreshFileHint[],
    shared: SharedFiles,
  ): FileHintQuestion[] {
    const fresh = hints
      .filter((hint) => hint.repository === repository && hint.windowInstanceId !== ownWindow)
      .map((hint) => ({
        ...hint,
        paths: [
          ...new Set(hint.paths.map((path) => canonicalTeamPath(path, set.isCaseInsensitive))),
        ],
      }))
    // Expiry follows the complete fresh hint snapshot, never this task's
    // filtered overlap. Other repositories/windows retain their own answers.
    const live = new Set(
      fresh.flatMap((hint) =>
        hint.paths.map((path) => this.key({ ownWindow, hint, paths: [] }, path)),
      ),
    )
    for (const [identity, remembered] of this.answers)
      if (
        remembered.question.ownWindow === ownWindow &&
        remembered.question.hint.repository === repository &&
        !live.has(identity)
      )
        this.answers.delete(identity)
    const questions = fresh
      .map((hint) => ({
        ownWindow,
        hint,
        // Hints stay path-granular: any shared file asks, whatever the regions.
        paths: hint.paths.filter((path) => {
          const file = splitDeclaredRegion(path, shared).path
          return (
            shared.shouldSerialize(file) &&
            canWriteRegion(set, path, shared) &&
            (set.exclusiveWriter ||
              set.patterns.some((pattern) =>
                canOverlap(splitDeclaredRegion(pattern, shared).path, file, set.isCaseInsensitive),
              ))
          )
        }),
      }))
      .filter((question) => question.paths.length > 0)
    return questions.map((question) => {
      const answer = this.answers.get(this.key(question, question.paths[0] ?? ''))?.answer
      const isSameAnswer = question.paths.every(
        (path) => this.answers.get(this.key(question, path))?.answer === answer,
      )
      return { ...question, ...(answer !== undefined && isSameAnswer && { answer }) }
    })
  }

  answer(question: FileHintQuestion, answer: 'continue' | 'wait' | 'open'): void {
    for (const path of question.paths)
      this.answers.set(this.key(question, path), { question, answer })
  }
}
