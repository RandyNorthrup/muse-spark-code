import type * as z from 'zod/mini'
import { teamRetirementSchema, type TeamWriteSetLease } from '../../shared/team'
import { type SharedFiles, teamPathMatcher } from './sharedFiles'

type Attempt = TeamWriteSetLease['holder']
export interface PlannedWriteSet {
  readonly paths: readonly string[]
  readonly patterns: readonly string[]
  readonly writePaths: readonly string[] | undefined
  readonly exclusiveWriter: boolean
}

function relative(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized.includes('\0')
  )
    throw new RangeError('writes')
  return normalized
}
function prefix(pattern: string): string {
  const fixed = pattern.split(/[*?{[]/, 1)[0] ?? ''
  return process.platform === 'win32' ? fixed.toLowerCase() : fixed
}
function canOverlap(left: string, right: string): boolean {
  if (!/[*?{[]/.test(left)) return teamPathMatcher(right)(left)
  return /[*?{[]/.test(right)
    ? prefix(left).startsWith(prefix(right)) || prefix(right).startsWith(prefix(left))
    : teamPathMatcher(left)(right)
}
function canWrite(set: PlannedWriteSet, path: string): boolean {
  return (
    set.writePaths === undefined || set.writePaths.some((pattern) => teamPathMatcher(pattern)(path))
  )
}

export function expandWriteSet(
  writes: readonly string[] | undefined,
  baseFiles: readonly string[],
  writePaths?: readonly string[],
  isInPlace = false,
): PlannedWriteSet {
  const allowed = writePaths?.map((path) => relative(path))
  const patterns = (writes ?? [])
    .map((path) => relative(path))
    .filter(
      (pattern) => allowed === undefined || allowed.some((permit) => canOverlap(pattern, permit)),
    )
  const set: PlannedWriteSet = {
    patterns,
    paths: [],
    writePaths: allowed,
    exclusiveWriter:
      isInPlace ||
      (patterns.some((pattern) => pattern === '**' || pattern === '**/*') &&
        (allowed === undefined ||
          allowed.some((pattern) => pattern === '**' || pattern === '**/*'))),
  }
  const files = new Set([
    ...baseFiles.map((path) => relative(path)),
    ...patterns.filter((pattern) => !/[*?{[]/.test(pattern)),
  ])
  return {
    ...set,
    paths: [...files].filter(
      (path) => canWrite(set, path) && patterns.some((pattern) => teamPathMatcher(pattern)(path)),
    ),
  }
}

export function writeSetOverlap(
  left: PlannedWriteSet,
  right: PlannedWriteSet,
  shared: SharedFiles,
): string[] {
  if (left.exclusiveWriter || right.exclusiveWriter) return ['**']
  const paths = new Set([...left.paths, ...right.paths])
  const overlap = [...paths].filter(
    (path) =>
      shared.shouldSerialize(path) &&
      canWrite(left, path) &&
      canWrite(right, path) &&
      left.patterns.some((pattern) => teamPathMatcher(pattern)(path)) &&
      right.patterns.some((pattern) => teamPathMatcher(pattern)(path)),
  )
  for (const a of left.patterns) {
    if (!shared.shouldSerializePattern(a)) continue
    for (const b of right.patterns) {
      if (!shared.shouldSerializePattern(b) || !canOverlap(a, b)) continue
      const leftPermits = left.writePaths ?? ['**']
      const rightPermits = right.writePaths ?? ['**']
      for (const permitA of leftPermits) {
        for (const permitB of rightPermits) {
          const constraints = [a, b, permitA, permitB]
          if (
            constraints.every((pattern) => constraints.every((other) => canOverlap(pattern, other)))
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
 * no paths. S supplies retirement proof; hints never release a lease. */
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
    const normalized = relative(path)
    if (!canWrite(held.set, normalized)) throw new RangeError('write-paths')
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
  hint: FreshFileHint
  paths: string[]
  answer?: 'continue' | 'wait' | 'open'
}

/** K supplies only fresh, canonical repository hints. Collision answers have
 * no authority over trust, paid consent, caps, or the local execution leases. */
export class FileHintQuestions {
  private readonly answers = new Map<string, 'continue' | 'wait' | 'open'>()

  private key(question: FileHintQuestion): string {
    return JSON.stringify([
      question.hint.windowInstanceId,
      question.hint.repository,
      question.paths.toSorted((left, right) => left.localeCompare(right)),
    ])
  }
  questions(
    repository: string,
    ownWindow: string,
    set: PlannedWriteSet,
    hints: readonly FreshFileHint[],
    shared: SharedFiles,
  ): FileHintQuestion[] {
    const questions = hints
      .filter((hint) => hint.repository === repository && hint.windowInstanceId !== ownWindow)
      .map((hint) => ({
        hint,
        paths: hint.paths.filter(
          (path) =>
            shared.shouldSerialize(path) &&
            canWrite(set, path) &&
            (set.exclusiveWriter || set.patterns.some((pattern) => teamPathMatcher(pattern)(path))),
        ),
      }))
      .filter((question) => question.paths.length > 0)
    const live = new Set(questions.map((question) => this.key(question)))
    for (const remembered of this.answers.keys())
      if (!live.has(remembered)) this.answers.delete(remembered)
    return questions.map((question) => {
      const answer = this.answers.get(this.key(question))
      return { ...question, ...(answer !== undefined && { answer }) }
    })
  }

  answer(question: FileHintQuestion, answer: 'continue' | 'wait' | 'open'): void {
    this.answers.set(this.key(question), answer)
  }
}
