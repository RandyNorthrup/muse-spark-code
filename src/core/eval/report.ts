import { Usd, legacyUsdSchema, type UsdAmount } from '../../shared/usd'
// The M75 report (PLAN.md D49): per-task results per arm, per-split
// summaries with attempts, tokens, cost and pass rate, the capability floors
// with the verdict, and the JSON and Markdown the live run writes to
// docs/certification/.

import * as z from 'zod/mini'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { EVAL_COST_DECIMALS, EVAL_REPORT_VERSION, EVAL_SPLITS } from '../../shared/constants'

export const EVAL_VERDICTS = ['pass', 'fail', 'incomplete'] as const
// CommonMark's shortest code fence.
const MIN_FENCE_LENGTH = 3

/** What the trace counts, per task and per split. */
const evalCountFields = {
  /** Model calls sent, counted from the trace, retries included. */
  attempts: z.number(),
  /** Every request sent to the Model API, the model calls included. */
  requests: z.number(),
  inputTokens: z.number(),
  cachedTokens: z.number(),
  outputTokens: z.number(),
  costUsd: legacyUsdSchema,
}

const compactionLedgerSchema = z.object({
  /** Cumulative accepted reservations, not simultaneous headroom. */
  reservedUsd: legacyUsdSchema,
  /** Known settlements only; already included in trace cost, never added twice. */
  settledUsd: legacyUsdSchema,
  outstandingUsd: legacyUsdSchema,
  /** Unknown settlements retain this liability and stop the run. */
  retainedUsd: legacyUsdSchema,
})
const requestEvidenceSchema = z.object({
  sha256: z.string(),
  packageTypeModuleVisible: z.boolean(),
  /** Only tools offered on this request; unknown names become the fixed marker other. */
  responseTools: z.array(z.string()),
  /** Number of unknown returned names, without retaining any of their text. */
  otherTools: z.optional(z.number().check(z.int(), z.minimum(0))),
})

const evalTaskFields = {
  taskId: z.string(),
  title: z.string(),
  split: z.enum(EVAL_SPLITS),
  passed: z.boolean(),
  /** The host's terminal for the turn, or `timedOut`. */
  terminal: z.string(),
  /** Why it failed: the turn's reason, the verifier's output, refusals. */
  failures: z.array(z.string()),
  ...evalCountFields,
  toolCalls: z.number(),
  /** Cards allowed once (shell commands, protected writes). */
  approvals: z.number(),
}

export const evalTaskResultSchema = z.object({
  ...evalTaskFields,
  /** Questions the model asked, each answered "proceed". */
  questions: z.number(),
  /** Paid uses the harness asked for, each refused. */
  paidRefusals: z.number(),
  /** Where this arm's run of the task fell among the arms: 1 when it went first. */
  order: z.number(),
  /** The packing ledger's estimate (M73); absent where nothing packed. */
  packedTokensAvoided: z.optional(z.number()),
  /** `recall_output` calls that succeeded (M73); absent in reports made before it. */
  recalls: z.optional(z.number()),
  /**
   * Released D78 claims, including rejected and failed attempts. This is
   * attempt accounting, never evidence of accepted history replacement.
   */
  compactionsSettled: z.optional(z.number()),
  /** Host accepted the summary and replaced history; rejected attempts never count. */
  compactionsApplied: z.optional(z.number()),
  callBudget: z.optional(z.number()),
  overBudget: z.optional(z.boolean()),
  compactionsAttempted: z.optional(z.number()),
  compactionLedger: z.optional(compactionLedgerSchema),
  requestEvidence: z.optional(z.array(requestEvidenceSchema)),
})
export type EvalTaskResult = z.infer<typeof evalTaskResultSchema>

// Version 1 never recorded these. A value cannot be relabelled as legacy.
const legacyTaskResultSchema = z.object({
  ...evalTaskFields,
  questions: z.optional(z.never()),
  paidRefusals: z.optional(z.never()),
  order: z.optional(z.never()),
  packedTokensAvoided: z.optional(z.never()),
  recalls: z.optional(z.never()),
  compactionsSettled: z.optional(z.never()),
  compactionsApplied: z.optional(z.never()),
  compactionsAttempted: z.optional(z.never()),
  compactionLedger: z.optional(z.never()),
  requestEvidence: z.optional(z.never()),
})

export const evalSplitSummarySchema = z.object({
  split: z.enum(EVAL_SPLITS),
  tasks: z.number(),
  passed: z.number(),
  passRate: z.number(),
  ...evalCountFields,
})
export type EvalSplitSummary = z.infer<typeof evalSplitSummarySchema>

const evalArmFields = {
  name: z.string(),
  /** What the mechanism arm changes; absent on the baseline arm. */
  mechanism: z.optional(z.string()),
  summaries: z.array(evalSplitSummarySchema),
}

export const evalArmReportSchema = z.object({
  ...evalArmFields,
  results: z.array(evalTaskResultSchema),
  compactionLedger: z.optional(compactionLedgerSchema),
})
export type EvalArmReport = z.infer<typeof evalArmReportSchema>

export const evalFloorResultSchema = z.object({
  arm: z.string(),
  split: z.enum(EVAL_SPLITS),
  tasks: z.number(),
  passRate: z.number(),
  floor: z.number(),
  /** False for a split that did not run: no evidence holds no floor. */
  held: z.boolean(),
})
export type EvalFloorResult = z.infer<typeof evalFloorResultSchema>

const evalReportFields = {
  model: z.string(),
  generatedAt: z.string(),
  floors: z.array(evalFloorResultSchema),
  /**
   * `incomplete`: a narrowed selection, empty split or global stop leaves evidence incomplete.
   * `fail`: a floor fell, or a mechanism's own acceptance failed (M73's
   * packing engagement or lane E's compaction engagement, below).
   */
  verdict: z.enum(EVAL_VERDICTS),
}

/**
 * M73's acceptance beside the floors: the packing arm sent a packed
 * placeholder on every long-output task it ran. A run that holds the floors
 * without packing proves nothing about packing, so it fails the run.
 */
const evalPackingEngagementSchema = z.object({
  arm: z.string(),
  /** The long-output tasks the run selected. */
  longOutputTasks: z.array(z.string()),
  /** Those on which the arm never sent a placeholder. */
  unengaged: z.array(z.string()),
  held: z.boolean(),
})

/**
 * Lane E's acceptance beside the floors: the D78 admission settled a
 * summary on every long-context task the auto-compaction arm ran (R2: the
 * runner's settled-admission count per task — more model calls than the
 * baseline is not evidence). A run that holds the floors without a
 * settled compaction proves nothing about compaction, so it fails the
 * run. A selection with no long-context task holds nothing: it is
 * incomplete, never a pass.
 */
const evalCompactionEngagementSchema = z.object({
  arm: z.string(),
  /** The long-context tasks the run selected. */
  longContextTasks: z.array(z.string()),
  /** Those on which the admission settled no summary. */
  unengaged: z.array(z.string()),
  held: z.boolean(),
})

export const evalReportSchema = z.discriminatedUnion('version', [
  z.object({
    ...evalReportFields,
    version: z.literal(1),
    arms: z.array(z.object({ ...evalArmFields, results: z.array(legacyTaskResultSchema) })),
  }),
  z.object({
    ...evalReportFields,
    version: z.literal(EVAL_REPORT_VERSION),
    arms: z.array(evalArmReportSchema),
    /** Recorded by a run with a packing arm (M73); absent otherwise. */
    packingEngagement: z.optional(evalPackingEngagementSchema),
    /** Recorded by a run with an auto-compaction arm (M101 lane E); absent otherwise. */
    compactionEngagement: z.optional(evalCompactionEngagementSchema),
    /**
     * The run stopped before every selected task could send: the call
     * ceiling, the dollar budget or an unmeasurable reply ended it. A
     * truncated run is `incomplete`, never `pass`: the missing sends are
     * not evidence. Absent when every task ran to its own end.
     */
    stoppedEarly: z.optional(z.array(z.string())),
    /** Present only when every arm executed its frozen bundle snapshot. */
    harnessDigest: z.optional(z.string()),
    compactionLedger: z.optional(compactionLedgerSchema),
    certifiedDigest: z.optional(z.string()),
    computedDigest: z.optional(z.string()),
    incompleteReasons: z.optional(z.array(z.string())),
  }),
])
export type EvalReport = z.infer<typeof evalReportSchema>
type ReportArm = EvalReport['arms'][number]

/** The report as JSON: two-space indent and a trailing newline, as committed. */
export function formatEvalReportJson(report: EvalReport): string {
  return `${JSON.stringify(report, undefined, 2)}\n`
}

function formatRate(rate: number): string {
  return `${String(Math.round(rate * 100))}%`
}

function formatCost(costUsd: UsdAmount): string {
  return formatUsd(costUsd, EVAL_COST_DECIMALS)
}

/** The mechanism's change against the baseline, as a signed percentage. */
function formatChange(baseline: number, mechanism: number): string {
  if (baseline === 0 && mechanism !== 0) {
    return 'from 0'
  }
  const change = baseline === 0 ? 0 : Math.round(((mechanism - baseline) / baseline) * 100)
  if (change === 0) {
    return '±0%'
  }
  return `${change > 0 ? '+' : ''}${String(change)}%`
}

/** Whether a floor held, or that its split did not run. */
function heldWord(floor: EvalFloorResult): string {
  if (floor.tasks === 0) {
    return 'not run'
  }
  return floor.held ? 'yes' : 'no'
}

/** Text in a code fence longer than any run of backticks inside it. */
function fenced(text: string): string[] {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longest + 1))
  return [`${fence}text`, text, fence]
}

function recordedCount(value: number | undefined): string {
  return value === undefined ? 'not recorded' : String(value)
}

function armLines(arm: ReportArm): string[] {
  const lines = [`## Arm: ${arm.name}`, ``]
  if (arm.mechanism !== undefined) {
    lines.push(`Mechanism: ${arm.mechanism}`, ``)
  }
  lines.push(
    `| Task | Split | Pass | Terminal | Attempts | Requests | Input | Cached | Output | Cost | Tool calls | Cards | Questions | Paid refused | Order |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  )
  for (const result of arm.results) {
    lines.push(
      `| ${result.taskId} | ${result.split} | ${result.passed ? 'yes' : 'no'} | ${result.terminal} | ${String(result.attempts)} | ${String(result.requests)} | ${String(result.inputTokens)} | ${String(result.cachedTokens)} | ${String(result.outputTokens)} | ${formatCost(result.costUsd)} | ${String(result.toolCalls)} | ${String(result.approvals)} | ${recordedCount(result.questions)} | ${recordedCount(result.paidRefusals)} | ${recordedCount(result.order)} |`,
    )
  }
  lines.push(``)
  for (const result of arm.results) {
    if (result.compactionLedger === undefined) continue
    const money = result.compactionLedger
    lines.push(
      `${result.taskId} compaction ledger: reserved $${money.reservedUsd}, settled $${money.settledUsd}, outstanding $${money.outstandingUsd}, retained unknown $${money.retainedUsd}.`,
      ``,
    )
  }
  if ('compactionLedger' in arm && arm.compactionLedger !== undefined) {
    const money = arm.compactionLedger
    lines.push(
      `Arm compaction ledger: reserved $${money.reservedUsd}, settled $${money.settledUsd}, outstanding $${money.outstandingUsd}, retained unknown $${money.retainedUsd}.`,
      ``,
    )
  }
  const packed = arm.results.filter((result) => result.packedTokensAvoided !== undefined)
  if (packed.length > 0) {
    lines.push(
      `| Task | Packing saved (estimated tokens) | Recalls |`,
      `| --- | --- | --- |`,
      ...packed.map(
        (result) =>
          `| ${result.taskId} | ${recordedCount(result.packedTokensAvoided)} | ${recordedCount(result.recalls)} |`,
      ),
      ``,
    )
  }
  for (const summary of arm.summaries) {
    lines.push(
      summary.tasks === 0
        ? `${summary.split}: not run.`
        : `${summary.split}: ${String(summary.passed)}/${String(summary.tasks)} passed (${formatRate(summary.passRate)}), ${String(summary.attempts)} attempts in ${String(summary.requests)} requests, ${String(summary.inputTokens)} input (${String(summary.cachedTokens)} cached) + ${String(summary.outputTokens)} output tokens, ${formatCost(summary.costUsd)}.`,
    )
  }
  lines.push(``)
  for (const result of arm.results) {
    if (result.passed) {
      continue
    }
    // A reason can carry what the model's code printed: kept as text in a
    // fence, never read as Markdown.
    const reason = result.failures.join('\n')
    lines.push(`${result.taskId} failed:`, ``, ...fenced(reason === '' ? 'no detail' : reason), ``)
  }
  return lines
}

function comparisonLines(baseline: ReportArm, mechanism: ReportArm): string[] {
  const lines = [
    `## ${mechanism.name} against ${baseline.name}`,
    ``,
    `| Split | Pass rate | Attempts | Input tokens | Output tokens | Cost |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ]
  for (const summary of mechanism.summaries) {
    const base = baseline.summaries.find((candidate) => candidate.split === summary.split)
    if (base === undefined || base.tasks === 0 || summary.tasks === 0) {
      continue
    }
    lines.push(
      `| ${summary.split} | ${formatRate(base.passRate)} → ${formatRate(summary.passRate)} | ${formatChange(base.attempts, summary.attempts)} | ${formatChange(base.inputTokens, summary.inputTokens)} | ${formatChange(base.outputTokens, summary.outputTokens)} | ${formatCostChange(base.costUsd, summary.costUsd)} |`,
    )
  }
  lines.push(``)
  return lines
}

/** The report as Markdown: the human-readable half committed beside the JSON. */
export function formatEvalReportMarkdown(report: EvalReport): string {
  const lines = [
    `# Paired efficiency evaluation (M75)`,
    ``,
    `Model: ${report.model} · generated ${report.generatedAt} · verdict: ${report.verdict}`,
    ``,
  ]
  if (report.version === EVAL_REPORT_VERSION && report.compactionLedger !== undefined) {
    const money = report.compactionLedger
    lines.push(
      `Run compaction ledger: reserved $${money.reservedUsd}, settled $${money.settledUsd}, outstanding $${money.outstandingUsd}, retained unknown $${money.retainedUsd}.`,
      ``,
    )
  }
  if (report.version === EVAL_REPORT_VERSION && report.computedDigest !== undefined) {
    lines.push(
      `Certified digest: ${report.certifiedDigest ?? 'not recorded'} · computed: ${report.computedDigest}`,
      ``,
    )
  }
  for (const arm of report.arms) {
    lines.push(...armLines(arm))
  }
  const [baseline, ...mechanisms] = report.arms
  if (baseline !== undefined) {
    for (const mechanism of mechanisms) {
      lines.push(...comparisonLines(baseline, mechanism))
    }
  }
  lines.push(
    `## Capability floors`,
    ``,
    `| Arm | Split | Tasks | Pass rate | Floor | Held |`,
    `| --- | --- | --- | --- | --- | --- |`,
  )
  for (const floor of report.floors) {
    lines.push(
      `| ${floor.arm} | ${floor.split} | ${String(floor.tasks)} | ${formatRate(floor.passRate)} | ${formatRate(floor.floor)} | ${heldWord(floor)} |`,
    )
  }
  lines.push(``)
  if (report.version === EVAL_REPORT_VERSION && report.packingEngagement !== undefined) {
    const engagement = report.packingEngagement
    const listed = (ids: readonly string[]) => (ids.length === 0 ? 'none' : ids.join(', '))
    lines.push(
      `## Packing engaged (M73)`,
      ``,
      `| Arm | Long-output tasks | Never packed | Held |`,
      `| --- | --- | --- | --- |`,
      `| ${engagement.arm} | ${listed(engagement.longOutputTasks)} | ${listed(engagement.unengaged)} | ${engagement.held ? 'yes' : 'no'} |`,
      ``,
    )
  }
  if (report.version === EVAL_REPORT_VERSION && report.compactionEngagement !== undefined) {
    const engagement = report.compactionEngagement
    const listed = (ids: readonly string[]) => (ids.length === 0 ? 'none' : ids.join(', '))
    lines.push(
      `## Compaction engaged (M74)`,
      ``,
      `| Arm | Long-context tasks | Never compacted | Held |`,
      `| --- | --- | --- | --- |`,
      `| ${engagement.arm} | ${listed(engagement.longContextTasks)} | ${listed(engagement.unengaged)} | ${engagement.held ? 'yes' : 'no'} |`,
      ``,
    )
    // The settled-admission count per long-context task: the evidence the
    // acceptance above judges, beside the floors.
    if (engagement.longContextTasks.length > 0) {
      const arm = report.arms.find((candidate) => candidate.name === engagement.arm)
      lines.push(
        `| Task | Settled compactions | Applied compactions |`,
        `| --- | --- | --- |`,
        ...engagement.longContextTasks.map(
          (taskId) =>
            `| ${taskId} | ${recordedCount(arm?.results.find((result) => result.taskId === taskId)?.compactionsSettled)} | ${recordedCount(arm?.results.find((result) => result.taskId === taskId)?.compactionsApplied)} |`,
        ),
        ``,
      )
    }
  }
  if (
    report.version === EVAL_REPORT_VERSION &&
    report.stoppedEarly !== undefined &&
    report.stoppedEarly.length > 0
  ) {
    lines.push(`## Stopped early`, ``, ...report.stoppedEarly.map((reason) => `- ${reason}`), ``)
  }
  if (report.version === EVAL_REPORT_VERSION && report.incompleteReasons !== undefined) {
    lines.push(
      `## Incomplete evidence`,
      ``,
      ...report.incompleteReasons.map((reason) => `- ${reason}`),
      ``,
    )
  }
  return lines.join('\n')
}

function formatCostChange(before: UsdAmount, after: UsdAmount): string {
  const base = Usd.from(before)
  const change = Usd.from(after).subtract(base)
  if (base.compare(Usd.from(0)) === 0) return change.compare(Usd.from(0)) === 0 ? '±0%' : 'from 0'
  // Only a dimensionless rounded percentage crosses to Number. Money stays exact.
  const rounded = Number(change.times(100).times(2).add(base).floorDivide(base.times(2)))
  return rounded === 0 ? '±0%' : `${rounded > 0 ? '+' : ''}${String(rounded)}%`
}
