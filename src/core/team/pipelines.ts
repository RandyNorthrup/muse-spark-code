// Team pipelines: saved flows the orchestrator or the user starts (M96,
// PLAN.md D75 "Pipelines"). A pipeline is a template of dependent tasks run
// on the scheduler's board; this module holds the built-ins, the file
// loading, the round counting with its `redesign` bound, and the hand-off to
// the orchestrator's `merge`. It never merges: the terminal `handoff`
// decision carries the reviewed branch for the orchestrator, and there is no
// merge step kind, no merge transition and no merge dependency anywhere in
// this module. Pure over injected file access; no `vscode` import.
//
// Seams to parallel lanes (explicit interfaces, never fakes): the step
// results below are recorded by lane T's tools and lane W's workers; the
// ledger rows lane A's ledger writes are read by `teamHistory.ts`; the role
// ids come from lane R's built-in roles. The `maxRounds` and severity
// defaults live here until lane 0 hoists them to `TEAM_*` constants.

import * as z from 'zod/mini'
import { REVIEW_SEVERITIES, type ReviewSeverity } from '../../shared/constants'
import { knownSeverity } from '../../shared/reviewFindings'

/** Rounds are bounded by the owner's own rule: the third failed round stops at `redesign`. */
export const PIPELINE_MAX_ROUNDS = 3
/** Review findings at or above this severity send the change back (D75). */
export const PIPELINE_DEFAULT_SEVERITY: ReviewSeverity = 'high'

export const PIPELINE_STEP_KINDS = ['work', 'review', 'check'] as const
export type PipelineStepKind = (typeof PIPELINE_STEP_KINDS)[number]

/** The two flows D75 builds in. */
export const BUILT_IN_PIPELINE_IDS = ['change', 'spec'] as const
export type BuiltInPipelineId = (typeof BUILT_IN_PIPELINE_IDS)[number]

const stepSchema = z.object({
  id: z.string(),
  role: z.string(),
  kind: z.enum(PIPELINE_STEP_KINDS),
})

const definitionSchema = z.object({
  id: z.string(),
  steps: z.array(stepSchema),
  maxRounds: z.int().check(z.gte(1), z.lte(PIPELINE_MAX_ROUNDS)),
  reviewSeverity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
})

/** One step of a pipeline: a role's task of one kind. */
export type PipelineStep = z.infer<typeof stepSchema>

/** A pipeline template: ordered steps, a round bound and a review threshold. */
export type PipelineDefinition = z.infer<typeof definitionSchema>

/** A review finding as the pipeline reads it: only the severity decides a loop-back. */
export interface PipelineFinding {
  readonly title: string
  readonly severity: string | undefined
}

/** What a finished step reports back to the pipeline run. */
export type PipelineStepResult =
  | {
      readonly kind: 'work-done'
      readonly stepId: string
      readonly branch: string
      readonly report: string
    }
  | {
      readonly kind: 'reviewed'
      readonly stepId: string
      readonly branch: string
      readonly findings: readonly PipelineFinding[]
      readonly report: string
    }
  | {
      readonly kind: 'checked'
      readonly stepId: string
      readonly branch: string
      readonly passed: boolean
      readonly findings: readonly PipelineFinding[]
      readonly report: string
    }

/** The pipeline run's own state: the step, the round and every report so far. */
export interface PipelineRun {
  readonly pipelineId: string
  readonly brief: string
  readonly stepIndex: number
  readonly round: number
  readonly branch: string | undefined
  readonly reports: readonly PipelineStepReport[]
  readonly roundFindings: readonly (readonly PipelineFinding[])[]
  readonly status: 'running' | 'redesign' | 'handoff'
}

export interface PipelineStepReport {
  readonly stepId: string
  readonly role: string
  readonly round: number
  readonly report: string
}

/** What recording a step result decides: the next step, a loop-back, `redesign` or the merge hand-off. */
export type PipelineDecision =
  | { readonly status: 'next'; readonly step: PipelineStep }
  | {
      readonly status: 'repeat'
      readonly step: PipelineStep
      readonly round: number
      readonly findings: readonly PipelineFinding[]
    }
  | {
      readonly status: 'redesign'
      readonly findings: readonly PipelineFinding[]
      readonly recurring: readonly PipelineFinding[]
    }
  | {
      readonly status: 'handoff'
      readonly branch: string
      readonly reports: readonly PipelineStepReport[]
      readonly roundsUsed: number
    }

/** Why a pipeline file or definition was refused. Codes, never sentences. */
export type PipelineRefusalReason =
  | 'unparseable'
  | 'unknownKey'
  | 'invalid'
  | 'noWorkStep'
  | 'danglingReview'
  | 'unknownPipeline'
  | 'duplicateId'
  | 'widensRounds'
  | 'widensSteps'

export interface PipelineRefusal {
  readonly file: string
  readonly reason: PipelineRefusalReason
  /** Technical detail: the zod message, the key or the step id. */
  readonly detail: string
}

export interface PipelineFileSystem {
  readonly listFiles: (dir: string) => readonly string[]
  readonly readFile: (path: string) => string | undefined
}

/** Recording a result on a run that already ended. */
export class PipelineTerminalError extends Error {
  public override readonly name = 'PipelineTerminalError'
  public constructor(public readonly status: 'redesign' | 'handoff') {
    super(`pipeline already ${status}`)
  }
}

/** A step result for a step that is not the run's current step. */
export class PipelineStepError extends Error {
  public override readonly name = 'PipelineStepError'
  public constructor(
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`expected step ${expected}, got ${received}`)
  }
}

/** A result whose kind does not belong to the run's current step: a review step's findings and a check step's pass/fail cannot come from a `work-done` result, and a work step cannot be satisfied by a review or check result. */
export class PipelineResultError extends Error {
  public override readonly name = 'PipelineResultError'
  public constructor(
    public readonly stepId: string,
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`step ${stepId} takes ${expected}, got ${received}`)
  }
}

/** A result whose branch differs from the run's branch: every round stays on one branch. */
export class PipelineBranchError extends Error {
  public override readonly name = 'PipelineBranchError'
  public constructor(
    public readonly expected: string,
    public readonly received: string,
  ) {
    super(`expected branch ${expected}, got ${received}`)
  }
}

// Least to most severe: `REVIEW_SEVERITIES` lists them most-first.
const SEVERITY_ORDER: readonly ReviewSeverity[] = [...REVIEW_SEVERITIES].toReversed()

/**
 * Whether a finding sends the change back: at or above the threshold. A
 * severity the model made up (no known word) counts as failing: sending a
 * change of unknown severity back for rework is safer than merging it.
 */
export function isFailingSeverity(
  severity: string | undefined,
  threshold: ReviewSeverity,
): boolean {
  const known = knownSeverity(severity)
  return known === undefined || SEVERITY_ORDER.indexOf(known) >= SEVERITY_ORDER.indexOf(threshold)
}

/** The built-in **Change** flow: engineering, code-review, qa, then the orchestrator's merge. */
export function changePipeline(): PipelineDefinition {
  return {
    id: 'change',
    steps: [
      { id: 'implement', role: 'engineering', kind: 'work' },
      { id: 'review', role: 'code-review', kind: 'review' },
      { id: 'verify', role: 'qa', kind: 'check' },
    ],
    maxRounds: PIPELINE_MAX_ROUNDS,
    reviewSeverity: PIPELINE_DEFAULT_SEVERITY,
  }
}

/** The built-in **Spec** flow: research, then design. No review step, so it runs straight through. */
export function specPipeline(): PipelineDefinition {
  return {
    id: 'spec',
    steps: [
      { id: 'research', role: 'research', kind: 'work' },
      { id: 'design', role: 'design', kind: 'work' },
    ],
    maxRounds: PIPELINE_MAX_ROUNDS,
    reviewSeverity: PIPELINE_DEFAULT_SEVERITY,
  }
}

/** Both built-ins, in order. */
export function builtInPipelines(): readonly PipelineDefinition[] {
  return [changePipeline(), specPipeline()]
}

/**
 * Validate a parsed definition's shape beyond the schema: at least one step,
 * at least one work step, and every review or check step after a work step
 * (a loop-back needs a writer to send the change back to).
 */
export function validatePipeline(def: PipelineDefinition): PipelineRefusalReason | undefined {
  if (def.steps.length === 0) {
    return 'invalid'
  }
  const firstWork = def.steps.findIndex((step) => step.kind === 'work')
  if (firstWork === -1) {
    return 'noWorkStep'
  }
  let isSeenWork = false
  for (const step of def.steps) {
    if (step.kind === 'work') {
      isSeenWork = true
    } else if (!isSeenWork) {
      return 'danglingReview'
    }
  }
  return undefined
}

/** The index of the step a loop-back returns to: the first work step. */
export function reworkStepIndex(def: PipelineDefinition): number {
  const index = def.steps.findIndex((step) => step.kind === 'work')
  return index === -1 ? 0 : index
}

/** Start a run: at the first step, in round one. */
export function startPipelineRun(def: PipelineDefinition, brief: string): PipelineRun {
  return {
    pipelineId: def.id,
    brief,
    stepIndex: 0,
    round: 1,
    branch: undefined,
    reports: [],
    roundFindings: [],
    status: 'running',
  }
}

/** The run's current step. */
export function currentStep(def: PipelineDefinition, run: PipelineRun): PipelineStep {
  const step = def.steps[run.stepIndex]
  if (step === undefined) {
    throw new PipelineStepError(`index ${String(run.stepIndex)}`, 'end')
  }
  return step
}

/** A step's input is the brief and the earlier steps' reports; never the conversation. */
export function stepInput(run: PipelineRun): {
  readonly brief: string
  readonly priorReports: readonly PipelineStepReport[]
} {
  return { brief: run.brief, priorReports: run.reports }
}

function failing(
  findings: readonly PipelineFinding[],
  threshold: ReviewSeverity,
): readonly PipelineFinding[] {
  return findings.filter((finding) => isFailingSeverity(finding.severity, threshold))
}

/** Findings of the final failed round also seen in an earlier round, matched by title. */
function recurringFindings(
  rounds: readonly (readonly PipelineFinding[])[],
): readonly PipelineFinding[] {
  if (rounds.length === 0) {
    return []
  }
  const last = rounds.at(-1)
  if (last === undefined) {
    return []
  }
  const earlier = new Set<string>()
  const earlierRounds = rounds.slice(0, -1)
  for (const round of earlierRounds) {
    for (const finding of round) {
      earlier.add(finding.title)
    }
  }
  return last.filter((finding) => earlier.has(finding.title))
}

/** The one result kind each step kind accepts: work proves itself done, review brings findings, check brings its pass or fail. */
const EXPECTED_RESULT_KIND: Record<PipelineStepKind, PipelineStepResult['kind']> = {
  work: 'work-done',
  review: 'reviewed',
  check: 'checked',
}

/**
 * Record a finished step and move the run. The result's kind must belong to
 * the current step (`work-done` for work, `reviewed` for review, `checked`
 * for check); anything else throws, so a bare `work-done` can never stand
 * in for the review's findings or the check's pass/fail. A failing review
 * (findings at or above the threshold) or a failed check loops back to the
 * first work step on the same branch with the findings; the round past
 * `maxRounds` stops at `redesign`, naming the findings that came back. The
 * last step's success hands the reviewed branch to the orchestrator's
 * `merge`: this module never merges by itself. Returns the updated run and
 * the decision.
 */
export function recordStepResult(
  def: PipelineDefinition,
  run: PipelineRun,
  result: PipelineStepResult,
): { readonly run: PipelineRun; readonly decision: PipelineDecision } {
  if (run.status !== 'running') {
    throw new PipelineTerminalError(run.status)
  }
  const step = currentStep(def, run)
  if (result.stepId !== step.id) {
    throw new PipelineStepError(step.id, result.stepId)
  }
  const expectedKind = EXPECTED_RESULT_KIND[step.kind]
  if (result.kind !== expectedKind) {
    throw new PipelineResultError(step.id, expectedKind, result.kind)
  }
  if (run.branch !== undefined && result.branch !== run.branch) {
    throw new PipelineBranchError(run.branch, result.branch)
  }
  const branch = run.branch ?? result.branch
  const report: PipelineStepReport = {
    stepId: step.id,
    role: step.role,
    round: run.round,
    report: result.report,
  }
  const reports = [...run.reports, report]

  if (result.kind === 'work-done') {
    return advance(def, { ...run, branch, reports })
  }
  const failedFindings = failing(result.findings, def.reviewSeverity)
  const isCheckFailed = result.kind === 'checked' && !result.passed
  if (!isCheckFailed && failedFindings.length === 0) {
    return advance(def, { ...run, branch, reports })
  }
  const roundFindings = [...run.roundFindings, result.findings]
  if (run.round >= def.maxRounds) {
    const finished: PipelineRun = { ...run, branch, reports, roundFindings, status: 'redesign' }
    const findings = result.findings
    return {
      run: finished,
      decision: { status: 'redesign', findings, recurring: recurringFindings(roundFindings) },
    }
  }
  const rework = reworkStepIndex(def)
  const reworkStep = def.steps[rework]
  if (reworkStep === undefined) {
    throw new PipelineStepError('rework step', 'end')
  }
  const repeated: PipelineRun = {
    ...run,
    branch,
    reports,
    roundFindings,
    stepIndex: rework,
    round: run.round + 1,
  }
  return {
    run: repeated,
    decision: {
      status: 'repeat',
      step: reworkStep,
      round: repeated.round,
      findings: result.findings,
    },
  }
}

function advance(
  def: PipelineDefinition,
  run: PipelineRun,
): { readonly run: PipelineRun; readonly decision: PipelineDecision } {
  const nextIndex = run.stepIndex + 1
  const next = def.steps[nextIndex]
  if (next === undefined) {
    if (run.branch === undefined) {
      throw new PipelineBranchError('a branch from a work step', 'none')
    }
    const finished: PipelineRun = { ...run, status: 'handoff' }
    return {
      run: finished,
      decision: {
        status: 'handoff',
        branch: run.branch,
        reports: run.reports,
        roundsUsed: run.round,
      },
    }
  }
  const moved: PipelineRun = { ...run, stepIndex: nextIndex }
  return { run: moved, decision: { status: 'next', step: next } }
}

/**
 * One approval covers the whole pipeline: the steps with each step's first
 * entry. Structured data for lane T's card; no sentences.
 */
export function approvalSteps(
  def: PipelineDefinition,
  firstEntries: readonly (string | undefined)[],
): readonly {
  readonly stepId: string
  readonly role: string
  readonly firstEntry: string | undefined
}[] {
  return def.steps.map((step, index) => ({
    stepId: step.id,
    role: step.role,
    firstEntry: firstEntries[index],
  }))
}

/**
 * The approval's ceiling: each step's ceiling times the rounds. Lengths must
 * match the steps.
 */
export function pipelineCeiling(def: PipelineDefinition, stepCeilings: readonly number[]): number {
  if (stepCeilings.length !== def.steps.length) {
    throw new PipelineStepError(`${String(def.steps.length)} ceilings`, String(stepCeilings.length))
  }
  return stepCeilings.reduce((total, ceiling) => total + ceiling * def.maxRounds, 0)
}

const DEFINITION_KEYS = new Set(['id', 'steps', 'maxRounds', 'reviewSeverity'])
const STEP_KEYS = new Set(['id', 'role', 'kind'])

function unknownKey(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return key
    }
  }
  return undefined
}

function parseDefinition(file: string, json: string): PipelineDefinition | PipelineRefusal {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return { file, reason: 'unparseable', detail: 'not JSON' }
  }
  const badTop = unknownKey(parsed, DEFINITION_KEYS)
  if (badTop !== undefined) {
    return { file, reason: 'unknownKey', detail: badTop }
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as { steps?: unknown }).steps)
  ) {
    for (const step of (parsed as { steps: unknown[] }).steps) {
      const badStep = unknownKey(step, STEP_KEYS)
      if (badStep !== undefined) {
        return { file, reason: 'unknownKey', detail: `steps: ${badStep}` }
      }
    }
  }
  const result = definitionSchema.safeParse(parsed)
  if (!result.success) {
    return { file, reason: 'invalid', detail: 'schema mismatch' }
  }
  const semantic = validatePipeline(result.data)
  return semantic === undefined ? result.data : { file, reason: semantic, detail: result.data.id }
}

const NARROWING_KEYS = new Set(['id', 'maxRounds', 'removeSteps'])

const narrowingSchema = z.object({
  id: z.string(),
  maxRounds: z.optional(z.int().check(z.gte(1), z.lte(PIPELINE_MAX_ROUNDS))),
  removeSteps: z.optional(z.array(z.string())),
})

/**
 * A project file may only lower the rounds or remove steps of a pipeline the
 * user has. Anything else — an unknown id, raised rounds, added or changed
 * steps, an unknown key — refuses the file whole.
 */
function applyNarrowing(
  file: string,
  base: PipelineDefinition,
  json: string,
): PipelineDefinition | PipelineRefusal {
  let parsed: unknown
  try {
    parsed = JSON.parse(json) as unknown
  } catch {
    return { file, reason: 'unparseable', detail: 'not JSON' }
  }
  const badKey = unknownKey(parsed, NARROWING_KEYS)
  if (badKey !== undefined) {
    return { file, reason: 'unknownKey', detail: badKey }
  }
  const result = narrowingSchema.safeParse(parsed)
  if (!result.success || result.data.id !== base.id) {
    return { file, reason: result.success ? 'unknownPipeline' : 'invalid', detail: base.id }
  }
  const maxRounds = result.data.maxRounds ?? base.maxRounds
  if (maxRounds > base.maxRounds) {
    return {
      file,
      reason: 'widensRounds',
      detail: `${String(maxRounds)} over ${String(base.maxRounds)}`,
    }
  }
  const omittedSteps = result.data.removeSteps ?? []
  for (const id of omittedSteps) {
    if (base.steps.every((step) => step.id !== id)) {
      return { file, reason: 'widensSteps', detail: id }
    }
  }
  const omitted = new Set(omittedSteps)
  const steps = base.steps.filter((step) => !omitted.has(step.id))
  const narrowed: PipelineDefinition = { ...base, maxRounds, steps }
  const semantic = validatePipeline(narrowed)
  return semantic === undefined ? narrowed : { file, reason: semantic, detail: narrowed.id }
}

/**
 * Load every pipeline: the built-ins, the user's personal folder
 * (`<config>/muse/pipelines/`, full definitions or narrowing replacements),
 * then the project's `.muse/pipelines/` in a trusted workspace, which may
 * only narrow a pipeline the user has. Refused files are reported, never
 * thrown.
 */
export function loadPipelines(args: {
  readonly personalDir: string
  readonly projectDir: string
  readonly trusted: boolean
  readonly fs: PipelineFileSystem
}): {
  readonly pipelines: readonly PipelineDefinition[]
  readonly refused: readonly PipelineRefusal[]
} {
  const byId: Record<string, PipelineDefinition> = {}
  for (const builtIn of builtInPipelines()) {
    byId[builtIn.id] = builtIn
  }
  const refused: PipelineRefusal[] = []
  for (const name of args.fs.listFiles(args.personalDir)) {
    if (!name.endsWith('.json')) {
      continue
    }
    const file = joinPath(args.personalDir, name)
    const text = args.fs.readFile(file)
    if (text === undefined) {
      continue
    }
    const parsed = parseDefinition(file, text)
    if ('reason' in parsed) {
      refused.push(parsed)
    } else {
      byId[parsed.id] = parsed
    }
  }
  if (args.trusted) {
    for (const name of args.fs.listFiles(args.projectDir)) {
      if (!name.endsWith('.json')) {
        continue
      }
      const file = joinPath(args.projectDir, name)
      const text = args.fs.readFile(file)
      if (text === undefined) {
        continue
      }
      let id: string | undefined
      try {
        id = (JSON.parse(text) as { id?: unknown }).id as string | undefined
      } catch {
        refused.push({ file, reason: 'unparseable', detail: 'not JSON' })
        continue
      }
      const base: PipelineDefinition | undefined = typeof id === 'string' ? byId[id] : undefined
      if (base === undefined) {
        refused.push({
          file,
          reason: 'unknownPipeline',
          detail: typeof id === 'string' ? id : 'missing id',
        })
        continue
      }
      const narrowed = applyNarrowing(file, base, text)
      if ('reason' in narrowed) {
        refused.push(narrowed)
      } else {
        byId[narrowed.id] = narrowed
      }
    }
  }
  return { pipelines: Object.values(byId), refused }
}

function joinPath(dir: string, name: string): string {
  return `${dir}/${name}`
}
